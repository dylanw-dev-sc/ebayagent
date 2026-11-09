import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";
import { seedDatabase } from "./seed";

export type AppDb = BetterSQLite3Database<typeof schema>;

export interface DbHandle {
  db: AppDb;
  sqlite: Database.Database;
  path: string;
}

export const DEFAULT_DB_PATH = path.join("data", "ebay-finder.db");

export function resolveDbPath(): string {
  return process.env.DATABASE_PATH || DEFAULT_DB_PATH;
}

function migrationsFolder(): string {
  return process.env.MIGRATIONS_DIR || path.join(process.cwd(), "drizzle");
}

/**
 * Open (and migrate) a SQLite database. Seeding is idempotent and runs only
 * once per database file, so restarting never overwrites edited preferences.
 */
export function openDatabase(filePath: string, opts: { seed?: boolean } = {}): DbHandle {
  if (filePath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  const sqlite = new Database(filePath);
  if (filePath !== ":memory:") sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: migrationsFolder() });
  if (opts.seed !== false) seedDatabase(db);
  return { db, sqlite, path: filePath };
}

const globalForDb = globalThis as unknown as { __ebayFinderDb?: DbHandle };

/** Process-wide database handle (cached across hot reloads in development). */
export function getDbHandle(): DbHandle {
  if (!globalForDb.__ebayFinderDb) {
    globalForDb.__ebayFinderDb = openDatabase(resolveDbPath());
  }
  return globalForDb.__ebayFinderDb;
}

export function getDb(): AppDb {
  return getDbHandle().db;
}
