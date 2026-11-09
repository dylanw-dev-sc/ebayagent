import "server-only";
import { refresh } from "next/cache";
import type { ActionResult } from "@/server/form";
import { ValidationError } from "@/server/services/preferences";

/** Run a mutation, refresh the client router, and turn validation errors into messages. */
export function run(fn: () => void | string, okMessage?: string): ActionResult {
  try {
    const msg = fn();
    refresh();
    return { ok: true, message: typeof msg === "string" ? msg : okMessage };
  } catch (err) {
    if (err instanceof ValidationError) return { ok: false, error: err.message };
    console.error(err);
    return { ok: false, error: err instanceof Error ? err.message : "Something went wrong." };
  }
}
