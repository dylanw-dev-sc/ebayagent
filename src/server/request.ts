import "server-only";
import { connection } from "next/server";
import { getDb, type AppDb } from "./db/client";

/**
 * Database access for request-time rendering. better-sqlite3 is synchronous,
 * so without connection() Next.js would run these reads during prerendering
 * and bake stale data into the static shell.
 */
export async function requestDb(): Promise<AppDb> {
  await connection();
  return getDb();
}
