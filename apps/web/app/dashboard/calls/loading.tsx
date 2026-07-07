import { PageHeaderSkeleton, ListRowsSkeleton } from "@/components/dashboard/page-skeleton";

export default function CallsLoading() {
  return (
    <section>
      <PageHeaderSkeleton />
      <div className="mt-8 overflow-hidden rounded-xl border">
        <ListRowsSkeleton count={8} />
      </div>
    </section>
  );
}
