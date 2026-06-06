import type { ComponentProps } from "react";
import Link from "next/link";
import { cn } from "@/shared/utils/cn";
import { linkBase } from "@/shared/ui/styles";

type AppLinkProps = ComponentProps<typeof Link>;

export function AppLink({ className, ...props }: AppLinkProps) {
  return <Link className={cn(linkBase, className)} {...props} />;
}
