import { Module } from '@nestjs/common';
import { ClickUpClient } from './clickup.client';

@Module({
  providers: [ClickUpClient],
  exports: [ClickUpClient],
})
export class ClickUpModule {}
