"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader, CardTitle, ConfirmDialog, Input } from "@/shared/ui";

interface FieldDef {
  id: string;
  fieldKey: string;
  label: string;
  fieldType: string;
  isRequired: boolean;
  options: string[];
}

interface Profile {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  profileData: Record<string, string>;
  fieldDefinitions: FieldDef[];
}

interface UserProfileEditorProps {
  userId: string;
  onSaved?: () => void;
}

export function UserProfileEditor({ userId, onSaved }: UserProfileEditorProps) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ name: "", phone: "", custom: {} as Record<string, string> });
  const [dirty, setDirty] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await fetch(`/api/users/${userId}/profile`);
        if (!res.ok) return;
        const data = await res.json();
        const p = data.data as Profile;
        setProfile(p);
        setForm({ name: p.name, phone: p.phone ?? "", custom: { ...p.profileData } });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [userId]);

  function handleField(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
    setSuccess("");
  }

  function handleCustom(key: string, value: string) {
    setForm((prev) => ({ ...prev, custom: { ...prev.custom, [key]: value } }));
    setDirty(true);
    setSuccess("");
  }

  async function doSave() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/users/${userId}/profile`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: form.name, phone: form.phone || null, profileData: form.custom }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Save failed"); return; }
      setSuccess("Profile saved successfully.");
      setDirty(false);
      onSaved?.();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="text-sm text-gray-400">Loading profile...</p>;
  if (!profile) return <p className="text-sm text-red-500">Could not load profile.</p>;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Profile Details</CardTitle>
          <p className="text-xs text-gray-400">
            Changes require confirmation before saving.
          </p>
        </CardHeader>
        <CardBody className="space-y-4">
          {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          {success && <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-600">{success}</p>}

          {/* Standard fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="Full name"
              value={form.name}
              onChange={(e) => handleField("name", e.target.value)}
            />
            <Input
              label="Email"
              type="email"
              value={profile.email}
              disabled
              className="opacity-60"
            />
            <Input
              label="Phone number"
              type="tel"
              value={form.phone}
              onChange={(e) => handleField("phone", e.target.value)}
              placeholder="+91 98765 43210"
            />
            <div className="flex items-end">
              <div className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5">
                <p className="text-xs text-gray-400">Role</p>
                <p className="mt-0.5 text-sm font-medium capitalize text-gray-700">{profile.role}</p>
              </div>
            </div>
          </div>

          {/* Custom fields */}
          {profile.fieldDefinitions.length > 0 && (
            <>
              <div className="border-t border-gray-100 pt-4">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Additional Info
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {profile.fieldDefinitions.map((field) => (
                    <div key={field.id}>
                      {field.fieldType === "select" ? (
                        <div>
                          <label className="mb-1 block text-sm font-medium text-gray-700">
                            {field.label}{field.isRequired && <span className="ml-1 text-red-500">*</span>}
                          </label>
                          <select
                            value={form.custom[field.fieldKey] ?? ""}
                            onChange={(e) => handleCustom(field.fieldKey, e.target.value)}
                            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          >
                            <option value="">Select...</option>
                            {field.options.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                      ) : (
                        <Input
                          label={field.isRequired ? `${field.label} *` : field.label}
                          type={field.fieldType === "email" ? "email" : field.fieldType === "number" ? "number" : "text"}
                          value={form.custom[field.fieldKey] ?? ""}
                          onChange={(e) => handleCustom(field.fieldKey, e.target.value)}
                          required={field.isRequired}
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="flex justify-end border-t border-gray-100 pt-4">
            <Button
              disabled={!dirty || saving}
              onClick={() => setShowConfirm(true)}
            >
              {saving ? "Saving..." : "Save changes"}
            </Button>
          </div>
        </CardBody>
      </Card>

      {showConfirm && (
        <ConfirmDialog
          title="Confirm profile update"
          message="Are you sure you want to save these profile changes? This will update the user's details immediately."
          confirmLabel="Yes, save changes"
          onConfirm={() => { setShowConfirm(false); void doSave(); }}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  );
}
