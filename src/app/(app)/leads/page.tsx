"use client";

import { useEffect, useState } from "react";
import {
  Button,
  Card,
  CardToolbar,
  ConfirmDialog,
  EmptyState,
  Input,
  PageShell,
  Pagination,
  Select,
  Toast,
} from "@/shared/ui";
import { LeadTable } from "@/features/leads/components/LeadTable";
import { useLeads } from "@/features/leads/useLeads";
import { useToast } from "@/shared/hooks/useToast";
import { LEAD_STATUSES } from "@/shared/constants";
import { Icon } from "@/shared/icons/Icon";

const STATUS_OPTIONS = LEAD_STATUSES.map((status) => ({ label: status, value: status }));
const SORT_OPTIONS = [
  { label: "Newest first", value: "desc" },
  { label: "Oldest first", value: "asc" },
];

interface UserOption {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

export default function LeadsPage() {
  const [search, setSearch] = useState("");
  const [searchInput, setInput] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState<"asc" | "desc">("desc");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkAssignee, setBulkAssignee] = useState("");
  const [bulkWorking, setBulkWorking] = useState(false);
  const [role, setRole] = useState("");
  const [agentOptions, setAgentOptions] = useState<UserOption[]>([]);
  const { toast, showToast, clearToast } = useToast();
  const [limit, setLimit] = useState(10);
  const { leads, pagination, loading, error, fetchLeads, deleteLead, bulkUpdateLeads, bulkDeleteLeads } = useLeads({ search, status, sort, limit });
  const canAssign = role === "admin" || role === "manager";
  const canDelete = role === "admin";

  useEffect(() => {
    const savedLimit = localStorage.getItem("pref_leads_limit");
    if (savedLimit) {
      setTimeout(() => {
        setLimit(Number(savedLimit));
      }, 0);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadBulkContext() {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) return;
      const meJson = await meRes.json();
      const currentRole = meJson.data?.role ?? "";
      if (cancelled) return;
      setRole(currentRole);
      if (currentRole !== "admin" && currentRole !== "manager") return;

      const usersRes = await fetch("/api/users");
      if (!usersRes.ok) return;
      const usersJson = await usersRes.json();
      if (cancelled) return;
      setAgentOptions((usersJson.data as UserOption[]).filter((user) => user.role === "agent" && user.isActive));
    }

    void loadBulkContext();
    return () => {
      cancelled = true;
    };
  }, []);

  async function confirmDelete() {
    if (!deleteId) return;
    setDeleting(true);
    const res = await deleteLead(deleteId);
    if (!res.ok) {
      showToast("Delete failed", "error");
    } else {
      showToast("Lead deleted");
      setDeleteId(null);
    }
    setDeleting(false);
  }

  function toggleLead(id: string) {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id],
    );
  }

  function togglePage() {
    const pageIds = leads.map((lead) => lead.id);
    const allSelected = pageIds.every((id) => selectedIds.includes(id));
    setSelectedIds((current) =>
      allSelected
        ? current.filter((id) => !pageIds.includes(id))
        : Array.from(new Set([...current, ...pageIds])),
    );
  }

  async function applyBulkStatus() {
    if (!bulkStatus) return;
    setBulkWorking(true);
    const res = await bulkUpdateLeads({ ids: selectedIds, status: bulkStatus });
    if (!res.ok) {
      showToast("Bulk status update failed", "error");
    } else {
      showToast(`${selectedIds.length} leads updated`);
      setSelectedIds([]);
      setBulkStatus("");
    }
    setBulkWorking(false);
  }

  async function applyBulkAssign() {
    if (!bulkAssignee) return;
    setBulkWorking(true);
    const res = await bulkUpdateLeads({
      ids: selectedIds,
      assignedTo: bulkAssignee === "__unassigned" ? null : bulkAssignee,
    });
    if (!res.ok) {
      showToast("Bulk assignment failed", "error");
    } else {
      showToast(`${selectedIds.length} leads reassigned`);
      setSelectedIds([]);
      setBulkAssignee("");
    }
    setBulkWorking(false);
  }

  async function confirmBulkDeleteLeads() {
    setDeleting(true);
    const res = await bulkDeleteLeads(selectedIds);
    if (!res.ok) {
      showToast("Bulk delete failed", "error");
    } else {
      showToast(`${selectedIds.length} leads deleted`);
      setSelectedIds([]);
      setConfirmBulkDelete(false);
    }
    setDeleting(false);
  }

  return (
    <PageShell
      title="Leads"
      description={`${pagination.total} total leads. Qualify new opportunities, assign ownership, and keep follow-ups moving.`}
      actions={
        <Button href="/leads/new">
          <Icon name="plus" />
          New lead
        </Button>
      }
    >
      <Card>
        {selectedIds.length > 0 ? (
          <CardToolbar className="items-center justify-between bg-blue-50/70">
            <div className="flex items-center gap-3">
              <span className="grid size-8 place-items-center rounded-full bg-blue-600 text-sm font-semibold text-white">
                {selectedIds.length}
              </span>
              <div>
                <p className="text-sm font-semibold text-gray-950">Selected leads</p>
                <p className="text-xs text-gray-500">Apply one action to the current selection.</p>
              </div>
            </div>
            <div className="flex flex-1 flex-wrap items-center justify-end gap-2">
              <Select
                label="Bulk status"
                hideLabel
                value={bulkStatus}
                onChange={(e) => setBulkStatus(e.target.value)}
                placeholder="Update status"
                options={STATUS_OPTIONS}
                wrapperClassName="w-full sm:w-44"
              />
              <Button type="button" variant="secondary" onClick={applyBulkStatus} disabled={!bulkStatus || bulkWorking}>
                Update status
              </Button>
              {canAssign && (
                <>
                  <Select
                    label="Assign leads"
                    hideLabel
                    value={bulkAssignee}
                    onChange={(e) => setBulkAssignee(e.target.value)}
                    placeholder="Assign"
                    options={[
                      { label: "Unassigned", value: "__unassigned" },
                      ...agentOptions.map((agent) => ({ label: agent.name, value: agent.id })),
                    ]}
                    wrapperClassName="w-full sm:w-44"
                  />
                  <Button type="button" variant="secondary" onClick={applyBulkAssign} disabled={!bulkAssignee || bulkWorking}>
                    Assign
                  </Button>
                </>
              )}
              {canDelete && (
                <Button type="button" variant="danger" onClick={() => setConfirmBulkDelete(true)} disabled={bulkWorking}>
                  Delete
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={() => setSelectedIds([])} disabled={bulkWorking}>
                Clear
              </Button>
            </div>
          </CardToolbar>
        ) : (
          <CardToolbar className="items-center justify-between gap-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput);
              }}
              className="flex items-center gap-2"
            >
              <Input
                label="Search leads"
                hideLabel
                value={searchInput}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Search name, email, company"
                list="lead-search-suggestions"
                icon={
                  <Icon name="search" className="text-gray-400" />
                }
                wrapperClassName="w-full sm:w-80"
              />
              <datalist id="lead-search-suggestions">
                {leads.flatMap((lead) => [lead.name, lead.email, lead.company].filter(Boolean) as string[]).map((value) => (
                  <option key={value} value={value} />
                ))}
              </datalist>
              {search && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSearch("");
                    setInput("");
                  }}
                >
                  Clear
                </Button>
              )}
            </form>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="text-gray-500 hover:text-gray-950">
                <Icon name="filter" className="mr-1.5" />
                Filters
              </Button>
              <Select
                label="Status"
                hideLabel
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                placeholder="All statuses"
                options={STATUS_OPTIONS}
                wrapperClassName="w-full sm:w-40"
              />
              <Select
                label="Sort"
                hideLabel
                value={sort}
                onChange={(e) => setSort(e.target.value as "asc" | "desc")}
                options={SORT_OPTIONS}
                wrapperClassName="w-full sm:w-36"
              />
            </div>
          </CardToolbar>
        )}

        {loading ? (
          <EmptyState title="Loading..." description="Fetching the latest leads." />
        ) : error ? (
          <EmptyState title="Could not load leads" description={error} />
        ) : (
          <LeadTable
            leads={leads}
            selectedIds={selectedIds}
            onToggle={toggleLead}
            onToggleAll={togglePage}
            onDelete={setDeleteId}
            canDelete={canDelete}
          />
        )}
         <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={fetchLeads}
          limit={limit}
          onLimitChange={(newLimit) => {
            setLimit(newLimit);
            localStorage.setItem("pref_leads_limit", String(newLimit));
          }}
        />
      </Card>

      {deleteId && (
        <ConfirmDialog
          title="Delete lead?"
          message="This will permanently remove the lead and all follow-ups."
          onConfirm={confirmDelete}
          onCancel={() => setDeleteId(null)}
          loading={deleting}
        />
      )}
      {confirmBulkDelete && (
        <ConfirmDialog
          title="Delete selected leads?"
          message={`This will permanently remove ${selectedIds.length} leads and all related follow-ups.`}
          onConfirm={confirmBulkDeleteLeads}
          onCancel={() => setConfirmBulkDelete(false)}
          loading={deleting}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </PageShell>
  );
}
