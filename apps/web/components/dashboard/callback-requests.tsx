"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, PageShell } from "@/components/dashboard/page-shell";
import { cn } from "@/lib/utils";

type CallbackRequest = {
  id: string;
  reason: string;
  preferredTime: string;
  status: "pending" | "done";
  createdAt: string;
  resolvedAt: string | null;
  callerName: string | null;
  callerPhone: string;
};
type ApiError = { error?: { message?: string } };
type Filter = "pending" | "done" | "all";

async function json<T>(response: Response): Promise<T> {
  const body = (await response.json()) as T & ApiError;
  if (!response.ok) throw new Error(body.error?.message ?? "Request failed");
  return body;
}

/**
 * "Take a message" requests the voice agent recorded during a call, waiting
 * for a human to act on them. There is no automatic staff notification yet —
 * this dashboard view is the only place these surface, so it must be the
 * first place staff check after being off a call or overnight.
 */
export function CallbackRequests() {
  const [filter, setFilter] = useState<Filter>("pending");
  const [requests, setRequests] = useState<CallbackRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await json<{ data: { callbackRequests: CallbackRequest[] } }>(
        await fetch(`/api/callback-requests?status=${filter}`, { cache: "no-store" })
      );
      setRequests(body.data.callbackRequests);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load callback requests");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function markDone(id: string) {
    try {
      await json(await fetch(`/api/callback-requests/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "done" })
      }));
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update callback request");
    }
  }

  const pendingCount = requests.filter((request) => request.status === "pending").length;

  return (
    <PageShell>
      <PageHeader
        eyebrow="Recorded by the voice agent"
        title="Callbacks"
        actions={
          <div className="flex gap-2">
            {(["pending", "done", "all"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={cn(
                  "rounded-md border px-3 py-2 text-sm capitalize",
                  filter === option && "bg-muted"
                )}
              >
                {option}
              </button>
            ))}
          </div>
        }
      >
        {filter === "pending" && pendingCount > 0 && (
          <p className="mt-1 text-sm text-muted-foreground">
            {pendingCount} caller{pendingCount === 1 ? " is" : "s are"} waiting on a call back.
          </p>
        )}
      </PageHeader>
      <PageBody className="space-y-4">
        {message ? <p role="status" className="rounded-md border bg-muted/40 px-4 py-3 text-sm">{message}</p> : null}

        <div className="divide-y rounded-lg border">
          {requests.map((request) => (
            <div key={request.id} className="flex flex-wrap items-start justify-between gap-4 p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <PhoneCall className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-sm font-medium">{request.callerName || request.callerPhone}</p>
                  <p className="text-xs text-muted-foreground">{request.callerPhone}</p>
                  <p className="mt-1.5 text-sm">{request.reason}</p>
                  {request.preferredTime && (
                    <p className="mt-1 text-xs text-muted-foreground">Preferred time: {request.preferredTime}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {new Date(request.createdAt).toLocaleString()}
                    {request.status === "done" && request.resolvedAt
                      ? ` · resolved ${new Date(request.resolvedAt).toLocaleString()}`
                      : ""}
                  </p>
                </div>
              </div>
              {request.status === "pending" ? (
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void markDone(request.id)}>
                  <Check className="h-3.5 w-3.5" />
                  Mark done
                </Button>
              ) : (
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  Done
                </span>
              )}
            </div>
          ))}
          {!loading && requests.length === 0 && (
            <p className="p-8 text-center text-sm text-muted-foreground">
              {filter === "pending" ? "No pending callback requests." : "No callback requests here yet."}
            </p>
          )}
        </div>
      </PageBody>
    </PageShell>
  );
}
