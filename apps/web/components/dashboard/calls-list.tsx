"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, MonitorSmartphone, PhoneCall, PhoneIncoming } from "lucide-react";
import {
  STATUS_STYLES,
  formatDuration,
  initialsFor,
  isActiveStatus,
  lastFour,
  paletteFor
} from "@/lib/caller-display";

export interface CallListItem {
  id: string;
  startedAt: string;
  durationSeconds: number | null;
  status: string;
  summary: string | null;
  callNumber: number;
  transferredToStaffName: string | null;
  recordingUrl: string | null;
}

export interface CallerGroup {
  callerId: string;
  name: string | null;
  phone: string;
  stage: string;
  calls: CallListItem[];
}

interface CallsListProps {
  groups: CallerGroup[];
  tests: CallListItem[];
}

function StatusPill({ status }: { status: string }) {
  const active = isActiveStatus(status);
  return (
    <span
      className={
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium capitalize " +
        (STATUS_STYLES[status] ?? "bg-muted text-muted-foreground")
      }
    >
      {active && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
      )}
      {status.replace("_", " ")}
    </span>
  );
}

function CallRow({ call, showNumber }: { call: CallListItem; showNumber: boolean }) {
  return (
    <Link
      href={"/dashboard/calls/" + call.id}
      className="flex items-start justify-between gap-4 px-5 py-4 transition hover:bg-muted/30"
    >
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <PhoneIncoming className="h-3 w-3" />
          {new Intl.DateTimeFormat("en-IN", {
            dateStyle: "medium",
            timeStyle: "short"
          }).format(new Date(call.startedAt))}
          {showNumber && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide">
              Call #{call.callNumber}
            </span>
          )}
        </p>
        <p className="mt-1.5 line-clamp-2 text-sm leading-6 text-muted-foreground">
          {call.summary ??
            (isActiveStatus(call.status)
              ? "Call in progress — transcript is streaming live."
              : "No summary yet for this call.")}
        </p>
        {call.transferredToStaffName && (
          <p className="mt-1 text-xs text-muted-foreground">
            Transferred to {call.transferredToStaffName}
            {call.recordingUrl && " · recorded"}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <StatusPill status={call.status} />
        <p className="mt-1.5 text-xs text-muted-foreground">
          {formatDuration(call.durationSeconds)}
        </p>
      </div>
    </Link>
  );
}

export function CallsList({ groups, tests }: CallsListProps) {
  const [tab, setTab] = useState<"phone" | "test">("phone");
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(new Set());

  const toggle = (callerId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(callerId)) next.delete(callerId);
      else next.add(callerId);
      return next;
    });
  };

  const tabClass = (active: boolean) =>
    "flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm transition " +
    (active
      ? "border-transparent bg-foreground text-background"
      : "text-muted-foreground hover:text-foreground");

  return (
    <>
      <div className="-mx-5 -mt-5 shrink-0 border-b bg-background px-5 py-4 sm:-mx-8 sm:-mt-8 sm:px-8 sm:py-5">
        <p className="text-sm text-muted-foreground">Voice activity</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Calls</h1>
        <div className="mt-5 flex flex-wrap gap-2">
          <button type="button" className={tabClass(tab === "phone")} onClick={() => setTab("phone")}>
            <PhoneCall className="h-3.5 w-3.5" />
            Phone calls
            <span className="text-xs opacity-70">{groups.reduce((sum, group) => sum + group.calls.length, 0)}</span>
          </button>
          <button type="button" className={tabClass(tab === "test")} onClick={() => setTab("test")}>
            <MonitorSmartphone className="h-3.5 w-3.5" />
            Browser tests
            <span className="text-xs opacity-70">{tests.length}</span>
          </button>
        </div>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto rounded-xl border">
        {tab === "phone" ? (
          groups.length === 0 ? (
            <div className="p-12 text-center">
              <p className="font-medium">No calls yet</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Incoming calls will appear here after your Twilio number is active.
              </p>
            </div>
          ) : (
            <div className="divide-y">
              {groups.map((group) => {
                const expanded = expandedIds.has(group.callerId);
                const latest = group.calls[0];
                const hasLive = group.calls.some((call) => isActiveStatus(call.status));
                return (
                  <div key={group.callerId}>
                    <button
                      type="button"
                      onClick={() => toggle(group.callerId)}
                      aria-expanded={expanded}
                      className="flex w-full items-center gap-4 p-5 text-left transition hover:bg-muted/30"
                    >
                      <span
                        className={
                          "flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold " +
                          paletteFor(group.phone)
                        }
                      >
                        {initialsFor(group.name, group.phone)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">
                            {group.name ?? lastFour(group.phone)}
                          </span>
                          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            {group.calls.length === 1 ? "1 call" : group.calls.length + " calls"}
                          </span>
                          <span className="rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                            {group.stage.replace("_", " ")}
                          </span>
                          {hasLive && <StatusPill status="in_progress" />}
                        </span>
                        {latest && (
                          <span className="mt-1 block truncate text-sm text-muted-foreground">
                            {latest.summary ?? "Latest call " +
                              new Intl.DateTimeFormat("en-IN", {
                                dateStyle: "medium",
                                timeStyle: "short"
                              }).format(new Date(latest.startedAt))}
                          </span>
                        )}
                      </span>
                      <ChevronDown
                        className={
                          "h-4 w-4 shrink-0 text-muted-foreground transition-transform " +
                          (expanded ? "rotate-180" : "")
                        }
                      />
                    </button>
                    {expanded && (
                      <div className="divide-y border-t bg-muted/10">
                        {group.calls.map((call) => (
                          <CallRow key={call.id} call={call} showNumber={group.calls.length > 1} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : tests.length === 0 ? (
          <div className="p-12 text-center">
            <p className="font-medium">No browser test calls</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Runs from the Voice Test page will appear here.
            </p>
          </div>
        ) : (
          <div className="divide-y">
            {tests.map((call) => (
              <CallRow key={call.id} call={call} showNumber={false} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
