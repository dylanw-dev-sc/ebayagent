import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedView } from "@/components/finder/feed-view";
import { GridSkeleton, PageHeader } from "@/components/ui";

export const metadata: Metadata = { title: "Saved Items" };

export default function SavedPage({ searchParams }: PageProps<"/saved">) {
  return (
    <div className="space-y-6">
      <PageHeader title="Saved Items" description="Listings you saved. Saved marks persist across sessions and repeat scans." />
      <Suspense fallback={<GridSkeleton />}>
        <FeedView basePath="/saved" searchParams={searchParams} fixedView="saved" />
      </Suspense>
    </div>
  );
}
