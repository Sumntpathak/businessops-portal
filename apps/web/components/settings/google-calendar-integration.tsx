"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface CalendarOption {
  id: string;
  summary: string;
  primary: boolean;
}

interface Integration {
  status: "disconnected" | "active" | "revoked";
  calendarId: string | null;
  calendars: CalendarOption[];
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return body?.error?.message ?? "Google Calendar request failed.";
}

export function GoogleCalendarIntegration() {
  const [integration, setIntegration] = useState<Integration>();
  const [calendarId, setCalendarId] = useState("");
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/integrations/google", {
      cache: "no-store"
    });
    if (!response.ok) {
      setMessage(await errorMessage(response));
      return;
    }
    const body = (await response.json()) as { data: Integration };
    setIntegration(body.data);
    setCalendarId(body.data.calendarId ?? "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function saveCalendar() {
    setPending(true);
    setMessage(undefined);
    const response = await fetch("/api/integrations/google", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ calendarId })
    });
    setPending(false);
    if (!response.ok) {
      setMessage(await errorMessage(response));
      return;
    }
    setMessage("Booking calendar saved.");
    await load();
  }

  async function disconnect() {
    setPending(true);
    setMessage(undefined);
    const response = await fetch("/api/integrations/google", {
      method: "DELETE"
    });
    setPending(false);
    if (!response.ok) {
      setMessage(await errorMessage(response));
    } else {
      setMessage("Google Calendar disconnected.");
    }
    await load();
  }

  const connected = integration?.status === "active";

  if (!integration) {
    return (
      <section className="rounded-xl border p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-full max-w-xl" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-10 w-44 shrink-0 rounded-md" />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h2 className="text-lg font-semibold">Google Calendar</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Recepto reads busy time and creates or removes booking events in the calendar you select.
          </p>
          <p className="mt-3 text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Status: {integration?.status ?? "loading"}
          </p>
        </div>
        {connected ? (
          <Button variant="outline" onClick={disconnect} disabled={pending}>
            Disconnect
          </Button>
        ) : (
          <Button asChild>
            <a href="/api/integrations/google/start">
              {integration?.status === "revoked" ? "Reconnect Google Calendar" : "Connect Google Calendar"}
            </a>
          </Button>
        )}
      </div>

      {connected ? (
        <div className="mt-6 flex flex-col gap-3 rounded-lg bg-muted/20 p-4 sm:flex-row sm:items-end">
          <label className="flex-1 text-sm font-medium">
            Calendar used for bookings
            <select
              value={calendarId}
              onChange={(event) => setCalendarId(event.target.value)}
              className="mt-2 h-11 w-full rounded-md border bg-background px-3"
            >
              {integration.calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.summary}{calendar.primary ? " (Primary)" : ""}
                </option>
              ))}
            </select>
          </label>
          <Button onClick={saveCalendar} disabled={pending || !calendarId}>
            Save calendar
          </Button>
        </div>
      ) : null}

      {message ? (
        <p role="status" className="mt-4 text-sm text-amber-300">{message}</p>
      ) : null}
    </section>
  );
}
