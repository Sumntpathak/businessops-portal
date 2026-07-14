"use client";

import { useFormState, useFormStatus } from "react-dom";
import { ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { joinWaitlist, type WaitlistResult } from "@/app/actions/waitlist";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="group flex h-12 shrink-0 items-center gap-2 rounded-xl bg-emerald-400 px-6 text-sm font-semibold text-emerald-950 transition hover:bg-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/70 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <>
          Join the waitlist
          <ArrowRight
            className="h-4 w-4 transition-transform group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </>
      )}
    </button>
  );
}

export function WaitlistForm() {
  const [state, action] = useFormState<WaitlistResult | null, FormData>(
    joinWaitlist,
    null
  );

  if (state?.ok) {
    return (
      <div
        role="status"
        className="flex items-center gap-3 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-5 py-4 text-sm text-emerald-300"
      >
        <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden="true" />
        {state.message}
      </div>
    );
  }

  return (
    <form action={action} className="w-full">
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="email"
          name="email"
          required
          autoComplete="email"
          placeholder="you@yourbusiness.com"
          aria-label="Email address"
          className="h-12 w-full rounded-xl border border-white/10 bg-white/5 px-4 text-sm text-foreground placeholder:text-muted-foreground/70 transition focus-visible:border-emerald-400/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/30"
        />
        <SubmitButton />
      </div>
      {state && !state.ok && (
        <p role="alert" className="mt-3 text-sm text-red-400">
          {state.message}
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        No spam — a single email when your number is ready.
      </p>
    </form>
  );
}
