"use client";

import { addDays, format } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type OverrideKind = "day_hours" | "block" | "add";
type Override = {
  id: string;
  kind: OverrideKind;
  date: string;
  opens: string | null;
  closes: string | null;
  closed: boolean | null;
  startsAt: string | null;
  endsAt: string | null;
  note: string;
};
type ApiError = { error?: { message?: string } };

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}

const kindLabel: Record<OverrideKind, string> = {
  day_hours: "Day hours",
  block: "Blocked",
  add: "Extra slot"
};

const kindBadgeClass: Record<OverrideKind, string> = {
  day_hours: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  block: "bg-red-500/10 text-red-600 dark:text-red-400",
  add: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
};

/**
 * Admin-managed date/time overrides layered on top of the weekly business
 * hours template. These are the ONLY way to change a specific date's
 * availability by hand — the voice agent's slot lookup always applies them
 * ahead of the mechanically generated default, so this panel is the real
 * source of truth for anything date-specific (holidays, one-off closures,
 * extra hours).
 */
export function AvailabilityOverrides({ timezone }: { timezone: string }) {
  const [rangeStart, setRangeStart] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [kind, setKind] = useState<OverrideKind>("block");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [closed, setClosed] = useState(false);
  const [opens, setOpens] = useState("09:00");
  const [closes, setCloses] = useState("17:00");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const rangeEnd = useMemo(
    () => format(addDays(new Date(`${rangeStart}T00:00:00`), 13), "yyyy-MM-dd"),
    [rangeStart]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await json<{ data: { overrides: Override[] } }>(
        await fetch(`/api/agent/availability-overrides?from=${rangeStart}&to=${rangeEnd}`, {
          cache: "no-store"
        })
      );
      setOverrides(body.data.overrides);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load overrides");
    } finally {
      setLoading(false);
    }
  }, [rangeStart, rangeEnd]);

  useEffect(() => { void load(); }, [load]);

  function openDialog() {
    setKind("block");
    setDate(format(new Date(), "yyyy-MM-dd"));
    setClosed(false);
    setOpens("09:00");
    setCloses("17:00");
    setStartTime("09:00");
    setEndTime("10:00");
    setNote("");
    setDialogOpen(true);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload =
        kind === "day_hours"
          ? { kind, date, closed, opens: closed ? undefined : opens + ":00", closes: closed ? undefined : closes + ":00", note: note || undefined }
          : {
              kind,
              date,
              startsAt: new Date(`${date}T${startTime}:00`).toISOString(),
              endsAt: new Date(`${date}T${endTime}:00`).toISOString(),
              note: note || undefined
            };
      await json(await fetch("/api/agent/availability-overrides", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      }));
      setDialogOpen(false);
      setMessage("Override saved. The agent will follow it immediately.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save override");
    } finally {
      setSaving(false);
    }
  }

  async function removeOverride(id: string) {
    if (!window.confirm("Remove this override? Availability for that date will fall back to the normal schedule.")) return;
    try {
      await json(await fetch(`/api/agent/availability-overrides/${id}`, { method: "DELETE" }));
      setMessage("Override removed.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove override");
    }
  }

  const localTime = (iso: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

  return (
    <section className="rounded-xl border p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Date overrides</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Block time, add extra slots, or replace hours for a specific date. These always win over the weekly schedule above — the agent follows them exactly.
          </p>
        </div>
        <Button onClick={openDialog} className="gap-2">
          <Plus className="h-4 w-4" />
          Add override
        </Button>
      </div>

      {message ? <p role="status" className="mb-4 rounded-md border bg-muted/40 px-4 py-3 text-sm">{message}</p> : null}

      <div className="mb-4 flex items-center gap-2">
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => setRangeStart(format(addDays(new Date(`${rangeStart}T00:00:00`), -14), "yyyy-MM-dd"))}
        >
          Previous 2 weeks
        </button>
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => setRangeStart(format(new Date(), "yyyy-MM-dd"))}
        >
          Today
        </button>
        <button
          type="button"
          className="rounded-md border px-3 py-2 text-sm"
          onClick={() => setRangeStart(format(addDays(new Date(`${rangeStart}T00:00:00`), 14), "yyyy-MM-dd"))}
        >
          Next 2 weeks
        </button>
        <span className="ml-auto text-xs text-muted-foreground">{rangeStart} → {rangeEnd}</span>
      </div>

      <div className="divide-y rounded-lg border">
        {overrides.map((override) => (
          <div key={override.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex items-center gap-3">
              <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", kindBadgeClass[override.kind])}>
                {kindLabel[override.kind]}
              </span>
              <div>
                <p className="text-sm font-medium">{override.date}</p>
                <p className="text-xs text-muted-foreground">
                  {override.kind === "day_hours"
                    ? override.closed
                      ? "Closed all day"
                      : `${override.opens?.slice(0, 5)} – ${override.closes?.slice(0, 5)}`
                    : override.startsAt && override.endsAt
                      ? `${localTime(override.startsAt)} – ${localTime(override.endsAt)}`
                      : ""}
                  {override.note ? ` · ${override.note}` : ""}
                </p>
              </div>
            </div>
            <button
              type="button"
              aria-label="Remove override"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => void removeOverride(override.id)}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
        {!loading && overrides.length === 0 && (
          <p className="p-8 text-center text-sm text-muted-foreground">No overrides in this range — availability follows the weekly schedule.</p>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add date override</DialogTitle>
            <DialogDescription>The agent applies this the moment it's saved.</DialogDescription>
          </DialogHeader>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Type">
              <select value={kind} onChange={(event) => setKind(event.target.value as OverrideKind)} className={fieldSelectClass}>
                <option value="block">Block time (e.g. staff out, holiday)</option>
                <option value="add">Add extra slot (open outside normal hours)</option>
                <option value="day_hours">Replace hours for this day only</option>
              </select>
            </Field>

            <Field label="Date">
              <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                <PopoverTrigger asChild>
                  <button type="button" className={cn(fieldInputClass, "flex items-center justify-between text-left font-normal")}>
                    {format(new Date(`${date}T00:00:00`), "d MMM yyyy")}
                    <CalendarIcon className="h-4 w-4 text-muted-foreground" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto">
                  <Calendar
                    mode="single"
                    selected={new Date(`${date}T00:00:00`)}
                    onSelect={(selected) => {
                      if (!selected) return;
                      setDate(format(selected, "yyyy-MM-dd"));
                      setDatePickerOpen(false);
                    }}
                    disabled={{ before: new Date(new Date().toDateString()) }}
                    autoFocus
                  />
                </PopoverContent>
              </Popover>
            </Field>

            {kind === "day_hours" ? (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={closed} onChange={(event) => setClosed(event.target.checked)} />
                  Closed all day
                </label>
                {!closed && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Opens">
                      <input type="time" value={opens} onChange={(event) => setOpens(event.target.value)} className={fieldInputClass} />
                    </Field>
                    <Field label="Closes">
                      <input type="time" value={closes} onChange={(event) => setCloses(event.target.value)} className={fieldInputClass} />
                    </Field>
                  </div>
                )}
              </>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts">
                  <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className={fieldInputClass} />
                </Field>
                <Field label="Ends">
                  <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className={fieldInputClass} />
                </Field>
              </div>
            )}

            <Field label="Note (optional)">
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={280} placeholder="e.g. Dr. Sharma on leave" className={fieldInputClass} />
            </Field>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save override"}</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

const fieldInputClass = "h-9 w-full rounded-md border bg-background px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const fieldSelectClass = cn(fieldInputClass, "appearance-auto");

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
