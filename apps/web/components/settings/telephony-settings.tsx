"use client";

import { useCallback, useEffect, useState } from "react";

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return body?.error?.message ?? "Telephony settings request failed.";
}

export function TelephonySettings() {
  const [enabled, setEnabled] = useState(false);
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/agent/telephony-settings", { cache: "no-store" });
    if (!response.ok) {
      setMessage(await errorMessage(response));
      return;
    }
    const body = (await response.json()) as { data: { transferRecordingEnabled: boolean } };
    setEnabled(body.data.transferRecordingEnabled);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(next: boolean) {
    setPending(true);
    setMessage(undefined);
    const response = await fetch("/api/agent/telephony-settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transferRecordingEnabled: next })
    });
    setPending(false);
    if (!response.ok) {
      setMessage(await errorMessage(response));
      return;
    }
    setEnabled(next);
    setMessage("Saved.");
  }

  return (
    <section className="rounded-xl border p-5">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Call transfers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          When the voice agent transfers a caller to a staff member, optionally record that
          part of the call.
        </p>
      </div>
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div>
          <p className="text-sm font-medium">Record transferred calls</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Off by default. Enabling this plays an automatic notice to both parties that the
            call may be recorded. You are responsible for complying with call-recording consent
            laws in your jurisdiction — Recepto does not manage this for you.
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2 pl-4 text-sm">
          <input
            type="checkbox"
            checked={enabled}
            disabled={pending}
            onChange={(event) => void save(event.target.checked)}
          />
          Enabled
        </label>
      </div>
      {message ? <p className="mt-3 text-sm text-muted-foreground">{message}</p> : null}
    </section>
  );
}
