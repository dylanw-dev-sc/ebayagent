import "@fontsource-variable/inter";
import "@fontsource/cormorant-garamond/500.css";
import "@fontsource/cormorant-garamond/600.css";
import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MobileNav, NavLinks } from "@/components/shell/nav";
import { StatusPanel, StatusPanelSkeleton } from "@/components/shell/status-panel";

export const metadata: Metadata = {
  title: { default: "Clothing Finder", template: "%s · Clothing Finder" },
  description: "Personal eBay clothing discovery: preferred brands, sizes and fabrics, filtered by your secondhand price ceilings.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        <MobileNav
          status={
            <Suspense fallback={<StatusPanelSkeleton />}>
              <StatusPanel />
            </Suspense>
          }
        />
        <div className="mx-auto flex w-full max-w-[1680px]">
          <aside className="sticky top-0 hidden h-dvh w-[252px] shrink-0 flex-col border-r border-line px-4 py-6 lg:flex">
            <Link href="/finder" className="px-3">
              <span className="block font-display text-[1.65rem] leading-none font-semibold tracking-tight text-ink">Clothing Finder</span>
              <span className="mt-1.5 block text-[11px] font-medium tracking-[0.14em] text-ink-3 uppercase">Personal eBay discovery</span>
            </Link>
            <div className="mt-8 flex-1 overflow-y-auto">
              <NavLinks />
            </div>
            <Suspense fallback={<StatusPanelSkeleton />}>
              <StatusPanel />
            </Suspense>
          </aside>
          <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</main>
        </div>
      </body>
    </html>
  );
}
