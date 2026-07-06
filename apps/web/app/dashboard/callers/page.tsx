import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { z } from "zod";
import { schema, withTenant } from "@recepto/db";
import { requireTenant } from "@/lib/auth-helpers";
import { db } from "@/lib/db";

const stageSchema = z.enum(["new", "interested", "booked", "client"]);
const stages = stageSchema.options;

function lastFour(phone: string) {
  return "????" + phone.slice(-4);
}

export default async function CallersPage({
  searchParams
}: {
  searchParams: { stage?: string };
}) {
  const parsedStage = searchParams.stage ? stageSchema.safeParse(searchParams.stage) : null;
  if (parsedStage && !parsedStage.success) notFound();

  const context = await requireTenant();
  const scoped = withTenant(db, context.tenantId);
  const callers = await db
    .select({
      id: schema.callers.id,
      displayName: schema.callers.displayName,
      phoneE164: schema.callers.phoneE164,
      country: schema.callers.country,
      stage: schema.callers.stage,
      updatedAt: schema.callers.updatedAt
    })
    .from(schema.callers)
    .where(
      scoped.where(
        schema.callers,
        parsedStage?.success ? eq(schema.callers.stage, parsedStage.data) : undefined
      )
    )
    .orderBy(desc(schema.callers.updatedAt))
    .limit(200);

  return (
    <section>
      <p className="text-sm text-muted-foreground">Relationship history</p>
      <h1 className="mt-2 text-3xl font-semibold tracking-tight">Callers</h1>
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href="/dashboard/callers" className={"rounded-full border px-3 py-1.5 text-sm " + (!parsedStage ? "bg-foreground text-background" : "")}>All</Link>
        {stages.map((stage) => (
          <Link key={stage} href={"/dashboard/callers?stage=" + stage} className={"rounded-full border px-3 py-1.5 text-sm capitalize " + (parsedStage?.success && parsedStage.data === stage ? "bg-foreground text-background" : "")}>
            {stage}
          </Link>
        ))}
      </div>

      <div className="mt-6 overflow-hidden rounded-xl border">
        {callers.length === 0 ? (
          <p className="p-12 text-center text-sm text-muted-foreground">No callers match this stage.</p>
        ) : (
          <div className="divide-y">
            {callers.map((caller) => (
              <Link key={caller.id} href={"/dashboard/callers/" + caller.id} className="flex flex-wrap items-center justify-between gap-4 p-5 transition hover:bg-muted/30">
                <div>
                  <p className="font-medium">{caller.displayName ?? lastFour(caller.phoneE164)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{caller.country ?? "Country unknown"} ? {lastFour(caller.phoneE164)}</p>
                </div>
                <div className="text-right">
                  <span className="rounded-full border px-2.5 py-1 text-xs capitalize">{caller.stage}</span>
                  <p className="mt-2 text-xs text-muted-foreground">Updated {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(caller.updatedAt)}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
