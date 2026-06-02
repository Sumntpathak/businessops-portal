"use client";
import { useCallback, useEffect, useState } from "react";

interface ApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  status: number | null;
}

export function useApiResource<T>(url: string | null) {
  const [state, setState] = useState<ApiState<T>>({
    data: null,
    loading: Boolean(url),
    error: null,
    status: null,
  });

  const load = useCallback(async (signal?: AbortSignal) => {
    if (!url) return;
    setState((current) => ({ ...current, loading: true, error: null }));

    try {
      const res = await fetch(url, { signal });
      const json = await res.json();
      if (signal?.aborted) return;

      if (!res.ok) {
        setState({ data: null, loading: false, error: json.error ?? "Request failed", status: res.status });
        return;
      }

      setState({ data: json.data ?? json, loading: false, error: null, status: res.status });
    } catch (error) {
      if (signal?.aborted) return;
      setState({
        data: null,
        loading: false,
        error: error instanceof DOMException && error.name === "AbortError" ? null : "Network error",
        status: null,
      });
    }
  }, [url]);

  useEffect(() => {
    const controller = new AbortController();

    async function loadInitial() {
      await load(controller.signal);
    }

    void loadInitial();
    return () => controller.abort();
  }, [load]);

  const refetch = useCallback(() => load(), [load]);

  return { ...state, refetch };
}
