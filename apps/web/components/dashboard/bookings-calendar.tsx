"use client";

import { addDays, format, startOfWeek } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarIcon, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { PageBody, PageHeader, PageShell } from "@/components/dashboard/page-shell";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type Booking = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "confirmed" | "cancelled" | "completed" | "no_show";
  notes: string;
  serviceName: string;
  callerName: string | null;
  callerPhone: string;
};
type Service = { id: string; name: string; durationMinutes: number };
type Slot = { startsAt: string; endsAt: string };
type ApiError = { error?: { message?: string } };

function monday(value = new Date()) {
  return format(startOfWeek(value, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}

export function BookingsCalendar() {
  const [weekStart, setWeekStart] = useState(monday());
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [serviceId, setServiceId] = useState("");
  const [date, setDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [slots, setSlots] = useState<Slot[]>([]);
  const [startsAt, setStartsAt] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setDialogOpen((open) => !open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const loadWeek = useCallback(async () => {
    setLoading(true);
    try {
      const body = await json<{
        data: { bookings: Booking[]; services: Service[]; timezone: string };
      }>(await fetch(`/api/bookings?weekStart=${weekStart}`, { cache: "no-store" }));
      setBookings(body.data.bookings);
      setServices(body.data.services);
      setTimezone(body.data.timezone);
      setServiceId((current) => current || body.data.services[0]?.id || "");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load bookings");
    } finally {
      setLoading(false);
    }
  }, [weekStart]);

  useEffect(() => { void loadWeek(); }, [loadWeek]);

  useEffect(() => {
    if (!serviceId || !date) return;
    setStartsAt("");
    void fetch(`/api/bookings/availability?serviceId=${serviceId}&date=${date}`, { cache: "no-store" }).then((response) => json<{ data: { slots: Slot[] } }>(response)).then((body) => setSlots(body.data.slots)).catch((error: Error) => {
      setSlots([]);
      setMessage(error.message);
    });
  }, [serviceId, date]);

  const days = useMemo(() => {
    const start = new Date(`${weekStart}T00:00:00`);
    return Array.from({ length: 7 }, (_, index) => addDays(start, index));
  }, [weekStart]);

  const localDate = (iso: string) => new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(iso));
  const localTime = (iso: string) => new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone, hour: "2-digit", minute: "2-digit"
  }).format(new Date(iso));

  async function createBooking(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      await json(await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          serviceId,
          startsAt,
          callerName: data.get("callerName"),
          callerPhone: data.get("callerPhone"),
          notes: data.get("notes")
        })
      }));
      setMessage("Booking created in Recepto and Google Calendar.");
      setStartsAt("");
      setDialogOpen(false);
      await loadWeek();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create booking");
    }
  }

  async function cancelBooking(id: string) {
    if (!window.confirm("Cancel this booking and remove its Google Calendar event?")) return;
    try {
      await json(await fetch(`/api/bookings/${id}/cancel`, { method: "POST" }));
      setMessage("Booking cancelled.");
      await loadWeek();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not cancel booking");
    }
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={"Times shown in " + timezone}
        title="Bookings"
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded-md border px-3 py-2 text-sm" onClick={() => setWeekStart(format(addDays(new Date(`${weekStart}T00:00:00`), -7), "yyyy-MM-dd"))}>Previous</button>
            <button className="rounded-md border px-3 py-2 text-sm" onClick={() => setWeekStart(monday())}>Today</button>
            <button className="rounded-md border px-3 py-2 text-sm" onClick={() => setWeekStart(format(addDays(new Date(`${weekStart}T00:00:00`), 7), "yyyy-MM-dd"))}>Next</button>
            <Button onClick={() => setDialogOpen(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              New booking
              <kbd className="ml-1 hidden rounded border border-primary-foreground/30 px-1.5 py-0.5 text-[10px] font-normal opacity-70 sm:inline">
                ⌘K
              </kbd>
            </Button>
          </div>
        }
      />
      <PageBody className="space-y-6">
      {message && <p role="status" className="rounded-md border bg-muted/40 px-4 py-3 text-sm">{message}</p>}

      <section className="overflow-x-auto rounded-lg border">
        <div className="grid min-w-[840px] grid-cols-7">
          {days.map((day) => {
            const key = format(day, "yyyy-MM-dd");
            const dayBookings = bookings.filter((booking) => localDate(booking.startsAt) === key);
            return (
              <div key={key} className="min-h-44 border-r p-3 last:border-r-0">
                <p className="mb-3 text-sm font-medium">{format(day, "EEE d MMM")}</p>
                <div className="space-y-2">
                  {dayBookings.map((booking) => (
                    <article key={booking.id} className="rounded-md border bg-card p-2 text-xs">
                      <p className="font-semibold">{localTime(booking.startsAt)} · {booking.serviceName}</p>
                      <p className="mt-1 text-muted-foreground">{booking.callerName || booking.callerPhone}</p>
                    </article>
                  ))}
                  {!loading && dayBookings.length === 0 && <p className="text-xs text-muted-foreground">No bookings</p>}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-lg border p-5">
        <h2 className="font-semibold">This week</h2>
        <div className="mt-4 divide-y">
          {bookings.map((booking) => (
            <div key={booking.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium">{booking.serviceName} · {booking.callerName || booking.callerPhone}</p>
                <p className="text-xs text-muted-foreground">{localDate(booking.startsAt)} at {localTime(booking.startsAt)} · {booking.status}</p>
              </div>
              {booking.status === "confirmed" && <button className="text-sm text-destructive hover:underline" onClick={() => void cancelBooking(booking.id)}>Cancel</button>}
            </div>
          ))}
          {!loading && bookings.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">No bookings this week yet.</p>}
        </div>
      </section>
      </PageBody>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <CalendarIcon className="h-4 w-4" />
              </span>
              <div>
                <DialogTitle>Create booking</DialogTitle>
                <DialogDescription>Also creates a Google Calendar event.</DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={createBooking} className="space-y-5">
            <div className="space-y-3">
              <Field label="Service">
                <select required value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={fieldSelectClass}>
                  <option value="">Choose service</option>
                  {services.map((service) => (
                    <option key={service.id} value={service.id}>{service.name} ({service.durationMinutes} min)</option>
                  ))}
                </select>
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Date">
                  <Popover open={datePickerOpen} onOpenChange={setDatePickerOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        className={cn(fieldInputClass, "flex items-center justify-between text-left font-normal")}
                      >
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
                <Field label="Time">
                  <select required value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={fieldSelectClass}>
                    <option value="">Choose time</option>
                    {slots.map((slot) => <option key={slot.startsAt} value={slot.startsAt}>{localTime(slot.startsAt)}</option>)}
                  </select>
                </Field>
              </div>
              {serviceId && slots.length === 0 && <p className="text-xs text-muted-foreground">No open slots for this date.</p>}
            </div>

            <div className="space-y-3 border-t pt-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Caller name">
                  <input required name="callerName" maxLength={120} className={fieldInputClass} />
                </Field>
                <Field label="Phone">
                  <input required name="callerPhone" placeholder="+919876543210" pattern="\+[1-9][0-9]{7,14}" className={fieldInputClass} />
                </Field>
              </div>

              <Field label="Notes">
                <textarea name="notes" maxLength={1000} rows={2} className={cn(fieldInputClass, "h-auto resize-none py-2")} />
              </Field>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={!startsAt}>Create booking</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageShell>
  );
}

const fieldInputClass = "h-9 w-full rounded-md border bg-background px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const fieldSelectClass = cn(fieldInputClass, "appearance-auto");

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block space-y-1.5 text-sm", className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}


