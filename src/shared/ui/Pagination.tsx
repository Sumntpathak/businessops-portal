"use client";

import { Button } from "./Button";

interface PaginationProps {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  limit?: number;
  onLimitChange?: (limit: number) => void;
}

export function Pagination({ page, totalPages, onPageChange, limit, onLimitChange }: PaginationProps) {
  const showControls = totalPages > 1 || limit !== undefined;
  if (!showControls) return null;

  return (
    <div className="flex flex-col items-stretch justify-between gap-3 border-t border-gray-100 bg-white px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="flex flex-wrap items-center gap-3 sm:gap-4">
        <p className="text-sm text-gray-500 select-none">
          Page {page} of {totalPages || 1}
        </p>
        {limit !== undefined && onLimitChange !== undefined && (
          <div className="flex items-center gap-1.5 text-xs text-gray-500 select-none">
            <span>Show:</span>
            <select
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-700 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 cursor-pointer"
            >
              {[5, 10, 25, 50, 100].map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Button
            variant="secondary"
            className="min-h-8 px-3 text-xs font-semibold"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            className="min-h-8 px-3 text-xs font-semibold"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
