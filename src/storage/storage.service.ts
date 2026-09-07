import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const UPLOAD_URL_EXPIRES_IN_SECONDS = 900;

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    this.bucket = this.configService.getOrThrow<string>('SPACES_BUCKET');

    this.client = new S3Client({
      forcePathStyle: false,
      region: this.configService.getOrThrow<string>('SPACES_REGION'),
      endpoint: this.configService.getOrThrow<string>('SPACES_ENDPOINT'),
      // Spaces doesn't support the CRC32 checksum the SDK adds by default
      // since v3.729 — it makes presigned PUT uploads fail with InvalidArgument.
      requestChecksumCalculation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: this.configService.getOrThrow<string>(
          'SPACES_ACCESS_KEY_ID',
        ),
        secretAccessKey: this.configService.getOrThrow<string>(
          'SPACES_SECRET_ACCESS_KEY',
        ),
      },
    });
  }

  async generateUploadUrl(
    storageKey: string,
    contentType: string,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: contentType,
    });

    return getSignedUrl(this.client, command, {
      expiresIn: UPLOAD_URL_EXPIRES_IN_SECONDS,
    });
  }

  async deleteObject(storageKey: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: storageKey }),
    );
  }
}
