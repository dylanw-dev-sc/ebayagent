import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedView } from "@/components/finder/feed-view";
import { GridSkeleton, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Product Finder" };

export default function FinderPage({ searchParams }: PageProps<"/finder">) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Engine 1"
        title="Product Finder"
        description="New eBay listings from your preferred brands, judged against your sizes, fabrics and conditions — with the reason for every decision."
      />
      <Suspense fallback={<GridSkeleton />}>
        <FeedView basePath="/finder" searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
