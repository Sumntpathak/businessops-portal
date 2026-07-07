"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

type JobStatus = "queued" | "crawling" | "distilling" | "ready_for_review" | "failed";
interface Service { id?: string; name: string; durationMinutes: number; price: string | null; description: string; active: boolean; }
interface BusinessHour { weekday: number; opens: string; closes: string; closed: boolean; }
interface AgentStatus {
  tenantStatus: string;
  job: { status: JobStatus; error: string | null; crawlResult: Array<{ url: string; title: string; text: string }> | null } | null;
  profile: { agentMd: string; version: number; source: "auto" | "manual" } | null;
  services: Service[];
  businessHours: BusinessHour[];
  revisions: Array<{ id: string; version: number; createdAt: string }>;
  googleCalendarConnected: boolean;
}

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const defaultHours = (): BusinessHour[] => weekdays.map((_, weekday) => ({
  weekday, opens: "09:00:00", closes: "17:00:00", closed: weekday === 0
}));

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "Something went wrong.";
}

export function AgentReview() {
  const [status, setStatus] = useState<AgentStatus>();
  const [agentMd, setAgentMd] = useState("");
  const [services, setServices] = useState<Service[]>([]);
  const [hours, setHours] = useState<BusinessHour[]>(defaultHours);
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState<string>();
  const initialized = useRef(false);
  const editorDirty = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/agent/status", { cache: "no-store" });
    if (!response.ok) { setMessage(await responseError(response)); return; }
    const body = (await response.json()) as { data: AgentStatus };
    setStatus(body.data);
    if (!initialized.current) {
      setAgentMd(body.data.profile?.agentMd ?? "");
      setServices(body.data.services);
      setHours(body.data.businessHours.length === 7 ? body.data.businessHours : defaultHours());
      initialized.current = true;
    } else if (!editorDirty.current && body.data.profile?.agentMd) {
      setAgentMd(body.data.profile.agentMd);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 3_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function saveProfile() {
    setPending("profile"); setMessage(undefined);
    const response = await fetch("/api/agent/profile", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ agentMd })
    });
    setPending(undefined);
    if (!response.ok) { setMessage(await responseError(response)); return; }
    editorDirty.current = false; setMessage("agent.md saved as a new revision."); await load();
  }

  async function restoreRevision(revisionId: string) {
    setPending(revisionId); setMessage(undefined);
    const response = await fetch("/api/agent/revisions/restore", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ revisionId })
    });
    setPending(undefined);
    if (!response.ok) { setMessage(await responseError(response)); return; }
    const body = (await response.json()) as { data: { agentMd: string } };
    setAgentMd(body.data.agentMd); editorDirty.current = false;
    setMessage("Revision restored into a new version."); await load();
  }

  async function saveServices() {
    setPending("services"); setMessage(undefined);
    const response = await fetch("/api/agent/services", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ services })
    });
    setPending(undefined);
    if (!response.ok) { setMessage(await responseError(response)); return; }
    setMessage("Services saved."); initialized.current = false; await load();
  }

  async function saveHours() {
    setPending("hours"); setMessage(undefined);
    const response = await fetch("/api/agent/business-hours", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ hours })
    });
    setPending(undefined);
    if (!response.ok) { setMessage(await responseError(response)); return; }
    setMessage("Business hours saved.");
  }

  async function goLive() {
    setPending("live"); setMessage(undefined);
    const response = await fetch("/api/agent/go-live", { method: "POST" });
    setPending(undefined);
    if (!response.ok) { setMessage(await responseError(response)); return; }
    setMessage("Your receptionist is live."); await load();
  }

  function updateService(index: number, patch: Partial<Service>) {
    setServices((current) => current.map((service, i) => i === index ? { ...service, ...patch } : service));
  }
  function updateHours(index: number, patch: Partial<BusinessHour>) {
    setHours((current) => current.map((entry, i) => i === index ? { ...entry, ...patch } : entry));
  }

  const crawlPages = status?.job?.crawlResult?.length ?? 0;
  const reviewReady = Boolean(status?.profile);
  const statusLabel = status?.job?.status?.replaceAll("_", " ") ?? "waiting";

  if (!status) {
    return (
      <div className="space-y-8">
        <section className="flex flex-col justify-between gap-4 rounded-xl border bg-muted/10 p-5 sm:flex-row sm:items-center">
          <div className="space-y-2">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-7 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-10 w-28 rounded-md" />
        </section>
        <div className="grid overflow-hidden rounded-xl border lg:grid-cols-2">
          <div className="min-h-[560px] space-y-3 border-b p-5 lg:border-b-0 lg:border-r">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/6" />
          </div>
          <div className="min-h-[560px] space-y-3 p-6">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-3/6" />
          </div>
        </div>
        <section className="rounded-xl border p-5">
          <Skeleton className="h-6 w-32" />
          <div className="mt-4 space-y-3">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <section className="flex flex-col justify-between gap-4 rounded-xl border bg-muted/10 p-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Onboarding status</p>
          <h1 className="mt-2 text-2xl font-semibold capitalize">{statusLabel}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {crawlPages > 0 ? crawlPages + " website pages collected." : "The worker is preparing your draft."}
          </p>
          {status?.job?.error ? <p role="alert" className="mt-2 text-sm text-red-400">{status.job.error}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border px-3 py-1 text-xs capitalize">Tenant: {status?.tenantStatus ?? "onboarding"}</span>
          <Button onClick={goLive} disabled={!reviewReady || pending === "live"}>{pending === "live" ? "Checking…" : "Go Live"}</Button>
        </div>
      </section>

      {message ? <p role="status" className="rounded-lg border bg-muted/20 px-4 py-3 text-sm">{message}</p> : null}

      <section>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Agent instructions</h2>
            <p className="mt-1 text-sm text-muted-foreground">Version {status?.profile?.version ?? "—"} · {status?.profile?.source ?? "waiting for draft"}</p>
          </div>
          <Button onClick={saveProfile} disabled={!reviewReady || pending === "profile"}>{pending === "profile" ? "Saving…" : "Save revision"}</Button>
        </div>
        <div className="grid overflow-hidden rounded-xl border lg:grid-cols-2">
          <textarea
            aria-label="agent.md editor" value={agentMd}
            onChange={(event) => { editorDirty.current = true; setAgentMd(event.target.value); }}
            disabled={!reviewReady} spellCheck={false}
            className="min-h-[560px] resize-y border-b bg-zinc-950 p-5 font-mono text-sm leading-6 outline-none lg:border-b-0 lg:border-r"
            placeholder="The generated agent.md draft will appear here."
          />
          <div className="min-h-[560px] overflow-auto bg-background p-6">
            <p className="mb-6 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">Preview</p>
            <article className="space-y-4 text-sm leading-7 [&_h1]:text-3xl [&_h1]:font-semibold [&_h2]:mt-7 [&_h2]:text-xl [&_h2]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:text-muted-foreground">
              <ReactMarkdown>{agentMd || "_Draft not ready._"}</ReactMarkdown>
            </article>
          </div>
        </div>
      </section>

      <section className="rounded-xl border p-5">
        <div className="mb-5 flex items-center justify-between">
          <div><h2 className="text-xl font-semibold">Services</h2><p className="mt-1 text-sm text-muted-foreground">Review durations, prices, and descriptions.</p></div>
          <div className="flex gap-2">
            <Button variant="outline" type="button" onClick={() => setServices((current) => [...current, { name: "", durationMinutes: 30, price: null, description: "", active: true }])}>Add service</Button>
            <Button onClick={saveServices} disabled={services.length === 0 || pending === "services"}>Save</Button>
          </div>
        </div>
        <div className="space-y-3">
          {services.length === 0 ? <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Services will appear after distillation.</p> :
            services.map((service, index) => (
              <div key={service.id ?? index} className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1.4fr_100px_120px_2fr_auto]">
                <input value={service.name} onChange={(event) => updateService(index, { name: event.target.value })} placeholder="Service name" className="h-10 rounded-md border bg-background px-3 text-sm" />
                <input value={service.durationMinutes} onChange={(event) => updateService(index, { durationMinutes: Number(event.target.value) })} type="number" min={5} max={480} className="h-10 rounded-md border bg-background px-3 text-sm" />
                <input value={service.price ?? ""} onChange={(event) => updateService(index, { price: event.target.value || null })} inputMode="decimal" placeholder="Price" className="h-10 rounded-md border bg-background px-3 text-sm" />
                <input value={service.description} onChange={(event) => updateService(index, { description: event.target.value })} placeholder="Description" className="h-10 rounded-md border bg-background px-3 text-sm" />
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={service.active} onChange={(event) => updateService(index, { active: event.target.checked })} /> Active</label>
              </div>
            ))}
        </div>
      </section>

      <section className="rounded-xl border p-5">
        <div className="mb-5 flex items-center justify-between">
          <div><h2 className="text-xl font-semibold">Business hours</h2><p className="mt-1 text-sm text-muted-foreground">Times use the business timezone.</p></div>
          <Button onClick={saveHours} disabled={pending === "hours"}>Save hours</Button>
        </div>
        <div className="divide-y rounded-lg border">
          {hours.map((entry, index) => (
            <div key={entry.weekday} className="grid items-center gap-3 p-3 sm:grid-cols-[140px_1fr_1fr_100px]">
              <span className="text-sm font-medium">{weekdays[entry.weekday]}</span>
              <input type="time" value={entry.opens.slice(0, 5)} disabled={entry.closed} onChange={(event) => updateHours(index, { opens: event.target.value + ":00" })} className="h-9 rounded-md border bg-background px-3 text-sm disabled:opacity-40" />
              <input type="time" value={entry.closes.slice(0, 5)} disabled={entry.closed} onChange={(event) => updateHours(index, { closes: event.target.value + ":00" })} className="h-9 rounded-md border bg-background px-3 text-sm disabled:opacity-40" />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={entry.closed} onChange={(event) => updateHours(index, { closed: event.target.checked })} /> Closed</label>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border p-5">
        <h2 className="text-xl font-semibold">Revision history</h2>
        <div className="mt-4 divide-y">
          {status?.revisions.length ? status.revisions.map((revision) => (
            <div key={revision.id} className="flex items-center justify-between py-3">
              <div><p className="text-sm font-medium">Version {revision.version}</p><p className="text-xs text-muted-foreground">{new Date(revision.createdAt).toLocaleString()}</p></div>
              <Button variant="outline" onClick={() => restoreRevision(revision.id)} disabled={pending === revision.id}>Restore</Button>
            </div>
          )) : <p className="py-8 text-center text-sm text-muted-foreground">No saved revisions yet.</p>}
        </div>
      </section>

      {!status?.googleCalendarConnected ? <p className="text-sm text-amber-300">Go Live remains locked until Google Calendar is connected in Settings.</p> : null}
    </div>
  );
}
