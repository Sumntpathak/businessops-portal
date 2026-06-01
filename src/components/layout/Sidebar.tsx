"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type Role = "admin" | "manager" | "agent" | "finance";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  roles: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "📊", roles: ["admin", "manager", "agent", "finance"] },
  { href: "/leads", label: "Leads", icon: "🎯", roles: ["admin", "manager", "agent", "finance"] },
  { href: "/followups", label: "Follow-ups", icon: "🔔", roles: ["admin", "manager", "agent", "finance"] },
  { href: "/invoices", label: "Invoices", icon: "🧾", roles: ["admin", "manager", "finance"] },
  { href: "/users", label: "Users", icon: "👥", roles: ["admin", "manager"] },
  { href: "/audit-logs", label: "Audit Logs", icon: "📋", roles: ["admin", "manager"] },
  { href: "/settings", label: "Settings", icon: "⚙️", roles: ["admin", "manager", "agent", "finance"] },
];

interface Props {
  user: { name: string; email: string; role: Role };
}

export default function Sidebar({ user }: Props) {
  const pathname = usePathname();
  const router = useRouter();

  const visibleNav = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="w-64 bg-gray-900 flex flex-col h-full">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-gray-700">
        <h1 className="text-white font-bold text-lg">BusinessOps</h1>
        <p className="text-gray-400 text-xs mt-0.5">Portal</p>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {visibleNav.map((item) => {
          const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-indigo-600 text-white"
                  : "text-gray-300 hover:bg-gray-800 hover:text-white"
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* User + Logout */}
      <div className="px-4 py-4 border-t border-gray-700">
        <div className="mb-3">
          <p className="text-white text-sm font-medium truncate">{user.name}</p>
          <p className="text-gray-400 text-xs truncate">{user.email}</p>
          <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded-full bg-indigo-500/20 text-indigo-300 capitalize">
            {user.role}
          </span>
        </div>
        <button
          onClick={handleLogout}
          className="w-full text-left text-sm text-gray-400 hover:text-red-400 transition-colors"
        >
          → Sign out
        </button>
      </div>
    </aside>
  );
}
