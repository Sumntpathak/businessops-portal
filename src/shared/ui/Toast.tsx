"use client";

import { useEffect } from "react";
import { cn } from "@/shared/utils/cn";
import { radiusControl, transitionBase } from "@/shared/ui/styles";

export type ToastType = "success" | "error" | "info";

interface ToastProps {
  message: string;
  type?: ToastType;
  onClose: () => void;
  duration?: number;
}

const STYLES: Record<ToastType, string> = {
  success: "bg-emerald-600 text-white",
  error: "bg-red-600 text-white",
  info: "bg-gray-900 text-white",
};

export function Toast({ message, type = "info", onClose, duration = 3500 }: ToastProps) {
  useEffect(() => {
    const t = setTimeout(onClose, duration);
    return () => clearTimeout(t);
  }, [onClose, duration]);

  return (
    <div
      className={cn(
        "fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-3 text-sm font-medium shadow-lg",
        radiusControl,
        transitionBase,
        STYLES[type],
      )}
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onClose}
        className="text-lg leading-none opacity-70 hover:opacity-100"
        aria-label="Dismiss notification"
      >
        x
      </button>
    </div>
  );
}
