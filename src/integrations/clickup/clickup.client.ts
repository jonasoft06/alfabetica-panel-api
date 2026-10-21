import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { toStageTask } from './clickup-task.mapper';
import {
  ClickUpListNotFoundError,
  ClickUpUnavailableError,
} from './clickup.errors';
import type {
  ClickUpList,
  ClickUpRawError,
  ClickUpRawList,
  ClickUpRawTasksPage,
  ClickUpStageTask,
} from './clickup.types';

const BASE_URL = 'https://api.clickup.com/api/v2';
const REQUEST_TIMEOUT_MS = 10_000;
// Safety stop for pagination; a production list has a few dozen tasks.
const MAX_TASK_PAGES = 20;

// ECODE ClickUp returns (with 401) for a list that does not exist or that the
// token cannot see. Any other 401 means the token itself is invalid.
const RESOURCE_NOT_ACCESSIBLE_ECODES = new Set(['OAUTH_027']);

// Read-only ClickUp client. Never writes to ClickUp.
@Injectable()
export class ClickUpClient {
  private readonly logger = new Logger(ClickUpClient.name);
  private readonly token: string;

  constructor(configService: ConfigService) {
    this.token = configService.getOrThrow<string>('CLICKUP_API_TOKEN');
  }

  async getList(listId: string): Promise<ClickUpList> {
    const list = await this.request<ClickUpRawList>(
      `/list/${encodeURIComponent(listId)}`,
    );

    return { id: list.id, folderId: list.folder?.id ?? null };
  }

  // Every numbered stage task of the list, open and closed, without subtasks.
  async getListTasks(listId: string): Promise<ClickUpStageTask[]> {
    const tasks: ClickUpStageTask[] = [];

    for (let page = 0; page < MAX_TASK_PAGES; page += 1) {
      const result = await this.request<ClickUpRawTasksPage>(
        `/list/${encodeURIComponent(listId)}/task?include_closed=true&subtasks=false&page=${page}`,
      );

      for (const rawTask of result.tasks) {
        const task = toStageTask(rawTask);
        if (task) {
          tasks.push(task);
        }
      }

      if (result.last_page !== false || result.tasks.length === 0) {
        return tasks;
      }
    }

    this.logger.warn(`Task pagination stopped at ${MAX_TASK_PAGES} pages`);
    return tasks;
  }

  private async request<T>(path: string): Promise<T> {
    let response: Response;

    try {
      response = await fetch(`${BASE_URL}${path}`, {
        headers: { Authorization: this.token },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.warn(
        `ClickUp request failed: ${(error as Error).name} (${path.split('?')[0]})`,
      );
      throw new ClickUpUnavailableError();
    }

    if (response.ok) {
      return (await response.json()) as T;
    }

    const body = (await response.json().catch(() => ({}))) as ClickUpRawError;

    // Status and ClickUp's error code only: enough to diagnose, nothing that
    // could carry the token or task data.
    this.logger.warn(
      `ClickUp responded ${response.status} ${body.ECODE ?? ''} (${path.split('?')[0]})`,
    );

    if (
      response.status === 404 ||
      ((response.status === 401 || response.status === 403) &&
        RESOURCE_NOT_ACCESSIBLE_ECODES.has(body.ECODE ?? ''))
    ) {
      throw new ClickUpListNotFoundError();
    }

    throw new ClickUpUnavailableError();
  }
}
