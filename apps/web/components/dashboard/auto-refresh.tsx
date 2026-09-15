"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

interface AutoRefreshProps {
  intervalMs?: number;
}

/** Re-fetches the current server component tree on an interval while the tab is visible. */
export function AutoRefresh({ intervalMs = 5000 }: AutoRefreshProps) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
