"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { APP_NAME, type Role } from "@/lib/constants";
import { Badge, Button } from "@/components/ui";

interface NavItem {
  href: string;
  label: string;
  shortLabel: string;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", shortLabel: "DB", roles: ["admin", "manager", "agent", "finance"] },
  { href: "/leads", label: "Leads", shortLabel: "LD", roles: ["admin", "manager", "agent", "finance"] },
  { href: "/followups", label: "Follow-ups", shortLabel: "FU", roles: ["admin", "manager", "agent", "finance"] },
  { href: "/invoices", label: "Invoices", shortLabel: "IN", roles: ["admin", "manager", "finance"] },
  { href: "/users", label: "Users", shortLabel: "US", roles: ["admin", "manager"] },
  { href: "/audit-logs", label: "Audit logs", shortLabel: "AL", roles: ["admin", "manager"] },
  { href: "/settings", label: "Settings", shortLabel: "ST", roles: ["admin", "manager", "agent", "finance"] },
];

interface Props {
  user: { name: string; email: string; role: Role };
}

export default function Sidebar({ user }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-full w-72 flex-col border-r border-slate-200 bg-white">
      <div className="px-5 py-5">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-lg bg-slate-950 text-sm font-semibold text-white">
            BO
          </span>
          <span>
            <span className="block text-base font-semibold text-slate-950">{APP_NAME}</span>
            <span className="block text-xs text-slate-500">Operations portal</span>
          </span>
        </Link>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {visibleNav.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                isActive
                  ? "bg-slate-950 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950"
              }`}
            >
              <span
                className={`grid size-7 place-items-center rounded-md text-[11px] font-semibold ${
                  isActive ? "bg-white/15 text-white" : "bg-slate-100 text-slate-500"
                }`}
              >
                {item.shortLabel}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-full bg-slate-100 text-sm font-semibold text-slate-700">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-950">{user.name}</p>
            <p className="truncate text-xs text-slate-500">{user.email}</p>
          </div>
        </div>
        <div className="mb-4">
          <Badge className="capitalize">{user.role}</Badge>
        </div>
        <Button variant="ghost" onClick={handleLogout} className="w-full justify-start px-3">
          Sign out
        </Button>
      </div>
    </aside>
  );
}
