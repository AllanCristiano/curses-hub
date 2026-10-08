-- Regras de integridade que o Prisma não expressa no schema (documento de software, seções 6.2 e 8)

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Agendamento: intervalo válido e proibição de sobreposição de agendamentos CONFIRMED do mesmo responsável.
-- Intervalos [início, fim) — um horário que começa quando outro termina não conflita.
ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_valid_range_chk" CHECK ("endAt" > "startAt");

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_no_overlap_excl"
  EXCLUDE USING gist ("ownerUserId" WITH =, tsrange("startAt", "endAt") WITH &&)
  WHERE ("status" = 'CONFIRMED');

-- Disponibilidade
ALTER TABLE "availabilities"
  ADD CONSTRAINT "availabilities_day_chk" CHECK ("dayOfWeek" BETWEEN 0 AND 6);

-- Financeiro: total = subtotal - desconto, valores não negativos
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_amounts_chk"
  CHECK ("subtotal" >= 0 AND "discount" >= 0 AND "discount" <= "subtotal" AND "total" = "subtotal" - "discount");

ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_amounts_chk"
  CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "total" = "quantity" * "unitPrice");

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_chk" CHECK ("amount" > 0);

-- AuditLog: somente inserção. UPDATE é bloqueado (exceto o SET NULL de userId quando o usuário é removido).
CREATE OR REPLACE FUNCTION audit_logs_block_update() RETURNS trigger AS $$
BEGIN
  IF NEW."userId" IS NOT NULL
     OR (to_jsonb(NEW) - 'userId') IS DISTINCT FROM (to_jsonb(OLD) - 'userId') THEN
    RAISE EXCEPTION 'audit_logs é append-only: atualização não permitida';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_block_update();
