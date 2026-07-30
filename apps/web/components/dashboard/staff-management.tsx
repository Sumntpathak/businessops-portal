"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { PageBody, PageHeader, PageShell } from "@/components/dashboard/page-shell";

interface StaffMember {
  id?: string;
  name: string;
  phoneE164: string | null;
  isRegisteredAgent: boolean;
  credentialLabel: string;
  active: boolean;
}

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "Something went wrong.";
}

export function StaffManagement() {
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  const initialized = useRef(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/agent/staff", { cache: "no-store" });
    if (!response.ok) { setMessage(await responseError(response)); return; }
    const body = (await response.json()) as { data: { staff: StaffMember[] } };
    if (!initialized.current) {
      setStaff(body.data.staff);
      initialized.current = true;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateStaff(index: number, patch: Partial<StaffMember>) {
    setStaff((current) =>
      current.map((member, i) => (i === index ? { ...member, ...patch } : member))
    );
  }

  async function save() {
    setPending(true);
    setMessage(undefined);
    const response = await fetch("/api/agent/staff", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ staff })
    });
    setPending(false);
    if (!response.ok) { setMessage(await responseError(response)); return; }
    setMessage("Staff saved.");
    initialized.current = false;
    await load();
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Team"
        title="Staff"
        actions={
          <div className="flex gap-2">
            <Button
              variant="outline"
              type="button"
              onClick={() =>
                setStaff((current) => [
                  ...current,
                  { name: "", phoneE164: null, isRegisteredAgent: false, credentialLabel: "", active: true }
                ])
              }
            >
              Add staff
            </Button>
            <Button onClick={save} disabled={pending}>Save</Button>
          </div>
        }
      >
        <p className="mt-2 text-sm text-muted-foreground">
          Staff the voice agent can book callers with. Leave this empty to have every booking
          auto-assigned without naming a specific person.
        </p>
      </PageHeader>
      <PageBody>
        {message ? <p className="mb-4 text-sm text-muted-foreground">{message}</p> : null}
        <div className="space-y-3">
          {staff.length === 0 ? (
            <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              No staff added yet. Bookings will be auto-assigned until you add one.
            </p>
          ) : (
            staff.map((member, index) => (
              <div
                key={member.id ?? index}
                className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1.4fr_1fr_1.4fr_auto_auto]"
              >
                <input
                  value={member.name}
                  onChange={(event) => updateStaff(index, { name: event.target.value })}
                  placeholder="Staff name"
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                />
                <input
                  value={member.phoneE164 ?? ""}
                  onChange={(event) => updateStaff(index, { phoneE164: event.target.value || null })}
                  placeholder="+61..."
                  className="h-10 rounded-md border bg-background px-3 text-sm"
                />
                <input
                  value={member.credentialLabel}
                  onChange={(event) => updateStaff(index, { credentialLabel: event.target.value })}
                  placeholder="Credential label, e.g. MARA registered"
                  disabled={!member.isRegisteredAgent}
                  className="h-10 rounded-md border bg-background px-3 text-sm disabled:opacity-40"
                />
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={member.isRegisteredAgent}
                    onChange={(event) => updateStaff(index, { isRegisteredAgent: event.target.checked })}
                  />
                  Registered
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={member.active}
                    onChange={(event) => updateStaff(index, { active: event.target.checked })}
                  />
                  Active
                </label>
              </div>
            ))
          )}
        </div>
      </PageBody>
    </PageShell>
  );
}
