"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { APP_NAME, type Role } from "@/shared/constants";
import { Icon, type IconName } from "@/shared/icons/Icon";
import { Badge, Button } from "@/shared/ui";
import { cn } from "@/shared/utils/cn";
import { transitionBase } from "@/shared/ui/styles";

interface NavItem {
  href: string;
  label: string;
  icon: "dashboard" | "leads" | "followups" | "invoices" | "users" | "audit" | "settings";
  roles: Role[];
  group: "core" | "admin";
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "dashboard", group: "core", roles: ["admin", "manager", "agent", "finance"] },
  { href: "/leads", label: "Leads", icon: "leads", group: "core", roles: ["admin", "manager", "agent", "finance"] },
  { href: "/followups", label: "Follow-ups", icon: "followups", group: "core", roles: ["admin", "manager", "agent"] },
  { href: "/invoices", label: "Invoices", icon: "invoices", group: "core", roles: ["admin", "manager", "agent", "finance"] },
  { href: "/users", label: "Users", icon: "users", group: "admin", roles: ["admin", "manager"] },
  { href: "/audit-logs", label: "Audit logs", icon: "audit", group: "admin", roles: ["admin", "manager"] },
  { href: "/settings", label: "Settings", icon: "settings", group: "admin", roles: ["admin", "manager", "agent", "finance"] },
];

interface Props {
  user: { name: string; email: string; role: Role };
}

function NavIcon({ name }: { name: NavItem["icon"] }) {
  const icons: Record<NavItem["icon"], IconName> = {
    dashboard: "dashboard",
    leads: "users",
    followups: "clock",
    invoices: "invoice",
    users: "user",
    audit: "audit",
    settings: "settings",
  };

  return <Icon name={icons[name]} />;
}

export default function AppSidebar({ user }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));
  const coreNav = visibleNav.filter((item) => item.group === "core");
  const adminNav = visibleNav.filter((item) => item.group === "admin");
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setIsMobileOpen(false);
    router.push("/login");
    router.refresh();
  }

  function renderNavItem(item: NavItem, collapsed = isCollapsed, onNavigate?: () => void) {
    const isActive = pathname === item.href || pathname.startsWith(item.href + "/");

    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={onNavigate}
        title={collapsed ? item.label : undefined}
        className={cn(
          "flex items-center rounded-lg text-sm font-medium",
          collapsed ? "justify-center px-2 py-2.5" : "gap-3 px-3 py-2.5",
          transitionBase,
          isActive
            ? "bg-blue-50 text-blue-700"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-950",
        )}
      >
        <span className={cn("text-gray-400", isActive && "text-blue-600")}>
          <NavIcon name={item.icon} />
        </span>
        {!collapsed && <span className="min-w-0 truncate">{item.label}</span>}
      </Link>
    );
  }

  return (
    <>
    <header className="fixed inset-x-0 top-0 z-40 flex h-16 items-center justify-between border-b border-gray-200 bg-white/95 px-4 shadow-sm backdrop-blur lg:hidden">
      <Link href="/dashboard" className="flex min-w-0 items-center gap-3" onClick={() => setIsMobileOpen(false)}>
        <span className="grid size-9 place-items-center rounded-lg bg-blue-600 text-sm font-semibold text-white shadow-sm">
          B
        </span>
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold tracking-tight text-gray-950">{APP_NAME}</span>
          <span className="block truncate text-xs text-gray-500 capitalize">{user.role}</span>
        </span>
      </Link>
      <button
        type="button"
        aria-label="Open navigation"
        onClick={() => setIsMobileOpen(true)}
        className="grid size-10 place-items-center rounded-lg border border-gray-200 text-gray-600 transition hover:bg-gray-50"
      >
        <Icon name="moreVertical" />
      </button>
    </header>

    {isMobileOpen && (
      <div className="fixed inset-0 z-50 lg:hidden">
        <button
          type="button"
          aria-label="Close navigation"
          className="absolute inset-0 bg-gray-950/35"
          onClick={() => setIsMobileOpen(false)}
        />
        <aside className="relative flex h-full w-[min(20rem,calc(100vw-2rem))] flex-col border-r border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-4">
            <Link href="/dashboard" className="flex min-w-0 items-center gap-3" onClick={() => setIsMobileOpen(false)}>
              <span className="grid size-9 place-items-center rounded-lg bg-blue-600 text-sm font-semibold text-white shadow-sm">
                B
              </span>
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold tracking-tight text-gray-950">{APP_NAME}</span>
                <span className="block truncate text-xs text-gray-500">Sales and billing ops</span>
              </span>
            </Link>
            <button
              type="button"
              aria-label="Close navigation"
              onClick={() => setIsMobileOpen(false)}
              className="grid size-9 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            >
              <Icon name="chevronLeft" />
            </button>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {coreNav.map((item) => renderNavItem(item, false, () => setIsMobileOpen(false)))}
            {adminNav.length > 0 && (
              <div className="mt-4 border-t border-gray-100 pt-4">
                <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                  System admin
                </p>
                <div className="space-y-1">{adminNav.map((item) => renderNavItem(item, false, () => setIsMobileOpen(false)))}</div>
              </div>
            )}
          </nav>

          <div className="border-t border-gray-100 p-4">
            <div className="mb-3 flex min-w-0 items-center gap-3 rounded-lg bg-gray-50 p-3">
              <div className="grid size-10 place-items-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
                {initials}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-950">{user.name}</p>
                <p className="truncate text-xs text-gray-500">{user.email}</p>
              </div>
            </div>
            <Button variant="ghost" onClick={handleLogout} className="w-full justify-start px-2 text-red-600 hover:!text-red-700">
              Sign out
            </Button>
          </div>
        </aside>
      </div>
    )}

    <aside className={cn("hidden h-dvh flex-col border-r border-gray-200 bg-white transition-[width] duration-200 ease-out lg:flex", isCollapsed ? "w-20" : "w-72")}>
      <div className={cn("px-4 py-5", isCollapsed && "px-3")}>
        <div className="flex items-center justify-between gap-3">
          <Link href="/dashboard" className={cn("flex min-w-0 items-center gap-3", isCollapsed && "justify-center")}>
            <span className="grid size-9 place-items-center rounded-lg bg-blue-600 text-sm font-semibold text-white shadow-sm">
              B
            </span>
            {!isCollapsed && (
              <span className="min-w-0">
                <span className="block truncate text-base font-semibold tracking-tight text-gray-950">{APP_NAME}</span>
                <span className="block truncate text-xs text-gray-500">Sales and billing ops</span>
              </span>
            )}
          </Link>
          {!isCollapsed && (
            <button
              type="button"
              aria-label="Collapse sidebar"
              onClick={() => setIsCollapsed(true)}
              className="grid size-8 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
            >
              <Icon name="chevronLeft" />
            </button>
          )}
        </div>
        {isCollapsed && (
          <button
            type="button"
            aria-label="Expand sidebar"
            onClick={() => setIsCollapsed(false)}
            className="mx-auto mt-4 grid size-8 place-items-center rounded-lg text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <Icon name="chevronRight" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {coreNav.map((item) => renderNavItem(item))}
        {adminNav.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            {!isCollapsed && (
              <p className="mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                System admin
              </p>
            )}
            <div className="space-y-1">{adminNav.map((item) => renderNavItem(item))}</div>
          </div>
        )}
      </nav>

      <div className="relative border-t border-gray-100 p-4">
        <button
          type="button"
          onClick={() => setIsProfileOpen((open) => !open)}
          className={cn(
            "flex w-full items-center rounded-lg text-left transition hover:bg-gray-50",
            isCollapsed ? "justify-center p-2" : "gap-3 p-2",
          )}
          aria-expanded={isProfileOpen}
        >
          <div className="grid size-10 place-items-center rounded-full bg-gray-100 text-sm font-semibold text-gray-700">
            {initials}
          </div>
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-gray-950">{user.name}</p>
              <p className="truncate text-xs text-gray-500">{user.email}</p>
            </div>
          )}
        </button>

        {isProfileOpen && (
          <div className={cn("absolute bottom-20 z-20 rounded-lg border border-gray-200 bg-white p-2 shadow-lg", isCollapsed ? "left-3 w-56" : "left-4 right-4")}>
            <div className="border-b border-gray-100 px-2 pb-2">
              <p className="truncate text-sm font-semibold text-gray-950">{user.name}</p>
              <p className="truncate text-xs text-gray-500">{user.email}</p>
              <Badge className="mt-2 capitalize">{user.role}</Badge>
            </div>
            <Link
              href="/settings"
              onClick={() => setIsProfileOpen(false)}
              className="mt-2 flex items-center rounded-md px-2 py-2 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Settings
            </Link>
            <Button variant="ghost" onClick={handleLogout} className="w-full justify-start px-2 text-red-600 hover:!text-red-700">
              Sign out
            </Button>
          </div>
        )}
      </div>
    </aside>
    </>
  );
}
