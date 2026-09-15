"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type ErrorResponse = { error?: { message?: string } };

/**
 * Every IANA zone the runtime knows about, each labeled with its current UTC
 * offset so a business owner can find their own city instead of guessing from
 * a short curated list (the old 5-zone list had no Australian option at all,
 * which is how a tenant with no matching choice ended up on the wrong zone).
 */
function useTimezoneOptions(): { value: string; label: string }[] {
  return useMemo(() => {
    const zones =
      typeof Intl.supportedValuesOf === "function"
        ? Intl.supportedValuesOf("timeZone")
        : [
            "Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney",
            "Europe/London", "America/New_York", "America/Los_Angeles"
          ];

    const withOffsets = zones.map((zone) => {
      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: zone,
        timeZoneName: "shortOffset"
      }).formatToParts(new Date());
      const offset = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
      const city = zone.split("/").pop()?.replaceAll("_", " ") ?? zone;
      return { value: zone, label: `(${offset}) ${city} — ${zone}` };
    });

    return withOffsets.sort((a, b) => a.value.localeCompare(b.value));
  }, []);
}

export function CreateBusinessForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const timezoneOptions = useTimezoneOptions();
  const detectedTimezone = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return "Asia/Kolkata";
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);

    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/onboarding/create-business", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        websiteUrl: form.get("websiteUrl"),
        phone: form.get("phone"),
        timezone: form.get("timezone"),
        hint: form.get("hint")
      })
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ErrorResponse;
      setError(body.error?.message ?? "Could not create your business.");
      setPending(false);
      return;
    }

    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-8 grid gap-5">
      <label className="text-sm font-medium">
        Business name
        <input required name="name" minLength={2} maxLength={120} className="mt-2 h-11 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-foreground" />
      </label>
      <label className="text-sm font-medium">
        Website URL
        <input required name="websiteUrl" type="url" placeholder="https://yourbusiness.com" className="mt-2 h-11 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-foreground" />
      </label>
      <label className="text-sm font-medium">
        Business phone
        <input required name="phone" type="tel" placeholder="+919876543210" pattern="\+[1-9][0-9]{7,14}" className="mt-2 h-11 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-foreground" />
      </label>
      <label className="text-sm font-medium">
        Timezone
        <select name="timezone" defaultValue={detectedTimezone} className="mt-2 h-11 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-foreground">
          {timezoneOptions.map((option) => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
        <span className="mt-1 block text-xs text-muted-foreground">
          This is your business&apos;s own timezone — it decides when your receptionist offers appointment slots. Callers will always hear times in their own timezone too.
        </span>
      </label>
      <label className="text-sm font-medium">
        What should your receptionist know first?
        <textarea required name="hint" minLength={3} maxLength={240} rows={3} placeholder="We are a family dental clinic focused on preventive care." className="mt-2 w-full resize-none rounded-md border bg-background px-3 py-3 outline-none focus:ring-2 focus:ring-foreground" />
      </label>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
      <Button className="mt-2 w-full" disabled={pending}>
        {pending ? "Creating your business…" : "Create business"}
      </Button>
    </form>
  );
}
