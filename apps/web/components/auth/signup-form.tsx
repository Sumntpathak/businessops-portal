"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";

type ErrorResponse = { error?: { message?: string } };

export function SignupForm() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(undefined);

    const form = new FormData(event.currentTarget);
    const payload = {
      name: form.get("name"),
      email: form.get("email"),
      password: form.get("password")
    };

    const response = await fetch("/api/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as ErrorResponse;
      setError(body.error?.message ?? "Could not create your account.");
      setPending(false);
      return;
    }

    const result = await signIn("credentials", {
      email: payload.email,
      password: payload.password,
      redirect: false
    });

    if (result?.error) {
      setError("Account created. Please sign in.");
      setPending(false);
      return;
    }

    router.push("/onboarding/create-business");
    router.refresh();
  }

  return (
    <>
      <form onSubmit={submit} className="space-y-5">
        <label className="block text-sm font-medium">
          Your name
          <input required name="name" minLength={2} maxLength={100} autoComplete="name" className="mt-2 h-11 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-foreground" />
        </label>
        <label className="block text-sm font-medium">
          Work email
          <input required name="email" type="email" autoComplete="email" className="mt-2 h-11 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-foreground" />
        </label>
        <label className="block text-sm font-medium">
          Password
          <input required name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" className="mt-2 h-11 w-full rounded-md border bg-background px-3 outline-none focus:ring-2 focus:ring-foreground" />
          <span className="mt-2 block text-xs font-normal text-muted-foreground">Use at least 8 characters.</span>
        </label>
        {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
        <Button className="w-full" disabled={pending}>
          {pending ? "Creating account…" : "Create account"}
        </Button>
      </form>
      <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        OR
        <span className="h-px flex-1 bg-border" />
      </div>
      <Button type="button" variant="outline" className="w-full" onClick={() => signIn("google", { redirectTo: "/dashboard" })}>
        Continue with Google
      </Button>
      <p className="mt-7 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-foreground hover:underline">Sign in</Link>
      </p>
    </>
  );
}
