import type { ReactNode } from "react";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { CalendarWarning } from "@/components/dashboard/calendar-warning";
import { requireTenant } from "@/lib/auth-helpers";

export default async function DashboardLayout({
  children
}: {
  children: ReactNode;
}) {
  const context = await requireTenant();

  return (
    <div className="flex h-dvh overflow-hidden">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          activeTenant={context.tenant}
          memberships={context.memberships}
          userName={context.user.name}
        />
        <CalendarWarning tenantId={context.tenantId} />
        <main className="flex-1 overflow-y-auto p-5 sm:p-8">{children}</main>
      </div>
    </div>
  );
}
