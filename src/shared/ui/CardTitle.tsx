import type { HTMLAttributes } from "react";
import { cn } from "@/shared/utils/cn";
import { cardSectionTitleBase, cardTitleBase } from "@/shared/ui/styles";

interface CardTitleProps extends HTMLAttributes<HTMLHeadingElement> {
  as?: "h2" | "h3";
  size?: "md" | "sm";
}

export function CardTitle({ as: Tag = "h2", className, size = "md", ...props }: CardTitleProps) {
  return (
    <Tag
      className={cn(size === "md" ? cardTitleBase : cardSectionTitleBase, className)}
      {...props}
    />
  );
}
