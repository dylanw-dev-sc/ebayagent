import { COLOR_SWATCH } from "@/lib/matching/color";
import { cn } from "./ui";

/** A small color dot. Colors you add yourself (no known swatch) show as a dashed ring. */
export function ColorSwatch({ colorKey, className }: { colorKey: string; className?: string }) {
  const bg = COLOR_SWATCH[colorKey];
  return (
    <span
      aria-hidden
      className={cn("inline-block size-3 shrink-0 rounded-full border align-[-1px]", bg ? "border-black/15" : "border-dashed border-line-strong", className)}
      style={bg ? { background: bg } : undefined}
    />
  );
}
