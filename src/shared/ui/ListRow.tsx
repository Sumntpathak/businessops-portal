import type { HTMLAttributes, LiHTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";
import { transitionBase } from "@/shared/ui/styles";

export function ListBody({ className, ...props }: HTMLAttributes<HTMLUListElement>) {
  return <ul className={cn("divide-y divide-gray-100", className)} {...props} />;
}

export function ListRow({ className, ...props }: LiHTMLAttributes<HTMLLIElement>) {
  return (
    <li
      className={cn(
        "flex items-start justify-between gap-4 px-5 py-4",
        transitionBase,
        "hover:bg-blue-50/30",
        className,
      )}
      {...props}
    />
  );
}
