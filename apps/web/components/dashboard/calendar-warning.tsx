import Link from "next/link";
import { schema, withTenant } from "@recepto/db";
import { db } from "@/lib/db";

export async function CalendarWarning({ tenantId }: { tenantId: string }) {
  const scoped = withTenant(db, tenantId);
  const [connection] = await db
    .select({ status: schema.googleConnections.status })
    .from(schema.googleConnections)
    .where(scoped.where(schema.googleConnections))
    .limit(1);

  if (connection?.status !== "revoked") {
    return null;
  }

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 px-5 py-3 text-sm text-amber-200 sm:px-8">
      Google Calendar authorization expired.{" "}
      <Link href="/dashboard/settings" className="font-semibold underline">
        Reconnect in Settings
      </Link>
      .
    </div>
  );
}
