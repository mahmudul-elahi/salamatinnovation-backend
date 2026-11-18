import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { AllExceptionsFilter } from './common/filters/http-exception.filter.js';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Global API Prefix
  app.setGlobalPrefix('api');

  // Enable CORS
  app.enableCors();

  // Global Exception Filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // Global Logging Interceptor
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Global Validation Pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Swagger OpenAPI Documentation
  const config = new DocumentBuilder()
    .setTitle('Salamat Innovation POS & ERP API')
    .setDescription(
      'Comprehensive REST API for Point of Sale & Enterprise Resource Planning backend',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`[SERVER] Application running on port ${port}`);
  console.log(`[SWAGGER] API documentation available at http://localhost:${port}/api/docs`);
}

await bootstrap();
