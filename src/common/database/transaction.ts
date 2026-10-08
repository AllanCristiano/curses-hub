import { Prisma } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

/** Trava consultiva (advisory lock) por chave, liberada ao fim da transação. */
export async function advisoryLock(tx: Tx, key: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
}
