import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

export type Db = PrismaClient;
export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

function createClient(): PrismaClient {
  const adapter = new PrismaBetterSqlite3({ url: url.replace(/^file:/, "") });
  return new PrismaClient({ adapter });
}

const globalForDb = globalThis as unknown as { __solexDb?: Map<string, PrismaClient> };
globalForDb.__solexDb ??= new Map();

/** One Prisma client per database URL per process (survives Next.js dev hot reloads). */
export const db: PrismaClient = globalForDb.__solexDb.get(url) ?? createClient();
globalForDb.__solexDb.set(url, db);

/**
 * Runs one business command atomically. Every side effect of a command
 * (inventory, booking, schedule, commission, audit, notifications) goes through
 * the same `tx`, so it all commits or none of it does.
 */
export function withTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction((tx) => fn(tx), { timeout: 20_000, maxWait: 20_000 });
}
