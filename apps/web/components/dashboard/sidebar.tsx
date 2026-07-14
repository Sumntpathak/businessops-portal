"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  CalendarDays,
  LayoutDashboard,
  Mic,
  PanelLeft,
  PhoneCall,
  Settings
} from "lucide-react";

const navigation = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Calls", href: "/dashboard/calls", icon: PhoneCall },
  { label: "Bookings", href: "/dashboard/bookings", icon: CalendarDays },
  { label: "Agent", href: "/dashboard/agent", icon: Bot },
  { label: "Voice Test", href: "/dashboard/voice-test", icon: Mic },
  { label: "Settings", href: "/dashboard/settings", icon: Settings }
];

const STORAGE_KEY = "recepto.sidebar.collapsed";

function isActive(pathname: string, href: string): boolean {
  return href === "/dashboard"
    ? pathname === "/dashboard"
    : pathname === href || pathname.startsWith(href + "/");
}

export function Sidebar() {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem(STORAGE_KEY) === "1");
  }, []);

  const toggle = () => {
    setCollapsed((current) => {
      window.localStorage.setItem(STORAGE_KEY, current ? "0" : "1");
      return !current;
    });
  };

  return (
    <aside
      className={
        "hidden h-full shrink-0 flex-col border-r border-border/60 bg-muted/20 transition-[width] duration-200 md:flex " +
        (collapsed ? "w-16" : "w-64")
      }
    >
      <div
        className={
          "flex h-16 shrink-0 items-center border-b border-border/60 " +
          (collapsed ? "justify-center px-0" : "justify-between px-4")
        }
      >
        {!collapsed && (
          <span className="px-2 text-xs font-semibold tracking-[0.25em] text-muted-foreground">
            RECEPTO
          </span>
        )}
        <button
          type="button"
          onClick={toggle}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <PanelLeft className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <nav className={"flex-1 space-y-1 overflow-y-auto py-3 " + (collapsed ? "px-2" : "px-3")}>
        {navigation.map(({ label, href, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={label}
              href={href}
              title={collapsed ? label : undefined}
              aria-current={active ? "page" : undefined}
              className={
                "flex items-center rounded-lg text-sm font-medium transition-colors " +
                (collapsed ? "justify-center px-0 py-2.5 " : "gap-3 px-3 py-2 ") +
                (active
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground")
              }
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {!collapsed && label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
