import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller.js';
import { PrismaModule } from '../../database/prisma.module.js';
import { RedisModule } from '../../infrastructure/redis/redis.module.js';
import { MinioModule } from '../../infrastructure/minio/minio.module.js';

@Module({
  imports: [TerminusModule, PrismaModule, RedisModule, MinioModule],
  controllers: [HealthController],
})
export class HealthModule {}
