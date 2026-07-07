import { Skeleton } from "@/components/ui/skeleton";

export default function BookingsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-2">
          <Skeleton className="h-3 w-32" />
          <Skeleton className="h-7 w-28" />
        </div>
        <Skeleton className="h-9 w-32 rounded-md" />
      </div>

      <section className="overflow-x-auto rounded-lg border">
        <div className="grid min-w-[840px] grid-cols-7">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="min-h-44 border-r p-3 last:border-r-0">
              <Skeleton className="mb-3 h-4 w-20" />
              <Skeleton className="h-14 w-full rounded-md" />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border p-5">
        <Skeleton className="h-5 w-24" />
        <div className="mt-4 space-y-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="flex items-center justify-between gap-3 py-1">
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-36" />
              </div>
              <Skeleton className="h-4 w-12" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
