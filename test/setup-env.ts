// Variáveis de ambiente padrão para a suíte de testes (podem ser sobrescritas pelo ambiente/CI).
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://hcode:hcode@localhost:5433/hcode_hub_test?schema=public';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret';
process.env.JWT_ACCESS_EXPIRES_IN ??= '15m';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret';
process.env.JWT_REFRESH_EXPIRES_IN ??= '7d';
process.env.PAYMENT_WEBHOOK_SECRET ??= 'test-webhook-secret';
process.env.BCRYPT_ROUNDS ??= '4';
process.env.AUTH_THROTTLE_LIMIT ??= '1000';
process.env.SWAGGER_ENABLED ??= 'false';
