"use client";

import { useEffect, useRef, useState } from "react";

interface TranscriptEntry {
  id: string;
  seq: number;
  role: string;
  content: string;
  at: string;
}

interface LiveTranscriptProps {
  callId: string;
  initialStatus: string;
  initialEntries: TranscriptEntry[];
}

const ACTIVE_STATUSES = new Set(["ringing", "in_progress"]);
const POLL_INTERVAL_MS = 2500;

export function LiveTranscript({
  callId,
  initialStatus,
  initialEntries
}: LiveTranscriptProps) {
  const [entries, setEntries] = useState<TranscriptEntry[]>(initialEntries);
  const [status, setStatus] = useState(initialStatus);
  const endRef = useRef<HTMLDivElement>(null);
  const isLive = ACTIVE_STATUSES.has(status);

  useEffect(() => {
    if (!isLive) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/calls/${callId}/transcript`, {
          cache: "no-store"
        });
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as {
          data?: { status: string; entries: TranscriptEntry[] };
        };
        if (!payload.data || cancelled) return;
        setStatus(payload.data.status);
        setEntries((previous) =>
          payload.data!.entries.length >= previous.length
            ? payload.data!.entries
            : previous
        );
      } catch {
        // Transient poll failures are fine; the next tick retries.
      }
    };

    const timer = setInterval(() => void poll(), POLL_INTERVAL_MS);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [callId, isLive]);

  useEffect(() => {
    if (isLive) endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [entries.length, isLive]);

  return (
    <section className="self-start rounded-xl border">
      <div className="flex items-center justify-between border-b p-5">
        <h2 className="font-semibold">Transcript</h2>
        {isLive ? (
          <span className="flex items-center gap-2 text-xs font-medium text-emerald-600">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            Live
          </span>
        ) : (
          <span className="text-xs capitalize text-muted-foreground">
            {status.replace("_", " ")}
          </span>
        )}
      </div>
      {entries.length === 0 ? (
        <p className="p-12 text-center text-sm text-muted-foreground">
          {isLive
            ? "Waiting for the conversation to start…"
            : "No transcript events were captured for this call."}
        </p>
      ) : (
        <ol className="space-y-5 p-5">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={entry.role === "agent" ? "ml-auto max-w-[85%]" : "max-w-[85%]"}
            >
              <div className="mb-1 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <span>{entry.role}</span>
                <time>
                  {new Intl.DateTimeFormat("en-IN", { timeStyle: "medium" }).format(
                    new Date(entry.at)
                  )}
                </time>
              </div>
              <p className="rounded-lg border bg-muted/20 p-3 text-sm leading-6">
                {entry.content}
              </p>
            </li>
          ))}
        </ol>
      )}
      <div ref={endRef} />
    </section>
  );
}
