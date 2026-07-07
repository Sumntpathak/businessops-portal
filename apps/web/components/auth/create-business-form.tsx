"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type ErrorResponse = { error?: { message?: string } };

export function CreateBusinessForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

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
        <select name="timezone" defaultValue="Asia/Kolkata" className="mt-2 h-11 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-foreground">
          <option value="Asia/Kolkata">Asia/Kolkata</option>
          <option value="Asia/Dubai">Asia/Dubai</option>
          <option value="Europe/London">Europe/London</option>
          <option value="America/New_York">America/New_York</option>
          <option value="America/Los_Angeles">America/Los_Angeles</option>
        </select>
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
