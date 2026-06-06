import { cn } from "@/shared/utils/cn";
import { badgeBase } from "@/shared/ui/styles";

const LEAD_STATUS_STYLES: Record<string, string> = {
  New: "bg-blue-50 text-blue-700 border-blue-100",
  Contacted: "bg-amber-50 text-amber-700 border-amber-100",
  "Follow-Up": "bg-indigo-50 text-indigo-700 border-indigo-100",
  Converted: "bg-emerald-50 text-emerald-700 border-emerald-100",
  Lost: "bg-red-50 text-red-700 border-red-100",
};

const FOLLOWUP_STATUS_STYLES: Record<string, string> = {
  Pending: "bg-amber-50 text-amber-700 border-amber-100",
  Completed: "bg-emerald-50 text-emerald-700 border-emerald-100",
  Cancelled: "bg-gray-50 text-gray-500 border-gray-200",
};

const INVOICE_STATUS_STYLES: Record<string, string> = {
  Draft: "bg-gray-50 text-gray-600 border-gray-200",
  Sent: "bg-blue-50 text-blue-700 border-blue-100",
  Paid: "bg-emerald-50 text-emerald-700 border-emerald-100",
  Cancelled: "bg-red-50 text-red-700 border-red-100",
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
        badgeBase,
        ALL_STYLES[status] ?? "border-gray-200 bg-gray-50 text-gray-600",
        className,
      )}
    >
      {status}
    </span>
  );
}
