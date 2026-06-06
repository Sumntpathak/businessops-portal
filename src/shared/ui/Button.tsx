import type { ButtonHTMLAttributes } from "react";
import Link from "next/link";
import { cn } from "@/shared/utils/cn";
import { focusRing, radiusControl, transitionBase } from "@/shared/ui/styles";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  href?: string;
}

const variants: Record<ButtonVariant, string> = {
  primary: "bg-blue-600 text-white shadow-sm hover:bg-blue-700 focus-visible:ring-blue-200",
  secondary: "border border-gray-200 bg-white text-gray-900 shadow-sm hover:border-gray-300 hover:bg-gray-50 focus-visible:ring-blue-100",
  ghost: "text-gray-600 hover:bg-gray-100 hover:text-gray-950 focus-visible:ring-blue-100",
  danger: "border border-red-200 bg-white text-red-600 hover:bg-red-50 focus-visible:ring-red-200",
};

const sizes: Record<ButtonSize, string> = {
  sm: "min-h-8 rounded-lg px-3 text-xs",
  md: `min-h-10 ${radiusControl} px-4 text-sm`,
};

export function buttonClassName({
  className,
  size = "md",
  variant = "primary",
}: {
  className?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
}) {
  return cn(
    "inline-flex max-w-full min-w-0 items-center justify-center gap-2 whitespace-normal text-center font-medium leading-5 disabled:cursor-not-allowed disabled:opacity-60",
    transitionBase,
    focusRing,
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({ className, href, size = "md", variant = "primary", type = "button", ...props }: ButtonProps) {
  const classes = buttonClassName({ className, size, variant });

  if (href) {
    return (
      <Link href={href} className={classes}>
        {props.children}
      </Link>
    );
  }

  return <button type={type} className={classes} {...props} />;
}
