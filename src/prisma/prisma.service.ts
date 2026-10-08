import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Único ponto de acesso ao Prisma (persistência centralizada na infraestrutura).
 * Usa o driver adapter `pg` (Prisma Client sem engine nativa).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(config: ConfigService) {
    const url = new URL(config.getOrThrow<string>('DATABASE_URL'));
    const schema = url.searchParams.get('schema') ?? undefined;
    url.searchParams.delete('schema');
    super({
      adapter: new PrismaPg({ connectionString: url.toString() }, { schema }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
