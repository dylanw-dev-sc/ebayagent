"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { cn } from "../ui";

export interface FacetOptions {
  brands: Array<{ id: number; name: string; count: number }>;
  categories: Array<{ id: number; name: string }>;
  sizes: string[];
  materials: Array<{ key: string; name: string }>;
  colors: Array<{ key: string; name: string }>;
  profiles: Array<{ id: number; name: string }>;
}

const FILTER_KEYS = ["brand", "cat", "size", "mat", "color", "price", "rev", "profile", "q"];

export function FilterBar({ facets, hide = [] }: { facets: FacetOptions; hide?: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const currentQ = sp.get("q") ?? "";

  const set = (key: string, value: string) => {
    const params = new URLSearchParams(sp.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    params.delete("page");
    params.delete("listing");
    start(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  const active = FILTER_KEYS.filter((k) => sp.get(k)).length;
  const clear = () => {
    const params = new URLSearchParams(sp.toString());
    for (const k of FILTER_KEYS) params.delete(k);
    params.delete("page");
    start(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
  };

  const select = "field h-9 w-auto min-w-0 max-w-[13rem] py-0 pl-3 text-[13px]";
  return (
    <div className={cn("flex flex-wrap items-center gap-2 transition-opacity", pending && "opacity-60")} role="search">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-surface px-3.5 text-[13px] font-medium text-ink md:hidden"
      >
        <SlidersHorizontal className="size-4" /> Filters{active ? ` (${active})` : ""}
      </button>
      <div className={cn(open ? "flex" : "hidden", "w-full flex-wrap items-center gap-2 md:flex md:w-auto")}>
      <form
        key={currentQ}
        onSubmit={(e) => {
          e.preventDefault();
          set("q", String(new FormData(e.currentTarget).get("q") ?? "").trim());
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <input name="q" defaultValue={currentQ} placeholder="Search titles" aria-label="Search titles" className="field h-9 w-44 py-0 pl-9 text-[13px] sm:w-52" />
      </form>
      {!hide.includes("brand") ? (
        <select aria-label="Brand" className={select} value={sp.get("brand") ?? ""} onChange={(e) => set("brand", e.target.value)}>
          <option value="">All brands</option>
          {facets.brands.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name} ({b.count})
            </option>
          ))}
        </select>
      ) : null}
      <select aria-label="Category" className={select} value={sp.get("cat") ?? ""} onChange={(e) => set("cat", e.target.value)}>
        <option value="">All categories</option>
        {facets.categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <select aria-label="Size" className={select} value={sp.get("size") ?? ""} onChange={(e) => set("size", e.target.value)}>
        <option value="">Any size</option>
        {facets.sizes.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <select aria-label="Material" className={select} value={sp.get("mat") ?? ""} onChange={(e) => set("mat", e.target.value)}>
        <option value="">Any material</option>
        {facets.materials.map((m) => (
          <option key={m.key} value={m.key}>
            {m.name}
          </option>
        ))}
      </select>
      <select aria-label="Color" className={select} value={sp.get("color") ?? ""} onChange={(e) => set("color", e.target.value)}>
        <option value="">Any color</option>
        {facets.colors.map((c) => (
          <option key={c.key} value={c.key}>
            {c.name}
          </option>
        ))}
      </select>
      {!hide.includes("price") ? (
        <select aria-label="Pricing eligibility" className={select} value={sp.get("price") ?? ""} onChange={(e) => set("price", e.target.value)}>
          <option value="">Any pricing</option>
          <option value="eligible">Within price ceiling</option>
          <option value="over_ceiling">Over price ceiling</option>
          <option value="needs_review">Needs pricing review</option>
        </select>
      ) : null}
      <select aria-label="Review status" className={select} value={sp.get("rev") ?? ""} onChange={(e) => set("rev", e.target.value)}>
        <option value="">Reviewed or not</option>
        <option value="unreviewed">Not yet reviewed</option>
        <option value="reviewed">Reviewed</option>
      </select>
      <select aria-label="Search profile" className={select} value={sp.get("profile") ?? ""} onChange={(e) => set("profile", e.target.value)}>
        <option value="">All profiles</option>
        {facets.profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
      {active ? (
        <button type="button" onClick={clear} className="inline-flex h-9 items-center gap-1 rounded-full px-3 text-[13px] font-medium text-ink-2 hover:bg-muted hover:text-ink">
          <X className="size-3.5" /> Clear {active}
        </button>
      ) : null}
      </div>
    </div>
  );
}

export function SortSelect() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [, start] = useTransition();
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-3">
      Sort
      <select
        aria-label="Sort"
        className="field h-9 w-auto py-0 pl-3 text-[13px]"
        value={sp.get("sort") ?? "newest"}
        onChange={(e) => {
          const params = new URLSearchParams(sp.toString());
          if (e.target.value === "newest") params.delete("sort");
          else params.set("sort", e.target.value);
          params.delete("page");
          start(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
        }}
      >
        <option value="newest">Newly listed</option>
        <option value="price_asc">Lowest total price</option>
        <option value="price_desc">Highest total price</option>
        <option value="material">Fabric preference</option>
        <option value="color">Color preference</option>
      </select>
    </label>
  );
}
