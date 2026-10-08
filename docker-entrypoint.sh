#!/bin/sh
set -e

# Aplica as migrations antes de subir a API (desative com RUN_MIGRATIONS=false)
if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] aplicando migrations (prisma migrate deploy)..."
  npx prisma migrate deploy
fi

# Dados de demonstração (idempotente) — ative com RUN_SEED=true
if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "[entrypoint] executando seed de demonstração..."
  node dist-seed/seed.js
fi

exec "$@"
