import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from './helpers';

describe('Swagger / OpenAPI (E2E)', () => {
  let app: INestApplication;

  beforeAll(async () => (app = await createApp({ SWAGGER_ENABLED: 'true' })));
  afterAll(async () => app.close());

  it('publica a especificação OpenAPI cobrindo todos os endpoints do documento', async () => {
    const res = await request(app.getHttpServer()).get('/docs-json').expect(200);
    const paths = Object.keys(res.body.paths);
    const expected = [
      '/api/v1/auth/register',
      '/api/v1/auth/login',
      '/api/v1/auth/refresh',
      '/api/v1/auth/logout',
      '/api/v1/auth/me',
      '/api/v1/organizations/me',
      '/api/v1/organizations/me/members',
      '/api/v1/organizations/me/members/{userId}',
      '/api/v1/users/me',
      '/api/v1/leads',
      '/api/v1/leads/{id}',
      '/api/v1/leads/{id}/stage',
      '/api/v1/lead-stages',
      '/api/v1/courses',
      '/api/v1/courses/{id}',
      '/api/v1/courses/{id}/enroll',
      '/api/v1/courses/{id}/progress',
      '/api/v1/courses/{id}/lessons/{lessonId}/complete',
      '/api/v1/enrollments/me',
      '/api/v1/availability',
      '/api/v1/appointments/slots',
      '/api/v1/appointments',
      '/api/v1/appointments/{id}/cancel',
      '/api/v1/invoices',
      '/api/v1/invoices/{id}',
      '/api/v1/invoices/{id}/pay',
      '/api/v1/payments/webhook',
      '/api/v1/notifications',
      '/api/v1/notifications/{id}/read',
      '/api/v1/notifications/read-all',
      '/health',
    ];
    for (const path of expected) expect(paths).toContain(path);
    expect(res.body.components.securitySchemes).toHaveProperty('bearer');
    await request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('o Swagger fica desligado quando SWAGGER_ENABLED=false', async () => {
    const off = await createApp({ SWAGGER_ENABLED: 'false' });
    try {
      await request(off.getHttpServer()).get('/docs-json').expect(404);
    } finally {
      await off.close();
    }
  });
});
