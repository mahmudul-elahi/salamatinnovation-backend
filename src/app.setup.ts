import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import type { Env } from './config/env.schema.js';

export const API_PREFIX = 'api';
export const SWAGGER_PATH = 'api/docs';

/**
 * Applies the HTTP-level configuration shared by `main.ts` and the e2e tests,
 * so tests exercise the same pipeline as production.
 */
export function configureApp(app: NestExpressApplication): void {
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  app.setGlobalPrefix(API_PREFIX);

  if (config.get('TRUST_PROXY', { infer: true })) {
    // Needed behind a reverse proxy so rate limiting sees real client IPs.
    app.set('trust proxy', 1);
  }

  app.use(helmet());

  app.enableCors({
    origin: config.get('CORS_ORIGINS', { infer: true }),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Lets Prisma, Redis and BullMQ close cleanly on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  if (config.get('SWAGGER_ENABLED', { infer: true }) ?? !isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Salamat Innovation POS & ERP API')
        .setDescription(
          'REST API for the Point of Sale & ERP backend. Successful responses are wrapped as { success, statusCode, data, timestamp }.',
        )
        .setVersion('1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup(SWAGGER_PATH, app, document);
  }
}
