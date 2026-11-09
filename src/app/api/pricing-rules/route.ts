import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { exportRulesCsv } from "@/server/services/pricing-bulk";

/** Download your pricing rules as CSV (?template=1 adds a blank row per brand × category). */
export async function GET(req: Request) {
  await connection();
  const template = new URL(req.url).searchParams.get("template") === "1";
  return new Response(exportRulesCsv(getDb(), { template }), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${template ? "pricing-rules-template" : "pricing-rules"}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
