import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { createKeyv } from '@keyv/redis';
import { validateEnv, type Env } from './config/env.schema.js';
import { PrismaModule } from './database/prisma.module.js';
import { RedisModule } from './infrastructure/redis/redis.module.js';
import { RedisThrottlerStorage } from './infrastructure/redis/redis-throttler.storage.js';
import { MinioModule } from './infrastructure/minio/minio.module.js';
import { MailModule } from './infrastructure/mail/mail.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard.js';
import { RolesGuard } from './common/guards/roles.guard.js';
import { PermissionsGuard } from './common/guards/permissions.guard.js';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';

const redisConnection = (config: ConfigService<Env, true>) => ({
  host: config.get('REDIS_HOST', { infer: true }),
  port: config.get('REDIS_PORT', { infer: true }),
  password: config.get('REDIS_PASSWORD', { infer: true }),
});

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
    }),

    PrismaModule,
    RedisModule,
    MinioModule,
    MailModule,

    ThrottlerModule.forRootAsync({
      inject: [RedisThrottlerStorage],
      useFactory: (storage: RedisThrottlerStorage) => ({
        throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
        storage,
      }),
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        connection: redisConnection(config),
        prefix: 'app:bull',
      }),
    }),

    CacheModule.registerAsync({
      isGlobal: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => {
        const { host, port, password } = redisConnection(config);
        const auth = password ? `:${encodeURIComponent(password)}@` : '';
        return {
          stores: [
            createKeyv(`redis://${auth}${host}:${port}`, {
              namespace: 'app:cache',
            }),
          ],
          ttl: config.get('CACHE_TTL', { infer: true }),
        };
      },
    }),

    UsersModule,
    AuthModule,
    HealthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
  ],
})
export class AppModule {}
