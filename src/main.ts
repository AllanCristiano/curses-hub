import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { API_PREFIX, configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  app.enableShutdownHooks();

  const port = app.get(ConfigService).get<number>('PORT') ?? 3000;
  await app.listen(port, '0.0.0.0');

  const logger = new Logger('Bootstrap');
  logger.log(`HCode Hub rodando em http://localhost:${port}/${API_PREFIX}`);
  logger.log(`Health check: http://localhost:${port}/health`);
  logger.log(`Swagger: http://localhost:${port}/docs`);
}

bootstrap();
