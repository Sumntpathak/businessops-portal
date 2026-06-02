"use client";
import { useState } from "react";
import Link from "next/link";
import { Button, Card, ConfirmDialog, Pagination, Toast } from "@/shared/ui";
import { LeadTable } from "@/features/leads/components/LeadTable";
import { useLeads } from "@/features/leads/useLeads";
import { useToast } from "@/shared/hooks/useToast";
import { LEAD_STATUSES } from "@/shared/constants";

export default function LeadsPage() {
  const [search, setSearch]     = useState("");
  const [searchInput, setInput] = useState("");
  const [status, setStatus]     = useState("");
  const [sort, setSort]         = useState<"asc"|"desc">("desc");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const { toast, showToast, clearToast } = useToast();
  const { leads, pagination, loading, error, fetchLeads, deleteLead } = useLeads({ search, status, sort });

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleting(true);
    const res = await deleteLead(deleteId);
    if (!res.ok) showToast("Delete failed", "error");
    else { showToast("Lead deleted"); setDeleteId(null); }
    setDeleting(false);
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">Leads</h1>
          <p className="mt-0.5 text-sm text-slate-500">{pagination.total} total</p>
        </div>
        <Link href="/leads/new"><Button>+ New lead</Button></Link>
      </div>

      <Card className="mb-4">
        <div className="flex flex-wrap items-end gap-3 px-4 py-3">
          <form onSubmit={(e) => { e.preventDefault(); setSearch(searchInput); }} className="flex gap-2">
            <input value={searchInput} onChange={(e) => setInput(e.target.value)} placeholder="Search name, email, company…" className="w-64 rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-300" />
            <Button type="submit" variant="secondary" className="min-h-9 px-3 text-sm">Search</Button>
            {search && <Button variant="ghost" className="min-h-9 px-3 text-sm" onClick={() => { setSearch(""); setInput(""); }}>Clear</Button>}
          </form>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="">All statuses</option>
            {LEAD_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as "asc"|"desc")} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
        </div>
      </Card>

      <Card>
        {loading ? <div className="py-12 text-center text-sm text-slate-400">Loading…</div>
          : error  ? <div className="py-12 text-center text-sm text-red-500">{error}</div>
          : <LeadTable leads={leads} onDelete={setDeleteId} />}
        <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={fetchLeads} />
      </Card>

      {deleteId && <ConfirmDialog title="Delete lead?" message="This will permanently remove the lead and all follow-ups." onConfirm={confirmDelete} onCancel={() => setDeleteId(null)} loading={deleting} />}
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </div>
  );
}
