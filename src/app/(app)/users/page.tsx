"use client";

import { useEffect, useState } from "react";
import { Badge, Button, Card, CardBody, CardHeader, CardTitle, CardToolbar, EmptyState, Input, PageShell, Pagination, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Toast } from "@/shared/ui";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { useToast } from "@/shared/hooks/useToast";
import { ROLES, USER_PERMISSIONS } from "@/shared/constants";
import { Icon } from "@/shared/icons/Icon";
import { badgeBase } from "@/shared/ui/styles";
import { cn } from "@/shared/utils/cn";
import { UserProfileEditor } from "@/features/users/components/UserProfileEditor";

interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

interface UserPermissionRow {
  id: string;
  userId: string;
  permission: string;
  granted: boolean;
}

const ROLE_OPTIONS = ROLES.map((role) => ({ label: role.charAt(0).toUpperCase() + role.slice(1), value: role }));
const permissionCategories = ["messaging", "billing", "data", "operations", "admin"] as const;
const titleCase = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export default function UsersPage() {
  const { data: users, loading, error, refetch } = useApiResource<User[]>("/api/users");
  const { toast, showToast, clearToast } = useToast();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "agent" });
  const [creating, setCreating] = useState(false);
  const [role, setRole] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [editProfileUser, setEditProfileUser] = useState<User | null>(null);
  const [permissionRows, setPermissionRows] = useState<UserPermissionRow[]>([]);
  const [loadingPermissions, setLoadingPermissions] = useState(false);
  const [savingPermission, setSavingPermission] = useState<string | null>(null);
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);

  useEffect(() => {
    async function loadMe() {
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const json = await res.json();
        setRole(json.data?.role ?? "");
      }
    }
    void loadMe();
  }, []);

  useEffect(() => {
    const savedLimit = localStorage.getItem("pref_users_limit");
    if (savedLimit) {
      setTimeout(() => {
        setLimit(Number(savedLimit));
      }, 0);
    }
  }, []);

  const isAdmin = role === "admin";

  async function handleToggleActive(user: User) {
    setUpdatingUserId(user.id);
    try {
      const res = await fetch(`/api/users/${user.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      if (res.ok) {
        showToast(`User ${user.isActive ? "deactivated" : "activated"}`);
        refetch();
      } else {
        const data = await res.json();
        showToast(data.error ?? "Update failed", "error");
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(data.error ?? "Failed to create user", "error");
    } else {
      showToast("User created");
      setShowCreate(false);
      setForm({ name: "", email: "", password: "", role: "agent" });
      refetch();
    }
    setCreating(false);
  }

  async function loadPermissions(user: User) {
    setSelectedUser(user);
    setLoadingPermissions(true);
    try {
      const res = await fetch(`/api/users/${user.id}/permissions`);
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Failed to load permissions", "error");
        return;
      }
      setPermissionRows(data.data?.permissions ?? []);
    } catch {
      showToast("Network error loading permissions", "error");
    } finally {
      setLoadingPermissions(false);
    }
  }

  async function handleTogglePermission(permission: string, granted: boolean) {
    if (!selectedUser) return;
    setSavingPermission(permission);
    try {
      const res = await fetch(`/api/users/${selectedUser.id}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ permissions: [{ permission, granted }] }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Failed to update permission", "error");
        return;
      }
      setPermissionRows(data.data?.permissions ?? []);
      showToast("Permission updated");
    } catch {
      showToast("Network error updating permission", "error");
    } finally {
      setSavingPermission(null);
    }
  }

  const permissionGranted = (permission: string) => Boolean(permissionRows.find((row) => row.permission === permission)?.granted);

  // Client-side search and pagination
  const filteredUsers = (users ?? []).filter((user) =>
    user.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalCount = filteredUsers.length;
  const totalPages = Math.ceil(totalCount / limit) || 1;
  const paginatedUsers = filteredUsers.slice((page - 1) * limit, page * limit);

  return (
    <PageShell
      title="Users"
      description={`${totalCount} total users. Manage team members and access levels.`}
      actions={isAdmin ? <Button onClick={() => setShowCreate(true)}>Invite user</Button> : null}
    >
      {showCreate && (
        <Card>
          <CardHeader><CardTitle>Create user</CardTitle></CardHeader>
          <CardBody>
            <form onSubmit={handleCreate} className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <Input label="Full name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
              <Input label="Email *" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
              <Input label="Password *" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} hint="Min 8 characters" required />
              <Select label="Role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} options={ROLE_OPTIONS} />
              <div className="flex justify-end gap-3 md:col-span-2">
                <Button variant="secondary" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit" disabled={creating}>{creating ? "Creating..." : "Create user"}</Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {isAdmin && selectedUser && (
        <Card className="shadow-sm border-gray-200/80 bg-white">
          <CardHeader className="border-b border-gray-100 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle>Permissions for {selectedUser.name}</CardTitle>
                <p className="text-xs text-gray-400">{selectedUser.email}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setSelectedUser(null)}>
                Close
              </Button>
            </div>
          </CardHeader>
          <CardBody className="p-5">
            {loadingPermissions ? (
              <div className="py-8 text-center text-sm text-gray-500">Loading permissions...</div>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {permissionCategories.map((category) => (
                  <div key={category} className="rounded-lg border border-gray-200 bg-white p-4">
                    <h3 className="text-sm font-semibold text-gray-900">{titleCase(category)}</h3>
                    <div className="mt-3 space-y-3">
                      {USER_PERMISSIONS.filter((permission) => permission.category === category).map((permission) => {
                        const isGranted = permissionGranted(permission.key);
                        return (
                          <div key={permission.key} className="flex items-start justify-between gap-4 border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                            <div>
                              <p className="text-sm font-medium text-gray-800">{permission.label}</p>
                              <p className="text-xs text-gray-400">{permission.description}</p>
                            </div>
                            <button
                              type="button"
                              disabled={savingPermission === permission.key}
                              onClick={() => handleTogglePermission(permission.key, !isGranted)}
                              className={cn(
                                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-60",
                                isGranted ? "bg-blue-600" : "bg-gray-200"
                              )}
                            >
                              <span className={cn("pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out", isGranted ? "translate-x-5" : "translate-x-0")} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      <Card>
        <CardToolbar className="items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Input
              label="Search users"
              hideLabel
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search name or email"
              list="user-search-suggestions"
              icon={
                <Icon name="search" className="text-gray-400" />
              }
              wrapperClassName="w-full sm:w-80"
            />
            <datalist id="user-search-suggestions">
              {(users ?? []).flatMap((user) => [
                { key: `${user.id}-name`, value: user.name },
                { key: `${user.id}-email`, value: user.email },
              ]).map(({ key, value }) => (
                <option key={key} value={value} />
              ))}
            </datalist>
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setPage(1);
                }}
              >
                Clear
              </Button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={refetch}>Refresh</Button>
          </div>
        </CardToolbar>

        {loading ? <EmptyState title="Loading..." />
          : error ? <EmptyState title="Could not load users" description={error} />
          : filteredUsers.length === 0 ? <EmptyState title="No users found" description="Try a different search query." />
          : (
            <Table wrapperClassName="max-h-[580px] overflow-y-auto relative">
              <TableHead>
                <TableRow>
                  {["Name", "Email", "Role", "Status", "Joined", ""].map((header) => <TableHeaderCell key={header}>{header}</TableHeaderCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {paginatedUsers.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium text-gray-900">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 border border-blue-100 select-none">
                          {user.name
                            ? user.name
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()
                            : "US"}
                        </span>
                        <span>{user.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-gray-500">{user.email}</TableCell>
                    <TableCell><Badge className="capitalize">{user.role}</Badge></TableCell>
                    <TableCell>
                      <span className={cn(badgeBase, user.isActive ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-red-50 text-red-700 border-red-100")}>
                        {user.isActive ? "Active" : "Inactive"}
                      </span>
                    </TableCell>
                    <TableCell className="text-gray-400">
                      {new Date(user.createdAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                    </TableCell>
                    <TableCell>
                      {isAdmin && (
                        <div className="flex justify-end gap-2">
                          <Button variant="secondary" size="sm" onClick={() => setEditProfileUser(user)}>
                            Edit profile
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => loadPermissions(user)}>
                            Permissions
                          </Button>
                          <Button
                            variant={user.isActive ? "danger" : "secondary"}
                            size="sm"
                            disabled={updatingUserId === user.id}
                            onClick={() => void handleToggleActive(user)}
                          >
                            {updatingUserId === user.id ? (user.isActive ? "Deactivating..." : "Activating...") : (user.isActive ? "Deactivate" : "Activate")}
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        <Pagination
          page={page}
          totalPages={totalPages}
          onPageChange={setPage}
          limit={limit}
          onLimitChange={(newLimit) => {
            setLimit(newLimit);
            localStorage.setItem("pref_users_limit", String(newLimit));
            setPage(1);
          }}
        />
      </Card>
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}

      {/* Edit profile slide-over */}
      {editProfileUser && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="fixed inset-0 bg-black/30" onClick={() => setEditProfileUser(null)} />
          <div className="relative z-50 flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Edit Profile</h2>
                <p className="text-sm text-gray-500">{editProfileUser.name} · {editProfileUser.email}</p>
              </div>
              <button
                onClick={() => setEditProfileUser(null)}
                className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 space-y-4 p-6">
              <UserProfileEditor
                userId={editProfileUser.id}
                onSaved={() => { refetch(); showToast("Profile updated"); }}
              />
            </div>
          </div>
        </div>
      )}
    </PageShell>
  );
}
