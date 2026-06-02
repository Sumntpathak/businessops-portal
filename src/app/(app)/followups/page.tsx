"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button, Card, StatusBadge, Toast, type ToastType } from "@/shared/ui";

type DueFilter = "today" | "overdue" | "upcoming" | "";

interface FollowUp {
  id: string; message: string; followUpDate: string;
  status: string; leadId: string;
}

const TABS: { label: string; value: DueFilter; description: string }[] = [
  { label: "Today", value: "today", description: "Due today" },
  { label: "Overdue", value: "overdue", description: "Past due date, still pending" },
  { label: "Upcoming", value: "upcoming", description: "Future follow-ups" },
  { label: "All", value: "", description: "All follow-ups" },
];

export default function FollowUpsPage() {
  const [activeTab, setActiveTab] = useState<DueFilter>("today");
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const showToast = (msg: string, type: ToastType = "success") => setToast({ message: msg, type });

  useEffect(() => {
    const controller = new AbortController();

    async function fetchFollowUps() {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (activeTab) params.set("due", activeTab);
        if (activeTab === "overdue" || activeTab === "today") params.set("status", "Pending");
        const res = await fetch(`/api/followups?${params}`, { signal: controller.signal });
        if (!res.ok) throw new Error();
        const data = await res.json();
        if (!controller.signal.aborted) setFollowUps(data.data);
      } catch {
        if (!controller.signal.aborted) setToast({ message: "Failed to load follow-ups", type: "error" });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void fetchFollowUps();
    return () => controller.abort();
  }, [activeTab]);

  async function updateStatus(id: string, status: string) {
    const res = await fetch(`/api/followups/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setFollowUps((prev) => prev.filter((f) => f.id !== id));
      showToast(`Marked as ${status}`);
    } else {
      showToast("Update failed", "error");
    }
  }

  const todayStr = new Date().toISOString().split("T")[0];

  function isOverdue(dateStr: string) {
    return dateStr < todayStr;
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-slate-950">Follow-ups</h1>
        <p className="mt-0.5 text-sm text-slate-500">Track and complete scheduled follow-ups</p>
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {TABS.map((tab) => (
          <button
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              activeTab === tab.value
                ? "bg-white text-slate-950 shadow-sm"
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <Card>
        {loading ? (
          <div className="px-5 py-12 text-center text-sm text-slate-400">Loading…</div>
        ) : followUps.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-sm font-medium text-slate-600">No follow-ups found</p>
            <p className="mt-1 text-sm text-slate-400">
              {activeTab === "today" ? "Nothing due today — nice!" : "Nothing in this category."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-50">
            {followUps.map((fu) => (
              <li key={fu.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{fu.message}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <span className={`text-xs ${isOverdue(fu.followUpDate) && fu.status === "Pending" ? "text-red-500 font-medium" : "text-slate-400"}`}>
                      {isOverdue(fu.followUpDate) && fu.status === "Pending" ? "⚠ Overdue · " : ""}
                      {new Date(fu.followUpDate + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </span>
                    <Link href={`/leads/${fu.leadId}`} className="text-xs text-indigo-600 hover:underline">
                      View lead →
                    </Link>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <StatusBadge status={fu.status} />
                  {fu.status === "Pending" && (
                    <>
                      <Button variant="ghost" className="min-h-7 px-2 text-xs" onClick={() => updateStatus(fu.id, "Completed")}>
                        ✓ Done
                      </Button>
                      <Button variant="ghost" className="min-h-7 px-2 text-xs text-slate-400" onClick={() => updateStatus(fu.id, "Cancelled")}>
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
