"use client";
import { useCallback, useEffect, useState } from "react";

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  source: string;
  status: string;
  assignedTo: string | null;
  assigneeName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Pagination {
  page: number;
  totalPages: number;
  total: number;
}

interface Filters {
  search?: string;
  status?: string;
  sort?: "asc" | "desc";
  page?: number;
  limit?: number;
}

export function useLeads(filters: Filters = {}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLeads = useCallback(async (page = filters.page ?? 1, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);

    try {
      const limitVal = filters.limit ? String(filters.limit) : "10";
      const params = new URLSearchParams({ page: String(page), limit: limitVal, sort: filters.sort ?? "desc" });
      if (filters.search) params.set("search", filters.search);
      if (filters.status) params.set("status", filters.status);

      const res = await fetch(`/api/leads?${params}`, { signal });
      const json = await res.json();
      if (signal?.aborted) return;

      if (!res.ok) {
        setError(res.status === 403 ? "Access denied" : json.error ?? "Failed to load");
        return;
      }

      setLeads(json.data);
      setPagination({
        page: json.pagination.page,
        totalPages: json.pagination.totalPages,
        total: json.pagination.total,
      });
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof DOMException && err.name === "AbortError" ? null : "Network error");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [filters.page, filters.search, filters.status, filters.sort, filters.limit]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitial() {
      await fetchLeads(1, controller.signal);
    }

    void loadInitial();
    return () => controller.abort();
  }, [fetchLeads]);

  const deleteLead = async (id: string) => {
    const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
    if (res.ok) await fetchLeads(pagination.page);
    return res;
  };

  const bulkUpdateLeads = async (payload: { ids: string[]; status?: string; assignedTo?: string | null }) => {
    const res = await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (res.ok) await fetchLeads(pagination.page);
    return res;
  };

  const bulkDeleteLeads = async (ids: string[]) => {
    const res = await fetch("/api/leads", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
    if (res.ok) await fetchLeads(pagination.page);
    return res;
  };

  return { leads, pagination, loading, error, fetchLeads, deleteLead, bulkUpdateLeads, bulkDeleteLeads };
}
