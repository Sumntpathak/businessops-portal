import { LogOut } from "lucide-react";
import {
  logoutAction,
  switchTenantAction
} from "@/app/actions/auth";
import type { TenantMembership } from "@/lib/tenant-access";

export function Topbar({
  activeTenant,
  memberships,
  userName
}: {
  activeTenant: TenantMembership;
  memberships: TenantMembership[];
  userName: string;
}) {
  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b px-5 sm:px-8">
      <div>
        {memberships.length > 1 ? (
          <form action={switchTenantAction} className="flex items-center gap-2">
            <label htmlFor="tenantSlug" className="sr-only">Active business</label>
            <select
              id="tenantSlug"
              name="tenantSlug"
              defaultValue={activeTenant.slug}
              className="h-9 rounded-md border bg-background px-3 text-sm font-medium"
            >
              {memberships.map((membership) => (
                <option key={membership.tenantId} value={membership.slug}>
                  {membership.name}
                </option>
              ))}
            </select>
            <button type="submit" className="text-xs text-muted-foreground hover:text-foreground">
              Switch
            </button>
          </form>
        ) : (
          <p className="text-sm font-medium">{activeTenant.name}</p>
        )}
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden text-sm text-muted-foreground sm:inline">{userName}</span>
        <form action={logoutAction}>
          <button
            type="submit"
            className="flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Logout</span>
          </button>
        </form>
      </div>
    </header>
  );
}
