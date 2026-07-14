"use client";

import { useState } from "react";
import { Check, Copy, Phone } from "lucide-react";

function formatE164(e164: string): string {
  // +12182768292 -> +1 218-276-8292 (US/CA); other lengths fall back to
  // "+<country> <rest>" spacing rather than guessing an unfamiliar format.
  const match = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164);
  if (match) return `+1 ${match[1]}-${match[2]}-${match[3]}`;
  const generic = /^(\+\d{1,3})(\d+)$/.exec(e164);
  return generic ? `${generic[1]} ${generic[2]}` : e164;
}

export function CallingNumber({ e164 }: { e164: string | null }) {
  const [copied, setCopied] = useState(false);

  if (!e164) {
    return (
      <span className="rounded-full border border-dashed px-3 py-1.5 text-xs text-muted-foreground">
        No number assigned yet
      </span>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(e164);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can be denied by the browser; the number is still visible to copy manually.
    }
  };

  return (
    <button
      type="button"
      onClick={() => void copy()}
      title="Copy number"
      className="group flex items-center gap-2 rounded-full border bg-muted/20 py-1.5 pl-3 pr-2.5 text-sm transition hover:bg-muted/40"
    >
      <Phone className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
      <span className="font-medium tabular-nums">{formatE164(e164)}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground transition group-hover:text-foreground" aria-hidden="true" />
      )}
    </button>
  );
}
