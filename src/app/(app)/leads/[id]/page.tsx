"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, CardBody, CardHeader, ConfirmDialog, StatusBadge, Toast, type ToastType } from "@/shared/ui";

interface Lead {
  id: string; name: string; email: string; phone: string | null;
  company: string | null; source: string; status: string;
  assigneeName: string | null; notes: string | null;
  createdAt: string; updatedAt: string;
}

interface FollowUp {
  id: string; message: string; followUpDate: string;
  status: string; createdAt: string;
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newFU, setNewFU] = useState({ followUpDate: "", message: "" });
  const [addingFU, setAddingFU] = useState(false);
  const [showAddFU, setShowAddFU] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);

  const showToast = (msg: string, type: ToastType = "success") => setToast({ message: msg, type });

  useEffect(() => {
    const controller = new AbortController();

    async function fetchLead() {
      try {
        const [leadRes, fuRes] = await Promise.all([
          fetch(`/api/leads/${id}`, { signal: controller.signal }),
          fetch(`/api/leads/${id}/followups`, { signal: controller.signal }),
        ]);
        if (controller.signal.aborted) return;
        if (leadRes.status === 403 || leadRes.status === 404) {
          setNotFound(true);
          return;
        }
        if (!leadRes.ok) throw new Error();
        const leadData = await leadRes.json();
        const fuData = await fuRes.json();
        if (controller.signal.aborted) return;
        setLead(leadData.data);
        setFollowUps(fuData.data);
      } catch {
        if (!controller.signal.aborted) setToast({ message: "Failed to load lead", type: "error" });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void fetchLead();
    return () => controller.abort();
  }, [id]);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
    if (res.ok) { router.push("/leads"); return; }
    const data = await res.json();
    showToast(data.error ?? "Delete failed", "error");
    setDeleting(false);
    setShowDelete(false);
  }

  async function handleAddFollowUp(e: React.FormEvent) {
    e.preventDefault();
    setAddingFU(true);
    try {
      const res = await fetch(`/api/leads/${id}/followups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newFU),
      });
      const data = await res.json();
      if (!res.ok) { showToast(data.error ?? "Failed to add follow-up", "error"); return; }
      setFollowUps((prev) => [...prev, data.data]);
      setNewFU({ followUpDate: "", message: "" });
      setShowAddFU(false);
      showToast("Follow-up added");
    } catch { showToast("Network error", "error"); }
    finally { setAddingFU(false); }
  }

  async function updateFUStatus(fuId: string, status: string) {
    const res = await fetch(`/api/followups/${fuId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setFollowUps((prev) => prev.map((f) => f.id === fuId ? { ...f, status } : f));
      showToast(`Marked as ${status}`);
    } else {
      showToast("Update failed", "error");
    }
  }

  if (loading) return <div className="py-20 text-center text-sm text-slate-400">Loading…</div>;
  if (notFound) return (
    <div className="py-20 text-center">
      <p className="text-slate-600 font-medium">Lead not found or access denied.</p>
      <Link href="/leads"><Button variant="secondary" className="mt-4">Back to leads</Button></Link>
    </div>
  );
  if (!lead) return null;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Breadcrumb + actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Link href="/leads" className="text-slate-500 hover:text-slate-800">Leads</Link>
          <span className="text-slate-300">/</span>
          <span className="font-medium text-slate-950">{lead.name}</span>
        </div>
        <div className="flex gap-2">
          <Link href={`/leads/${id}/edit`}><Button variant="secondary">Edit</Button></Link>
          <Button variant="danger" onClick={() => setShowDelete(true)}>Delete</Button>
        </div>
      </div>

      {/* Lead info */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-slate-950">{lead.name}</h1>
            <StatusBadge status={lead.status} />
          </div>
        </CardHeader>
        <CardBody>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            {[
              ["Email", lead.email],
              ["Phone", lead.phone ?? "—"],
              ["Company", lead.company ?? "—"],
              ["Source", lead.source],
              ["Assigned to", lead.assigneeName ?? "Unassigned"],
              ["Created", new Date(lead.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-xs font-medium text-slate-400 uppercase tracking-wide">{label}</dt>
                <dd className="mt-1 text-slate-800">{value}</dd>
              </div>
            ))}
          </dl>
          {lead.notes && (
            <div className="mt-4 rounded-lg bg-slate-50 border border-slate-100 px-4 py-3">
              <p className="text-xs font-medium text-slate-400 uppercase tracking-wide mb-1">Notes</p>
              <p className="text-sm text-slate-700 whitespace-pre-wrap">{lead.notes}</p>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Follow-ups */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-950">Follow-ups</h2>
            <Button variant="secondary" className="min-h-8 px-3 text-xs" onClick={() => setShowAddFU((v) => !v)}>
              + Add follow-up
            </Button>
          </div>
        </CardHeader>

        {showAddFU && (
          <div className="border-b border-slate-100 px-5 py-4 bg-slate-50">
            <form onSubmit={handleAddFollowUp} className="flex flex-wrap gap-3 items-end">
              <label className="block">
                <span className="block text-xs font-medium text-slate-600 mb-1">Date *</span>
                <input
                  type="date"
                  required
                  value={newFU.followUpDate}
                  onChange={(e) => setNewFU((p) => ({ ...p, followUpDate: e.target.value }))}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <label className="flex-1 block min-w-48">
                <span className="block text-xs font-medium text-slate-600 mb-1">Message *</span>
                <input
                  type="text"
                  required
                  value={newFU.message}
                  onChange={(e) => setNewFU((p) => ({ ...p, message: e.target.value }))}
                  placeholder="What needs to happen?"
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200"
                />
              </label>
              <Button type="submit" disabled={addingFU}>{addingFU ? "Adding…" : "Add"}</Button>
              <Button type="button" variant="ghost" onClick={() => setShowAddFU(false)}>Cancel</Button>
            </form>
          </div>
        )}

        <CardBody className="p-0">
          {followUps.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No follow-ups yet.</p>
          ) : (
            <ul className="divide-y divide-slate-50">
              {followUps.map((fu) => (
                <li key={fu.id} className="flex items-start justify-between gap-4 px-5 py-4">
                  <div>
                    <p className="text-sm font-medium text-slate-800">{fu.message}</p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      Due: {new Date(fu.followUpDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <StatusBadge status={fu.status} />
                    {fu.status === "Pending" && (
                      <>
                        <Button variant="ghost" className="min-h-7 px-2 text-xs" onClick={() => updateFUStatus(fu.id, "Completed")}>✓ Done</Button>
                        <Button variant="ghost" className="min-h-7 px-2 text-xs text-slate-400" onClick={() => updateFUStatus(fu.id, "Cancelled")}>Cancel</Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      {showDelete && (
        <ConfirmDialog
          title="Delete this lead?"
          message={`"${lead.name}" and all associated follow-ups will be permanently removed.`}
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
          loading={deleting}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </div>
  );
}
