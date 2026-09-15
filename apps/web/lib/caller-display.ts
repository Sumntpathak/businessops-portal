const AVATAR_PALETTE = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
] as const;

export const STATUS_STYLES: Record<string, string> = {
  completed: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  failed: "bg-red-500/10 text-red-600 dark:text-red-400",
  in_progress: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  ringing: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  transferred: "bg-violet-500/10 text-violet-600 dark:text-violet-400"
};

export function paletteFor(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length] as string;
}

export function initialsFor(name: string | null, phone: string): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    const initials = (parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "");
    if (initials) return initials.toUpperCase();
  }
  return phone.slice(-2);
}

export function lastFour(phone: string): string {
  return "••••" + phone.slice(-4);
}

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return seconds + "s";
  return Math.floor(seconds / 60) + "m " + (seconds % 60) + "s";
}

export function isActiveStatus(status: string): boolean {
  return status === "in_progress" || status === "ringing";
}
