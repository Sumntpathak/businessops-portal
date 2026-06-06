"use client";

import { useEffect } from "react";
import { Button } from "@/shared/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const isDbError =
    error.message?.toLowerCase().includes("fetch failed") ||
    error.message?.toLowerCase().includes("neondb") ||
    error.name === "NeonDbError";

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="space-y-2">
        <h2 className="text-xl font-semibold text-gray-900">
          {isDbError ? "Database is waking up" : "Something went wrong"}
        </h2>
        <p className="max-w-sm text-sm text-gray-500">
          {isDbError
            ? "The database was idle and is starting back up. This takes 1–3 seconds. Hit retry and it should load."
            : "An unexpected error occurred. Try again or refresh the page."}
        </p>
        {error.digest && (
          <p className="text-xs text-gray-400">Error digest: {error.digest}</p>
        )}
      </div>
      <Button onClick={reset} variant="primary">
        Retry
      </Button>
    </div>
  );
}
