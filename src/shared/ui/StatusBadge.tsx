import { cn } from "@/shared/utils/cn";

const LEAD_STATUS_STYLES: Record<string, string> = {
  New: "bg-blue-50 text-blue-700 border-blue-200",
  Contacted: "bg-yellow-50 text-yellow-700 border-yellow-200",
  "Follow-Up": "bg-purple-50 text-purple-700 border-purple-200",
  Converted: "bg-green-50 text-green-700 border-green-200",
  Lost: "bg-red-50 text-red-700 border-red-200",
};

const FOLLOWUP_STATUS_STYLES: Record<string, string> = {
  Pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  Completed: "bg-green-50 text-green-700 border-green-200",
  Cancelled: "bg-slate-50 text-slate-500 border-slate-200",
};

const INVOICE_STATUS_STYLES: Record<string, string> = {
  Draft: "bg-slate-50 text-slate-600 border-slate-200",
  Sent: "bg-blue-50 text-blue-700 border-blue-200",
  Paid: "bg-green-50 text-green-700 border-green-200",
  Cancelled: "bg-red-50 text-red-700 border-red-200",
};

const ALL_STYLES = {
  ...LEAD_STATUS_STYLES,
  ...FOLLOWUP_STATUS_STYLES,
  ...INVOICE_STATUS_STYLES,
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
        ALL_STYLES[status] ?? "bg-slate-50 text-slate-600 border-slate-200",
        className
      )}
    >
      {status}
    </span>
  );
}
