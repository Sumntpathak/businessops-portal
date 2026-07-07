import { PageHeaderSkeleton, StatCardsSkeleton, ListRowsSkeleton } from "@/components/dashboard/page-skeleton";
import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <section>
      <PageHeaderSkeleton />
      <StatCardsSkeleton count={3} />

      <section className="mt-8 rounded-xl border">
        <div className="border-b p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-3 w-56" />
        </div>
        <ListRowsSkeleton count={5} />
      </section>
    </section>
  );
}
