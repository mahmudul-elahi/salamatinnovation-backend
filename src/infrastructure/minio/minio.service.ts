import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Minio from 'minio';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import type { Env } from '../../config/env.schema.js';

export interface UploadResult {
  key: string;
  url: string;
  bucket: string;
  size: number;
  mimeType: string;
}

export interface FileToUpload {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private readonly client: Minio.Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private readonly port: number;
  private readonly useSSL: boolean;

  constructor(config: ConfigService<Env, true>) {
    this.endpoint = config.get('MINIO_ENDPOINT', { infer: true });
    this.port = config.get('MINIO_PORT', { infer: true });
    this.useSSL = config.get('MINIO_USE_SSL', { infer: true });
    this.bucket = config.get('MINIO_BUCKET_NAME', { infer: true });
    const region = config.get('MINIO_REGION', { infer: true });

    this.client = new Minio.Client({
      endPoint: this.endpoint,
      port: this.port,
      useSSL: this.useSSL,
      accessKey: config.get('MINIO_ACCESS_KEY', { infer: true }),
      secretKey: config.get('MINIO_SECRET_KEY', { infer: true }),
      ...(region ? { region } : {}),
    });
  }

  async onModuleInit() {
    await this.ensureBucketExists();
  }

  async ensureBucketExists(): Promise<void> {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`[MINIO] Bucket created successfully: ${this.bucket}`);
      } else {
        this.logger.log(`[MINIO] Connected to bucket: ${this.bucket}`);
      }
    } catch (err) {
      this.logger.warn(
        `[MINIO] Could not verify/create bucket "${this.bucket}" on startup: ${(err as Error).message}. Storage will connect when MinIO is available.`,
      );
    }
  }

  async uploadFile(
    file: FileToUpload,
    folder: string = 'general',
  ): Promise<UploadResult> {
    const extension = extname(file.originalname);
    const sanitizedFolder = folder.replace(/^\/+|\/+$/g, '');
    const filename = `${randomUUID()}${extension}`;
    const key = `${sanitizedFolder}/${filename}`;

    return this.uploadBuffer(file.buffer, key, file.mimetype, file.size);
  }

  async uploadBuffer(
    buffer: Buffer,
    key: string,
    mimeType: string,
    size?: number,
  ): Promise<UploadResult> {
    const fileSize = size ?? buffer.length;

    await this.client.putObject(this.bucket, key, buffer, fileSize, {
      'Content-Type': mimeType,
    });

    const protocol = this.useSSL ? 'https' : 'http';
    const isStandardPort =
      (this.useSSL && this.port === 443) || (!this.useSSL && this.port === 80);
    const portSuffix = isStandardPort ? '' : `:${this.port}`;
    const url = `${protocol}://${this.endpoint}${portSuffix}/${this.bucket}/${key}`;

    this.logger.log(`[MINIO] File uploaded successfully: ${key}`);

    return {
      key,
      url,
      bucket: this.bucket,
      size: fileSize,
      mimeType,
    };
  }

  async getFileStream(key: string): Promise<Readable> {
    return this.client.getObject(this.bucket, key);
  }

  async getPresignedUrl(
    key: string,
    expirySeconds: number = 86400,
  ): Promise<string> {
    return this.client.presignedGetObject(this.bucket, key, expirySeconds);
  }

  async deleteFile(key: string): Promise<void> {
    await this.client.removeObject(this.bucket, key);
    this.logger.log(`[MINIO] File deleted: ${key}`);
  }

  getClient(): Minio.Client {
    return this.client;
  }

  async ping(): Promise<boolean> {
    try {
      await this.client.bucketExists(this.bucket);
      return true;
    } catch {
      return false;
    }
  }
}
