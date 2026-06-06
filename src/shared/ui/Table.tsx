import type { HTMLAttributes, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";
import { transitionBase } from "@/shared/ui/styles";

export function Table({ className, wrapperClassName, ...props }: TableHTMLAttributes<HTMLTableElement> & { wrapperClassName?: string }) {
  return (
    <div className={cn("max-w-full overflow-x-auto", wrapperClassName)}>
      <table className={cn("min-w-full text-sm", className)} {...props} />
    </div>
  );
}

export function TableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-gray-100 bg-gray-50/70", className)} {...props} />;
}

export function TableBody({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-gray-100", className)} {...props} />;
}

export function TableHeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      className={cn(
        "sticky top-0 z-10 whitespace-nowrap bg-gray-50/95 px-3 py-3 text-left text-xs font-medium uppercase tracking-wide text-gray-500 backdrop-blur-sm border-b border-gray-100 sm:px-4",
        className
      )}
      {...props}
    />
  );
}

export function TableCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("max-w-[18rem] break-words px-3 py-3 align-middle text-gray-600 sm:px-4 sm:py-3.5", className)} {...props} />;
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn(transitionBase, "hover:bg-blue-50/30", className)} {...props} />;
}
