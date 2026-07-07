import { Skeleton } from "@/components/ui/skeleton";

export default function CallDetailLoading() {
  return (
    <section className="mx-auto max-w-4xl">
      <Skeleton className="h-4 w-28" />
      <div className="mt-5 flex flex-wrap items-end justify-between gap-4">
        <div>
          <Skeleton className="h-4 w-24" />
          <Skeleton className="mt-2 h-8 w-52" />
        </div>
        <div className="space-y-2 text-right">
          <Skeleton className="ml-auto h-4 w-20" />
          <Skeleton className="ml-auto h-3 w-32" />
        </div>
      </div>

      <section className="mt-8 rounded-xl border">
        <div className="border-b p-5">
          <Skeleton className="h-5 w-28" />
        </div>
        <ol className="space-y-5 p-5">
          {Array.from({ length: 6 }, (_, index) => (
            <li key={index} className={index % 2 === 1 ? "ml-auto max-w-[85%]" : "max-w-[85%]"}>
              <Skeleton className="mb-2 h-3 w-24" />
              <Skeleton className="h-12 w-80 max-w-full rounded-lg" />
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
