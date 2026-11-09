import { FIXTURE_ITEMS, type FixtureGarment } from "@/lib/providers/fixture/data";

/**
 * Illustrations for FIXTURE listings only (synthetic data has no real photos).
 * Each is a flat garment silhouette in the item's color, labeled "Sample".
 */

function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amount));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amount));
  const b = Math.max(0, Math.min(255, (n & 255) + amount));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

function garment(kind: FixtureGarment, fill: string): string {
  const stroke = luminance(fill) > 0.85 ? "#cfc9bd" : shade(fill, -28);
  const detail = luminance(fill) > 0.6 ? shade(fill, -40) : shade(fill, 34);
  const common = `fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round"`;
  switch (kind) {
    case "tee":
      return `<path ${common} d="M150 92 L104 108 L58 150 L88 204 L122 186 L122 420 L278 420 L278 186 L312 204 L342 150 L296 108 L250 92 Q240 122 200 124 Q160 122 150 92 Z"/>
        <path fill="none" stroke="${detail}" stroke-width="2" d="M150 92 Q160 122 200 124 Q240 122 250 92"/>`;
    case "polo":
      return `<path ${common} d="M150 92 L104 108 L58 150 L88 204 L122 186 L122 420 L278 420 L278 186 L312 204 L342 150 L296 108 L250 92 Q240 108 200 110 Q160 108 150 92 Z"/>
        <path ${common} d="M150 92 L200 112 L176 140 Z"/><path ${common} d="M250 92 L200 112 L224 140 Z"/>
        <rect x="192" y="112" width="16" height="64" fill="${shade(fill, -10)}" stroke="${stroke}" stroke-width="1.5"/>
        <circle cx="200" cy="134" r="3" fill="${detail}"/><circle cx="200" cy="158" r="3" fill="${detail}"/>`;
    case "shirt":
      return `<path ${common} d="M152 86 L106 102 L72 150 L48 336 L82 344 L112 206 L116 432 L284 432 L288 206 L318 344 L352 336 L328 150 L294 102 L248 86 L200 108 Z"/>
        <path ${common} d="M152 86 L200 108 L184 138 Z"/><path ${common} d="M248 86 L200 108 L216 138 Z"/>
        <line x1="200" y1="108" x2="200" y2="432" stroke="${detail}" stroke-width="2"/>
        ${[150, 192, 234, 276, 318, 360, 402].map((y) => `<circle cx="207" cy="${y}" r="3" fill="${detail}"/>`).join("")}
        <path fill="none" stroke="${detail}" stroke-width="2" d="M134 190 L170 190 L170 218 L134 218 Z"/>`;
    case "blazer":
      return `<path ${common} d="M142 80 L96 98 L74 160 L54 342 L90 348 L112 212 L112 440 L288 440 L288 212 L310 348 L346 342 L326 160 L304 98 L258 80 L200 258 Z"/>
        <path fill="${shade(fill, -12)}" stroke="${stroke}" stroke-width="2" d="M142 80 L200 258 L168 168 L150 156 L164 120 Z"/>
        <path fill="${shade(fill, -12)}" stroke="${stroke}" stroke-width="2" d="M258 80 L200 258 L232 168 L250 156 L236 120 Z"/>
        <circle cx="200" cy="300" r="4" fill="${detail}"/><circle cx="200" cy="344" r="4" fill="${detail}"/>
        <line x1="128" y1="350" x2="176" y2="350" stroke="${detail}" stroke-width="2"/><line x1="224" y1="350" x2="272" y2="350" stroke="${detail}" stroke-width="2"/>
        <line x1="232" y1="200" x2="266" y2="196" stroke="${detail}" stroke-width="2"/>`;
    case "coat":
      return `<path ${common} d="M146 84 L100 104 L76 168 L58 352 L94 358 L116 224 L118 412 L282 412 L284 224 L306 358 L342 352 L324 168 L300 104 L254 84 Q200 102 146 84 Z"/>
        <rect x="118" y="400" width="164" height="26" rx="4" fill="${shade(fill, -16)}" stroke="${stroke}" stroke-width="2"/>
        <rect x="56" y="346" width="40" height="18" rx="4" fill="${shade(fill, -16)}" stroke="${stroke}" stroke-width="2"/>
        <rect x="304" y="346" width="40" height="18" rx="4" fill="${shade(fill, -16)}" stroke="${stroke}" stroke-width="2"/>
        <path fill="${shade(fill, -16)}" stroke="${stroke}" stroke-width="2" d="M146 84 Q200 102 254 84 L254 100 Q200 118 146 100 Z"/>
        <line x1="200" y1="100" x2="200" y2="426" stroke="${detail}" stroke-width="2.5" stroke-dasharray="3 3"/>
        <path fill="none" stroke="${detail}" stroke-width="2" d="M140 300 L176 290 M224 290 L260 300"/>`;
    default:
      return "";
  }
}

export async function GET(_req: Request, ctx: RouteContext<"/api/fixture-image/[id]">) {
  const { id } = await ctx.params;
  const item = FIXTURE_ITEMS.find((i) => i.id === decodeURIComponent(id));
  if (!item) return new Response("Not found", { status: 404 });
  const bg = "#efece6";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 500" width="800" height="1000" role="img" aria-label="Sample illustration (fixture data)">
  <rect width="400" height="500" fill="${bg}"/>
  <ellipse cx="200" cy="462" rx="130" ry="10" fill="#000" opacity="0.06"/>
  <g transform="translate(0 6)">${garment(item.garment, item.color)}</g>
  <text x="384" y="488" text-anchor="end" font-family="Inter, Helvetica, Arial, sans-serif" font-size="11" letter-spacing="1.5" fill="#8a857d">SAMPLE IMAGE · FIXTURE</text>
</svg>`;
  return new Response(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400" } });
}
