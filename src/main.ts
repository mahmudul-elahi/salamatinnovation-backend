import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp, SWAGGER_PATH } from './app.setup.js';
import type { Env } from './config/env.schema.js';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);

  const config = app.get<ConfigService<Env, true>>(ConfigService);
  const port = config.get('PORT', { infer: true });
  await app.listen(port);

  const logger = new Logger('Bootstrap');
  logger.log(`[SERVER] Application running on port ${port}`);
  if (
    config.get('SWAGGER_ENABLED', { infer: true }) ??
    config.get('NODE_ENV', { infer: true }) !== 'production'
  ) {
    logger.log(
      `[SWAGGER] API documentation available at http://localhost:${port}/${SWAGGER_PATH}`,
    );
  }
}

await bootstrap();
