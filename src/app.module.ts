import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { CacheModule } from '@nestjs/cache-manager';
import { createKeyv } from '@keyv/redis';
import { redisConfig } from './config/redis.config.js';
import { PrismaModule } from './prisma/prisma.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [redisConfig],
      envFilePath: ['.env'],
    }),

    PrismaModule,

    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('redis.host', 'localhost'),
          port: configService.get<number>('redis.port', 6379),
          password: configService.get<string>('redis.password') || undefined,
        },
      }),
    }),

    CacheModule.registerAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const host = configService.get<string>('redis.host', 'localhost');
        const port = configService.get<number>('redis.port', 6379);
        const password = configService.get<string>('redis.password');
        const ttl = configService.get<number>('redis.ttl', 300000);

        const auth = password ? `:${encodeURIComponent(password)}@` : '';
        const redisUri = `redis://${auth}${host}:${port}`;

        return {
          stores: [createKeyv(redisUri)],
          ttl,
        };
      },
    }),
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
