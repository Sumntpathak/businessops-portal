import { redirect } from "next/navigation";
import Link from "next/link";
import { Icon, type IconName } from "@/shared/icons/Icon";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle } from "@/shared/ui";
import { getSession } from "@/server/auth/session";
import { db } from "@/server/db/client";
import { auditLogs, followups, invoices, leads } from "@/server/db/schema";
import type { Role } from "@/shared/constants";
import { and, asc, count, desc, eq, inArray, lte, notInArray, sql, sum } from "drizzle-orm";

const todayUTC = () => new Date().toISOString().split("T")[0];
const fmt = (n: string | null) => `Rs ${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 0 })}`;
const fmtDate = (date: Date | string) => new Date(date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
const qualificationStatuses: Array<"New" | "Contacted" | "Follow-Up"> = ["New", "Contacted", "Follow-Up"];

interface RecentActivity {
  id: string;
  action: string;
  entityType: string;
  createdAt: Date;
}

interface DashboardAction {
  href: string;
  icon: IconName;
  label: string;
  variant?: "primary" | "secondary" | "ghost";
}

interface DashboardMetric {
  href: string;
  label: string;
  sub: string;
  value: number | string;
}

async function getDashboardData(userId: string, role: Role) {
  const today = todayUTC();
  const isAgent = role === "agent";
  const canViewAudit = role === "admin" || role === "manager";
  const agentLeadIds = isAgent
    ? (await db.select({ id: leads.id }).from(leads).where(eq(leads.assignedTo, userId))).map((lead) => lead.id)
    : [];

  const leadScope = isAgent ? eq(leads.assignedTo, userId) : undefined;
  const followupScope = isAgent
    ? agentLeadIds.length > 0
      ? inArray(followups.leadId, agentLeadIds)
      : sql`false`
    : undefined;
  const invoiceScope = isAgent
    ? agentLeadIds.length > 0
      ? inArray(invoices.leadId, agentLeadIds)
      : sql`false`
    : undefined;
  const recentActivityQuery: Promise<RecentActivity[]> = canViewAudit
    ? db
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        createdAt: auditLogs.createdAt,
      })
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(6)
    : Promise.resolve([]);

  const [
    [{ total: totalLeads }],
    [{ total: openLeads }],
    [{ total: convertedLeads }],
    [{ total: lostLeads }],
    [{ total: totalInvoices }],
    [{ total: paidInvoices }],
    [{ revenue }],
    [{ total: followupsDueToday }],
    [{ total: qualificationCount }],
    leadQueue,
    followupQueue,
    invoiceQueue,
    recentActivity,
  ] = await Promise.all([
    db.select({ total: count() }).from(leads).where(leadScope),
    db.select({ total: count() }).from(leads).where(and(notInArray(leads.status, ["Converted", "Lost"]), leadScope)),
    db.select({ total: count() }).from(leads).where(and(eq(leads.status, "Converted"), leadScope)),
    db.select({ total: count() }).from(leads).where(and(eq(leads.status, "Lost"), leadScope)),
    db.select({ total: count() }).from(invoices).where(invoiceScope),
    db.select({ total: count() }).from(invoices).where(and(eq(invoices.status, "Paid"), invoiceScope)),
    db.select({ revenue: sum(invoices.totalAmount) }).from(invoices).where(and(eq(invoices.status, "Paid"), invoiceScope)),
    db.select({ total: count() }).from(followups).where(and(eq(followups.followUpDate, today), eq(followups.status, "Pending"), followupScope)),
    db.select({ total: count() }).from(leads).where(and(inArray(leads.status, qualificationStatuses), leadScope)),
    db
      .select({
        id: leads.id,
        name: leads.name,
        company: leads.company,
        source: leads.source,
        status: leads.status,
      })
      .from(leads)
      .where(and(inArray(leads.status, qualificationStatuses), leadScope))
      .orderBy(desc(leads.updatedAt))
      .limit(6),
    db
      .select({
        id: followups.id,
        leadId: followups.leadId,
        leadName: leads.name,
        message: followups.message,
        followUpDate: followups.followUpDate,
      })
      .from(followups)
      .innerJoin(leads, eq(followups.leadId, leads.id))
      .where(and(eq(followups.status, "Pending"), lte(followups.followUpDate, today), followupScope))
      .orderBy(asc(followups.followUpDate))
      .limit(6),
    db
      .select({
        id: invoices.id,
        invoiceNumber: invoices.invoiceNumber,
        clientName: invoices.clientName,
        status: invoices.status,
        totalAmount: invoices.totalAmount,
      })
      .from(invoices)
      .where(and(inArray(invoices.status, ["Draft", "Sent"]), invoiceScope))
      .orderBy(desc(invoices.updatedAt))
      .limit(6),
    recentActivityQuery,
  ]);

  return {
    leads: { total: totalLeads, open: openLeads, converted: convertedLeads, lost: lostLeads },
    invoices: { total: totalInvoices, paid: paidInvoices, unpaid: totalInvoices - paidInvoices, revenue: revenue ?? "0" },
    followupsDueToday,
    qualificationCount,
    leadQueue,
    followupQueue,
    invoiceQueue,
    recentActivity,
  };
}

function roleIntro(role: Role) {
  const copy: Record<Role, { label: string; description: string }> = {
    admin: {
      label: "Admin command center",
      description: "Review the full workspace, keep teams moving, and jump into user, lead, invoice, or audit work quickly.",
    },
    manager: {
      label: "Manager pipeline desk",
      description: "Track team movement, qualify open leads, assign work, and keep follow-ups visible without admin-only controls.",
    },
    agent: {
      label: "Agent work queue",
      description: "Focus on your assigned leads, pending follow-ups, and the next conversations that move your pipeline forward.",
    },
    finance: {
      label: "Finance billing desk",
      description: "Review invoice volume, paid revenue, unpaid work, and billing-ready lead context from one focused view.",
    },
  };
  return copy[role];
}

function heroActions(role: Role): DashboardAction[] {
  const actions: Record<Role, DashboardAction[]> = {
    admin: [
      { href: "/invoices/new", icon: "plus", label: "New invoice", variant: "secondary" },
      { href: "/leads/new", icon: "plus", label: "New lead" },
    ],
    manager: [
      { href: "/leads?status=New", icon: "users", label: "Qualify leads", variant: "secondary" },
      { href: "/leads/new", icon: "plus", label: "New lead" },
    ],
    agent: [
      { href: "/followups?due=today", icon: "clock", label: "Today follow-ups", variant: "secondary" },
      { href: "/leads", icon: "users", label: "My leads" },
    ],
    finance: [
      { href: "/invoices?status=Sent", icon: "creditCard", label: "Collect sent invoices", variant: "secondary" },
      { href: "/invoices/new", icon: "plus", label: "New invoice" },
    ],
  };
  return actions[role];
}

function shortcuts(role: Role): DashboardAction[] {
  const items: Record<Role, DashboardAction[]> = {
    admin: [
      { href: "/users", icon: "user", label: "Manage users" },
      { href: "/settings", icon: "settings", label: "Workspace settings" },
      { href: "/audit-logs", icon: "audit", label: "Audit logs" },
      { href: "/invoices", icon: "invoice", label: "Invoices" },
    ],
    manager: [
      { href: "/leads?status=Follow-Up", icon: "clock", label: "Follow-up leads" },
      { href: "/leads", icon: "users", label: "Assign leads" },
      { href: "/invoices/new", icon: "invoice", label: "Create invoice" },
      { href: "/users", icon: "user", label: "View users" },
    ],
    agent: [
      { href: "/followups?due=today", icon: "calendar", label: "Due today" },
      { href: "/followups?due=overdue", icon: "clock", label: "Overdue follow-ups" },
      { href: "/leads?status=Contacted", icon: "phone", label: "Contacted leads" },
      { href: "/settings", icon: "settings", label: "My profile" },
    ],
    finance: [
      { href: "/invoices?status=Draft", icon: "invoice", label: "Draft invoices" },
      { href: "/invoices?status=Sent", icon: "send", label: "Sent invoices" },
      { href: "/leads?status=Converted", icon: "users", label: "Billing leads" },
      { href: "/settings", icon: "settings", label: "My profile" },
    ],
  };
  return items[role];
}

function metricsFor(role: Role, data: Awaited<ReturnType<typeof getDashboardData>>): DashboardMetric[] {
  const metrics: Record<Role, DashboardMetric[]> = {
    admin: [
      { label: "Total leads", value: data.leads.total, sub: `${data.leads.open} still open`, href: "/leads" },
      { label: "Converted", value: data.leads.converted, sub: `${data.leads.lost} lost`, href: "/leads?status=Converted" },
      { label: "Paid invoices", value: data.invoices.paid, sub: `${data.invoices.unpaid} still pending`, href: "/invoices" },
      { label: "Collected revenue", value: fmt(data.invoices.revenue), sub: "From paid invoices", href: "/invoices?status=Paid" },
    ],
    manager: [
      { label: "Open team leads", value: data.leads.open, sub: `${data.leads.total} total team leads`, href: "/leads" },
      { label: "Needs qualification", value: data.qualificationCount, sub: "New, contacted, and follow-up", href: "/leads?status=New" },
      { label: "Due today", value: data.followupsDueToday, sub: "Team follow-ups", href: "/followups?due=today" },
      { label: "Converted", value: data.leads.converted, sub: "Revenue-ready leads", href: "/leads?status=Converted" },
    ],
    agent: [
      { label: "My leads", value: data.leads.total, sub: `${data.leads.open} open for action`, href: "/leads" },
      { label: "Due today", value: data.followupsDueToday, sub: "Assigned follow-ups", href: "/followups?due=today" },
      { label: "Converted", value: data.leads.converted, sub: "My wins", href: "/leads?status=Converted" },
      { label: "Linked invoices", value: data.invoices.total, sub: "For my assigned leads", href: "/invoices" },
    ],
    finance: [
      { label: "Total invoices", value: data.invoices.total, sub: "All billing records", href: "/invoices" },
      { label: "Paid invoices", value: data.invoices.paid, sub: "Verified as collected", href: "/invoices?status=Paid" },
      { label: "Unpaid invoices", value: data.invoices.unpaid, sub: "Draft, sent, or pending", href: "/invoices?status=Sent" },
      { label: "Collected revenue", value: fmt(data.invoices.revenue), sub: "Paid invoice total", href: "/invoices?status=Paid" },
    ],
  };
  return metrics[role];
}

function Metric({ href, label, sub, value }: DashboardMetric) {
  return (
    <Link
      href={href}
      className="group block min-w-0 rounded-lg border border-gray-200 bg-white p-4 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/20 sm:p-5"
    >
      <p className="break-words text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 break-words text-2xl font-semibold leading-tight tracking-tight text-gray-950 sm:text-3xl">{value}</p>
      <p className="mt-1 break-words text-xs text-gray-500">{sub}</p>
    </Link>
  );
}

function ShortcutGrid({ items }: { items: DashboardAction[] }) {
  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <Link
          key={`${item.href}-${item.label}`}
          href={item.href}
          className="flex min-w-0 items-center gap-3 rounded-lg border border-gray-200 bg-white p-4 text-sm font-semibold text-gray-800 shadow-sm transition hover:border-blue-200 hover:bg-blue-50/30"
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-gray-50 text-blue-600">
            <Icon name={item.icon} />
          </span>
          <span className="min-w-0 truncate">{item.label}</span>
        </Link>
      ))}
    </section>
  );
}

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const data = await getDashboardData(session.sub, session.role);
  const firstName = session.name.split(" ")[0];
  const intro = roleIntro(session.role);
  const metrics = metricsFor(session.role, data);

  return (
    <div className="space-y-6 sm:space-y-8">
      <section className="flex min-w-0 flex-col gap-5 border-b border-gray-100 pb-6 sm:pb-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <Badge className="capitalize">{intro.label}</Badge>
          <h1 className="mt-4 break-words text-2xl font-semibold leading-tight tracking-tight text-gray-950 sm:text-3xl">
            Good to see you, {firstName}.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-500">{intro.description}</p>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:gap-3">
          {heroActions(session.role).map((action) => (
            <Button key={action.label} href={action.href} variant={action.variant ?? "primary"}>
              <Icon name={action.icon} className={action.variant === "secondary" ? "text-gray-500" : undefined} />
              {action.label}
            </Button>
          ))}
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => <Metric key={metric.label} {...metric} />)}
      </section>

      <ShortcutGrid items={shortcuts(session.role)} />

      {session.role !== "finance" && (
        <Card className="shadow-sm">
          <CardHeader>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
              <CardTitle>{session.role === "agent" ? "My pipeline health" : "Pipeline health"}</CardTitle>
              <Button href="/leads" variant="ghost" size="sm">{session.role === "agent" ? "Open my leads" : "Open leads"}</Button>
            </div>
          </CardHeader>
          <CardBody>
            <div className="grid gap-5 lg:grid-cols-3">
              {[
                ["Open", data.leads.open, "bg-blue-600", "Needs movement"],
                ["Converted", data.leads.converted, "bg-emerald-500", "Revenue path"],
                ["Lost", data.leads.lost, "bg-red-500", "Needs review"],
              ].map(([label, value, color, note]) => {
                const percent = data.leads.total ? Math.round((Number(value) / data.leads.total) * 100) : 0;
                return (
                  <div key={label} className="rounded-lg border border-gray-100 bg-gray-50/70 p-4">
                    <div className="mb-3 flex items-center justify-between text-sm">
                      <span className="font-semibold text-gray-800">{label}</span>
                      <span className="text-gray-500">{percent}%</span>
                    </div>
                    <div className="h-2 rounded-full bg-white">
                      <div className={`h-2 rounded-full ${color}`} style={{ width: `${percent}%` }} />
                    </div>
                    <div className="mt-3 flex items-end justify-between gap-3">
                      <p className="text-xs text-gray-500">{note}</p>
                      <p className="text-xl font-semibold tracking-tight text-gray-950 sm:text-2xl">{value}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardBody>
        </Card>
      )}

      <section className="grid gap-4 lg:grid-cols-2">
        {session.role === "finance" ? (
          <Card className="shadow-sm">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <CardTitle>Billing queue</CardTitle>
                  <p className="mt-1 text-sm text-gray-500">{data.invoiceQueue.length} draft or sent invoices need finance attention.</p>
                </div>
                <Button href="/invoices" variant="ghost" size="sm">Open invoices</Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {data.invoiceQueue.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">No draft or sent invoices waiting.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {data.invoiceQueue.map((invoice) => (
                    <li key={invoice.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <Link href={`/invoices/${invoice.id}`} className="truncate text-sm font-semibold text-gray-900 hover:text-blue-700">
                          {invoice.invoiceNumber}
                        </Link>
                        <p className="truncate text-xs text-gray-500">{invoice.clientName}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <Badge>{invoice.status}</Badge>
                        <p className="mt-1 text-xs font-medium text-gray-500">{fmt(invoice.totalAmount)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ) : (
          <Card className="shadow-sm">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <CardTitle>{session.role === "agent" ? "My leads needing action" : "Leads needing qualification"}</CardTitle>
                  <p className="mt-1 text-sm text-gray-500">{data.qualificationCount} active leads need movement.</p>
                </div>
                <Button href="/leads?status=New" variant="ghost" size="sm">View leads</Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {data.leadQueue.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">No leads waiting for qualification.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {data.leadQueue.map((lead) => (
                    <li key={lead.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <Link href={`/leads/${lead.id}`} className="truncate text-sm font-semibold text-gray-900 hover:text-blue-700">
                          {lead.name}
                        </Link>
                        <p className="truncate text-xs text-gray-500">{lead.company ?? lead.source}</p>
                      </div>
                      <Badge className="shrink-0">{lead.status}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        )}

        {session.role === "admin" || session.role === "manager" ? (
          <Card className="shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>Recent activity</CardTitle>
                  <p className="mt-1 text-sm text-gray-500">Latest auditable workspace actions.</p>
                </div>
                <Button href="/audit-logs" variant="ghost" size="sm">View all</Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {data.recentActivity.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">No recent audit activity.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {data.recentActivity.map((activity) => (
                    <li key={activity.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-gray-900">{activity.action}</p>
                        <p className="truncate text-xs text-gray-500">{activity.entityType}</p>
                      </div>
                      <p className="shrink-0 text-xs font-medium text-gray-500">{fmtDate(activity.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        ) : (
          <Card className="shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <CardTitle>{session.role === "finance" ? "Converted lead context" : "Pending follow-ups"}</CardTitle>
                  <p className="mt-1 text-sm text-gray-500">
                    {session.role === "finance"
                      ? "Read-only lead visibility for billing handoff."
                      : data.followupsDueToday > 0
                        ? `${data.followupsDueToday} due today.`
                        : "No follow-ups due today."}
                  </p>
                </div>
                <Button href={session.role === "finance" ? "/leads?status=Converted" : "/followups?due=today"} variant={data.followupsDueToday > 0 ? "primary" : "ghost"} size="sm">
                  {session.role === "finance" ? "View leads" : "View queue"}
                </Button>
              </div>
            </CardHeader>
            <CardBody className="p-0">
              {session.role === "finance" ? (
                data.leadQueue.length === 0 ? (
                  <div className="px-5 py-8 text-center text-sm text-gray-400">No billing lead context available.</div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {data.leadQueue.map((lead) => (
                      <li key={lead.id} className="flex items-center justify-between gap-4 px-5 py-3">
                        <div className="min-w-0">
                          <Link href={`/leads/${lead.id}`} className="truncate text-sm font-semibold text-gray-900 hover:text-blue-700">
                            {lead.name}
                          </Link>
                          <p className="truncate text-xs text-gray-500">{lead.company ?? lead.source}</p>
                        </div>
                        <Badge className="shrink-0">{lead.status}</Badge>
                      </li>
                    ))}
                  </ul>
                )
              ) : data.followupQueue.length === 0 ? (
                <div className="px-5 py-8 text-center text-sm text-gray-400">Nothing overdue or due today.</div>
              ) : (
                <ul className="divide-y divide-gray-100">
                  {data.followupQueue.map((item) => (
                    <li key={item.id} className="flex items-center justify-between gap-4 px-5 py-3">
                      <div className="min-w-0">
                        <Link href={`/leads/${item.leadId}`} className="truncate text-sm font-semibold text-gray-900 hover:text-blue-700">
                          {item.leadName}
                        </Link>
                        <p className="truncate text-xs text-gray-500">{item.message}</p>
                      </div>
                      <p className="shrink-0 text-xs font-medium text-gray-500">
                        {fmtDate(item.followUpDate)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        )}
      </section>
    </div>
  );
}
