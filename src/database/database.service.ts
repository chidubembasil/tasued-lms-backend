import 'dotenv/config';
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { PrismaClient as PrismaClientType } from '../generated/prisma/client.js';
import * as generatedModule from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

// The generated client is CommonJS (`module.exports = {...}`), which the
// ESM loader cannot statically analyse for named exports. Resolve the
// constructor tolerantly across runtimes (Node ESM<->CJS interop, Vite).
const generated = generatedModule as unknown as {
  default?: { PrismaClient?: unknown };
  PrismaClient?: unknown;
};

const PrismaClientCtor = (generated.PrismaClient ??
  generated.default?.PrismaClient ??
  generated.default) as unknown as new (args: {
  adapter: unknown;
}) => PrismaClientType;

@Injectable()
export class DatabaseService
  extends PrismaClientCtor
  implements OnModuleInit, OnModuleDestroy
{
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. Add it to your .env file.',
      );
    }

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);

    super({ adapter });

    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
  }
}
