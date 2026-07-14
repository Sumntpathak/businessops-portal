"use client";

import { useCallback, useEffect, useState } from "react";
import { PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

interface TwilioStatus {
  connected: boolean;
  accountSid: string | null;
  phoneNumber: string | null;
  webhookConfigured: boolean;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return body?.error?.message ?? "Twilio request failed.";
}

function maskSid(sid: string): string {
  return sid.slice(0, 6) + "…" + sid.slice(-4);
}

export function TwilioIntegration() {
  const [status, setStatus] = useState<TwilioStatus>();
  const [accountSid, setAccountSid] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [message, setMessage] = useState<{ text: string; tone: "success" | "error" }>();
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/integrations/twilio", { cache: "no-store" });
    if (!response.ok) {
      setMessage({ text: await errorMessage(response), tone: "error" });
      return;
    }
    const body = (await response.json()) as { data: TwilioStatus };
    setStatus(body.data);
    setPhoneNumber(body.data.phoneNumber ?? "");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function connect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setMessage(undefined);
    const response = await fetch("/api/integrations/twilio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountSid, authToken, phoneNumber })
    });
    setPending(false);
    if (!response.ok) {
      setMessage({ text: await errorMessage(response), tone: "error" });
      return;
    }
    setAuthToken("");
    setMessage({
      text: "Connected — your number's voice webhook is configured automatically.",
      tone: "success"
    });
    await load();
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Twilio? Calls to this number will stop working until you reconnect.")) {
      return;
    }
    setPending(true);
    setMessage(undefined);
    const response = await fetch("/api/integrations/twilio", { method: "DELETE" });
    setPending(false);
    if (!response.ok) {
      setMessage({ text: await errorMessage(response), tone: "error" });
      return;
    }
    setMessage({ text: "Twilio disconnected.", tone: "success" });
    await load();
  }

  if (!status) {
    return (
      <section className="rounded-xl border p-6">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
          <div className="space-y-3">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-full max-w-xl" />
          </div>
          <Skeleton className="h-10 w-44 shrink-0 rounded-md" />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
          <PhoneCall className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Twilio phone number</h2>
          <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
            Connect your own Twilio account so calls to your number are answered by your
            AI receptionist. We only use your Auth Token to verify incoming calls and to
            point your number&apos;s voice webhook at Recepto — it&apos;s stored encrypted
            and never shown again.
          </p>
        </div>
      </div>

      {status.connected ? (
        <div className="mt-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/20 p-4">
            <div>
              <p className="font-medium tabular-nums">{status.phoneNumber}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Account {status.accountSid ? maskSid(status.accountSid) : "—"} ·{" "}
                {status.webhookConfigured ? (
                  <span className="text-emerald-500">webhook configured</span>
                ) : (
                  <span className="text-amber-500">webhook not confirmed</span>
                )}
              </p>
            </div>
            <Button variant="outline" onClick={disconnect} disabled={pending}>
              Disconnect
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={connect} className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium sm:col-span-2">
            Twilio Account SID
            <input
              required
              value={accountSid}
              onChange={(event) => setAccountSid(event.target.value)}
              placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
              className="mt-2 h-11 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-foreground"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Twilio Auth Token
            <input
              required
              type="password"
              autoComplete="off"
              value={authToken}
              onChange={(event) => setAuthToken(event.target.value)}
              placeholder="Found on your Twilio Console dashboard"
              className="mt-2 h-11 w-full rounded-md border bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-foreground"
            />
          </label>
          <label className="text-sm font-medium sm:col-span-2">
            Phone number to connect
            <input
              required
              type="tel"
              value={phoneNumber}
              onChange={(event) => setPhoneNumber(event.target.value)}
              placeholder="+14155550100"
              pattern="\+[1-9][0-9]{7,14}"
              className="mt-2 h-11 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-foreground"
            />
          </label>
          <Button type="submit" disabled={pending} className="sm:col-span-2">
            {pending ? "Connecting…" : "Connect Twilio"}
          </Button>
        </form>
      )}

      {message ? (
        <p
          role="status"
          className={
            "mt-4 text-sm " + (message.tone === "error" ? "text-red-400" : "text-emerald-400")
          }
        >
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
