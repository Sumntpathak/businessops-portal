import Link from "next/link";
import { getSession } from "@/server/auth/session";
import { redirect } from "next/navigation";

const features = [
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M16 21a6 6 0 0 0-12 0" /><circle cx="10" cy="8" r="4" /><path d="M22 21a5 5 0 0 0-4-4.9" /><path d="M17 4.3a4 4 0 0 1 0 7.4" />
      </svg>
    ),
    title: "Lead Management",
    description: "Full pipeline tracking from New to Converted. Assign agents, schedule follow-ups, bulk operations, and search across all fields.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M6 2h12v20l-3-2-3 2-3-2-3 2V2Z" /><path d="M9 7h6" /><path d="M9 11h6" /><path d="M9 15h4" />
      </svg>
    ),
    title: "Invoicing & Payments",
    description: "Server-calculated totals with tax and discount. Sequential INV-YYYY-NNNN numbering. Mock payment gateway with webhook idempotency.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><circle cx="12" cy="11" r="2" /><path d="M12 13v3" /><path d="M10.5 16h3" />
      </svg>
    ),
    title: "Role-Based Access",
    description: "Four distinct roles — Admin, Manager, Agent, Finance — each with their own dashboard, permissions, and data scope. Three-layer RBAC enforcement.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
      </svg>
    ),
    title: "Follow-Up System",
    description: "Date-tagged tasks linked to leads. Due-today and overdue queues on the dashboard. Agents manage their own pipeline with status tracking.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="M9 5h6" /><path d="M9 12h6" /><path d="M9 19h6" /><path d="M5 5h.01" /><path d="M5 12h.01" /><path d="M5 19h.01" /><rect width="18" height="20" x="3" y="2" rx="2" />
      </svg>
    ),
    title: "Audit Trail",
    description: "Append-only audit logs for every business action — logins, CRUD, payments, assignments. Filterable by entity type and action.",
  },
  {
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">
        <path d="m21.4 11.6-8.5 8.5a6 6 0 0 1-8.5-8.5l8.5-8.5a4 4 0 0 1 5.7 5.7l-8.5 8.5a2 2 0 0 1-2.8-2.8l7.8-7.8" />
      </svg>
    ),
    title: "File Uploads",
    description: "Signed server-side Cloudinary uploads for leads and invoices. PDF, PNG, JPG support with 2 MB limit and MIME validation.",
  },
];

const techStack = [
  { name: "Next.js 14", detail: "App Router" },
  { name: "React 19", detail: "Server + Client" },
  { name: "TypeScript", detail: "End-to-end" },
  { name: "Tailwind CSS", detail: "Utility-first" },
  { name: "Neon PostgreSQL", detail: "Serverless" },
  { name: "Drizzle ORM", detail: "Type-safe SQL" },
  { name: "Custom JWT", detail: "httpOnly cookies" },
  { name: "Zod", detail: "Shared schemas" },
  { name: "Cloudinary", detail: "File storage" },
  { name: "Playwright", detail: "E2E tests" },
  { name: "Vercel", detail: "Deployment" },
];

const demoAccounts = [
  { role: "Admin", email: "businessops.admin@yopmail.com", password: "Admin@1234", color: "bg-blue-100 text-blue-700" },
  { role: "Manager", email: "businessops.manager@yopmail.com", password: "Manager@1234", color: "bg-emerald-100 text-emerald-700" },
  { role: "Agent", email: "businessops.agent1@yopmail.com", password: "Agent@1234", color: "bg-amber-100 text-amber-700" },
  { role: "Finance", email: "businessops.finance@yopmail.com", password: "Finance@1234", color: "bg-purple-100 text-purple-700" },
];

const stats = [
  { value: "11", label: "Database tables" },
  { value: "20+", label: "API endpoints" },
  { value: "4", label: "User roles" },
  { value: "60+", label: "Audit actions" },
];

export default async function LandingPage() {
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="min-h-dvh bg-white">
      {/* ── Nav ── */}
      <nav className="sticky top-0 z-30 border-b border-gray-100 bg-white/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3 sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid size-8 place-items-center rounded-lg bg-blue-600 text-sm font-bold text-white">B</span>
            <span className="text-base font-semibold tracking-tight text-gray-900">BusinessOps</span>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/login" className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50 hover:text-gray-900">
              Log in
            </Link>
            <Link href="/register" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700">
              Get started
            </Link>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(45%_45%_at_50%_30%,rgba(37,99,235,0.08),transparent)]" />
        <div className="mx-auto max-w-4xl px-5 pb-16 pt-20 text-center sm:px-8 sm:pb-20 sm:pt-28">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-100 bg-blue-50 px-3.5 py-1.5 text-xs font-medium text-blue-700">
            <span className="inline-block size-1.5 rounded-full bg-blue-500" />
            Full-stack Next.js project &middot; Live on Vercel
          </div>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-gray-950 sm:text-5xl lg:text-6xl">
            Operations dashboard for{" "}
            <span className="bg-gradient-to-r from-blue-600 to-blue-400 bg-clip-text text-transparent">leads, invoices &amp; payments</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-gray-500 sm:text-lg">
            A production-grade multi-role portal managing the complete lead-to-payment lifecycle — with RBAC, audit trails, mock payment webhooks, and Cloudinary file uploads.
          </p>
          <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-6 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700 hover:shadow-lg">
              Try the demo
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m9 18 6-6-6-6" /></svg>
            </Link>
            <a href="https://github.com/Sumntpathak/businessops-portal" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-6 py-3 text-sm font-semibold text-gray-700 shadow-sm transition hover:border-gray-300 hover:bg-gray-50">
              <svg viewBox="0 0 24 24" fill="currentColor" className="h-4.5 w-4.5"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-6 0-1.2.5-2.3 1.3-3.1-.2-.4-.6-1.6.1-3.2 0 0 1-.3 3.4 1.2a11.5 11.5 0 0 1 6 0c2.3-1.5 3.3-1.2 3.3-1.2.7 1.6.3 2.8.2 3.2.8.8 1.2 1.9 1.2 3.1 0 4.7-2.8 5.7-5.5 6 .5.4.9 1.2.9 2.3v3.4c0 .3.2.7.8.6A12 12 0 0 0 12 .3" /></svg>
              View source
            </a>
          </div>
        </div>
      </section>

      {/* ── Stats ── */}
      <section className="border-y border-gray-100 bg-gray-50/60">
        <div className="mx-auto grid max-w-4xl grid-cols-2 gap-6 px-5 py-10 sm:grid-cols-4 sm:px-8">
          {stats.map((stat) => (
            <div key={stat.label} className="text-center">
              <p className="text-3xl font-bold tracking-tight text-gray-950">{stat.value}</p>
              <p className="mt-1 text-sm text-gray-500">{stat.label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Features ── */}
      <section className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="mb-12 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Everything a service team needs</h2>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-gray-500 sm:text-base">End-to-end lead-to-payment workflow with role isolation, audit logging, and real-world patterns.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div key={feature.title} className="group rounded-xl border border-gray-150 bg-white p-6 shadow-sm transition hover:border-blue-200 hover:shadow-md">
              <div className="mb-4 inline-flex size-11 items-center justify-center rounded-lg bg-blue-50 text-blue-600 transition group-hover:bg-blue-100">
                {feature.icon}
              </div>
              <h3 className="mb-2 text-sm font-semibold text-gray-900">{feature.title}</h3>
              <p className="text-sm leading-relaxed text-gray-500">{feature.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Tech Stack ── */}
      <section className="border-y border-gray-100 bg-gray-50/60">
        <div className="mx-auto max-w-5xl px-5 py-14 sm:px-8 sm:py-20">
          <h2 className="mb-8 text-center text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Built with</h2>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {techStack.map((tech) => (
              <span key={tech.name} className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm shadow-sm">
                <span className="font-semibold text-gray-900">{tech.name}</span>
                <span className="text-gray-400">&middot;</span>
                <span className="text-gray-500">{tech.detail}</span>
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── Demo Credentials ── */}
      <section className="mx-auto max-w-3xl px-5 py-16 sm:px-8 sm:py-24">
        <div className="mb-10 text-center">
          <h2 className="text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Try it now</h2>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-gray-500 sm:text-base">Log in with any role to explore a different dashboard experience.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {demoAccounts.map((account) => (
            <div key={account.role} className="rounded-xl border border-gray-150 bg-white p-5 shadow-sm">
              <div className="mb-3 flex items-center gap-2.5">
                <span className={`inline-flex rounded-md px-2.5 py-1 text-xs font-semibold ${account.color}`}>{account.role}</span>
              </div>
              <p className="mb-0.5 font-mono text-sm text-gray-700">{account.email}</p>
              <p className="font-mono text-sm text-gray-400">{account.password}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 text-center">
          <Link href="/login" className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-8 py-3 text-sm font-semibold text-white shadow-md transition hover:bg-blue-700 hover:shadow-lg">
            Open login
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4"><path d="m9 18 6-6-6-6" /></svg>
          </Link>
        </div>
      </section>

      {/* ── Architecture Highlights ── */}
      <section className="border-y border-gray-100 bg-gray-50/60">
        <div className="mx-auto max-w-4xl px-5 py-14 sm:px-8 sm:py-20">
          <h2 className="mb-10 text-center text-2xl font-bold tracking-tight text-gray-950 sm:text-3xl">Under the hood</h2>
          <div className="grid gap-6 sm:grid-cols-2">
            {[
              { title: "3-Layer Auth", desc: "Edge middleware JWT verification, withAuth handler wrapper, and DB-level active-user check. __Host- cookie prefix in production." },
              { title: "Handler → Service → Repo", desc: "Clean separation: handlers parse HTTP, services enforce business rules + RBAC, repositories run pure Drizzle queries." },
              { title: "Server-Side Totals", desc: "Invoice subtotal, tax, and total are always calculated on the server. Frontend values are never trusted — prevents financial tampering." },
              { title: "Webhook Idempotency", desc: "Payment webhook uses UNIQUE constraint on transactionId. Duplicate webhooks return 'already processed' via PG error 23505 catch." },
            ].map((item) => (
              <div key={item.title} className="rounded-xl border border-gray-150 bg-white p-5 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold text-gray-900">{item.title}</h3>
                <p className="text-sm leading-relaxed text-gray-500">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-100 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-5 py-8 sm:flex-row sm:px-8">
          <div className="flex items-center gap-2.5">
            <span className="grid size-7 place-items-center rounded-md bg-blue-600 text-xs font-bold text-white">B</span>
            <span className="text-sm font-semibold text-gray-700">BusinessOps Portal</span>
          </div>
          <div className="flex items-center gap-5 text-sm text-gray-400">
            <span>Built by Sumant Pathak</span>
            <a href="https://github.com/Sumntpathak/businessops-portal" target="_blank" rel="noopener noreferrer" className="text-gray-500 transition hover:text-gray-700">GitHub</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
