"use client";
import { useState, useEffect, useCallback } from "react";

export interface InvoiceSummary {
  id: string; invoiceNumber: string; clientName: string;
  status: string; totalAmount: string; createdAt: string;
  leadId: string | null;
}

interface Pagination { page: number; totalPages: number; total: number; }
interface Filters { search?: string; status?: string; limit?: number; }

export function useInvoices(filters: Filters = {}) {
  const [invoices, setInvoices] = useState<InvoiceSummary[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch_ = useCallback(async (page = 1, signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams({ page: String(page), limit: String(filters.limit ?? 10) });
      if (filters.search) p.set("search", filters.search);
      if (filters.status) p.set("status", filters.status);
      const res = await fetch(`/api/invoices?${p}`, { signal });
      const json = await res.json();
      if (signal?.aborted) return;
      if (!res.ok) {
        setError(json.error ?? "Failed to load");
        return;
      }
      setInvoices(json.data);
      setPagination({ page: json.pagination.page, totalPages: json.pagination.totalPages, total: json.pagination.total });
    } catch (err) {
      if (signal?.aborted) return;
      setError(err instanceof DOMException && err.name === "AbortError" ? null : "Network error");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [filters.search, filters.status, filters.limit]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitial() {
      await fetch_(1, controller.signal);
    }

    void loadInitial();
    return () => controller.abort();
  }, [fetch_]);

  return { invoices, pagination, loading, error, refetch: fetch_ };
}
