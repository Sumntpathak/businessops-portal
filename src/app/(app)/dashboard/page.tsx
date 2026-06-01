import { redirect } from "next/navigation";
import { Badge, Button, Card, CardBody, CardHeader } from "@/components/ui";
import { getSession } from "@/lib/auth/session";

const metrics = [
  { label: "Leads in motion", value: "Connect data", detail: "Ready for /api/dashboard" },
  { label: "Follow-ups due", value: "Today", detail: "Shows assigned callbacks" },
  { label: "Invoices pending", value: "Review", detail: "Drafts and sent invoices" },
  { label: "Revenue collected", value: "Webhook-led", detail: "Paid only from payment events" },
];

const setupItems = [
  "Push schema to Neon with npm run db:push",
  "Seed realistic users and first customers",
  "Wire the dashboard API into these cards",
];

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <Badge className="capitalize">{session.role} workspace</Badge>
            <h1 className="mt-4 text-3xl font-semibold tracking-tight text-slate-950">
              Good to see you, {session.name.split(" ")[0]}.
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
              This board is ready for live operational data. The structure is intentionally
              plain: teams can scan what needs attention without decorative noise.
            </p>
          </div>
          <div className="flex gap-3">
            <Button variant="secondary">Export report</Button>
            <Button>New lead</Button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardBody>
              <p className="text-sm font-medium text-slate-500">{metric.label}</p>
              <p className="mt-3 text-2xl font-semibold text-slate-950">{metric.value}</p>
              <p className="mt-1 text-sm text-slate-500">{metric.detail}</p>
            </CardBody>
          </Card>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_0.8fr]">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Follow-ups due today</h2>
                <p className="mt-1 text-sm text-slate-500">
                  No live follow-up feed is connected yet.
                </p>
              </div>
              <Badge>Next API</Badge>
            </div>
          </CardHeader>
          <CardBody>
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-center">
              <p className="text-sm font-semibold text-slate-800">Connect the dashboard endpoint</p>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">
                Once /api/dashboard returns lead, invoice, and follow-up data, this area can show
                the next calls your team needs to make.
              </p>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <h2 className="text-base font-semibold text-slate-950">Production checklist</h2>
            <p className="mt-1 text-sm text-slate-500">The next practical steps from review.</p>
          </CardHeader>
          <CardBody>
            <ol className="space-y-3">
              {setupItems.map((item, index) => (
                <li key={item} className="flex gap-3 text-sm text-slate-600">
                  <span className="grid size-6 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                    {index + 1}
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </section>
    </div>
  );
}
