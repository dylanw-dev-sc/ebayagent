import { robotsAllows } from "./robots";
import type { FetchedPage, PageFetcher } from "./types";

/**
 * Reads a store's product page politely: https only, robots.txt honored,
 * at most one request per store every few seconds, short timeout, size cap,
 * and a plain identifying User-Agent.
 */
export const RETAIL_USER_AGENT = "ClothingFinder/1.0 (personal retail price check)";
const AGENT_TOKEN = "clothingfinder";

export function createPageFetcher(
  opts: { timeoutMs?: number; maxBytes?: number; minIntervalMs?: number; fetchImpl?: typeof fetch } = {},
): PageFetcher {
  const timeoutMs = opts.timeoutMs ?? 6000;
  const maxBytes = opts.maxBytes ?? 1_500_000;
  const minIntervalMs = opts.minIntervalMs ?? 3000;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const robots = new Map<string, string | null>();
  const lastHit = new Map<string, number>();

  const timed = async (url: string, accept: string): Promise<Response> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetchImpl(url, { headers: { "User-Agent": RETAIL_USER_AGENT, Accept: accept }, redirect: "follow", signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };

  const pace = async (host: string) => {
    const wait = (lastHit.get(host) ?? 0) + minIntervalMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastHit.set(host, Date.now());
  };

  const robotsFor = async (origin: string, host: string): Promise<string | null> => {
    if (robots.has(origin)) return robots.get(origin) ?? null;
    let txt: string | null = null;
    try {
      await pace(host);
      const res = await timed(`${origin}/robots.txt`, "text/plain");
      txt = res.ok ? (await res.text()).slice(0, 200_000) : null;
    } catch {
      txt = null;
    }
    robots.set(origin, txt);
    return txt;
  };

  return {
    async fetchPage(url: string): Promise<FetchedPage> {
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        return { ok: false, status: 0, html: null, reason: "not a valid address" };
      }
      if (u.protocol !== "https:") return { ok: false, status: 0, html: null, reason: "not https" };
      const rules = await robotsFor(u.origin, u.host);
      if (rules !== null && !robotsAllows(rules, u.pathname + u.search, AGENT_TOKEN)) {
        return { ok: false, status: 0, html: null, reason: "the store's robots.txt asks not to" };
      }
      try {
        await pace(u.host);
        const res = await timed(url, "text/html,application/xhtml+xml");
        if (!res.ok) return { ok: false, status: res.status, html: null, reason: `HTTP ${res.status}` };
        if (!/html/i.test(res.headers.get("content-type") ?? "")) return { ok: false, status: res.status, html: null, reason: "not a web page" };
        return { ok: true, status: res.status, html: await readLimited(res, maxBytes) };
      } catch (err) {
        return { ok: false, status: 0, html: null, reason: err instanceof Error && err.name === "AbortError" ? "timed out" : "couldn't connect" };
      }
    },
  };
}

async function readLimited(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return (await res.text()).slice(0, maxBytes);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  let bytes = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    out += decoder.decode(value, { stream: true });
    if (bytes >= maxBytes) {
      await reader.cancel();
      break;
    }
  }
  return (out + decoder.decode()).slice(0, maxBytes);
}
