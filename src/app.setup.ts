import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { createValidationPipe } from './common/errors/validation.pipe';

export const API_PREFIX = 'api/v1';

/**
 * Configuração compartilhada entre `main.ts` e os testes E2E
 * (prefixo, validação global, headers de segurança, CORS e Swagger).
 */
export function configureApp(app: INestApplication) {
  const config = app.get(ConfigService);
  const isProduction = config.get('NODE_ENV') === 'production';
  const swaggerEnabled =
    (config.get<string>('SWAGGER_ENABLED') ?? String(!isProduction)) === 'true';

  app.setGlobalPrefix(API_PREFIX, { exclude: ['health'] });
  app.useGlobalPipes(createValidationPipe());

  // Helmet; a CSP padrão bloqueia os scripts inline do Swagger UI, por isso só é relaxada quando o Swagger está ativo.
  app.use(helmet({ contentSecurityPolicy: swaggerEnabled ? false : undefined }));

  // CORS por ambiente: apenas as origens listadas (sem wildcard).
  const origins = (config.get<string>('CORS_ORIGINS') ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'x-organization-id', 'x-request-id'],
    exposedHeaders: ['x-request-id'],
  });

  if (swaggerEnabled) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('HCode Hub API')
        .setDescription(
          'Mini plataforma SaaS modular multi-tenant. Autentique-se em `/auth/login`, use o access token em **Authorize** e, ' +
            'para alternar de organização, envie o header `x-organization-id` (validado contra Membership).',
        )
        .setVersion('1.0.0')
        .addBearerAuth()
        .addApiKey({ type: 'apiKey', name: 'x-organization-id', in: 'header' }, 'organization')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, { jsonDocumentUrl: 'docs-json' });
  }
}
