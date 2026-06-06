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

const FIELD_TYPES = [
  { value: "text", label: "Text" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "number", label: "Number" },
  { value: "select", label: "Dropdown (select)" },
];

const defaultForm = { fieldKey: "", label: "", fieldType: "text", isRequired: false, options: "" };

export function UserFieldManager() {
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(defaultForm);
  const [adding, setAdding] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<FieldDef | null>(null);
  const [error, setError] = useState("");

  async function load() {
    try {
      const res = await fetch("/api/users/fields");
      if (!res.ok) return;
      const data = await res.json();
      setFields(data.data ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function handleAdd() {
    setError("");
    setAdding(true);
    try {
      const payload = {
        ...form,
        options: form.fieldType === "select"
          ? form.options.split(",").map((s) => s.trim()).filter(Boolean)
          : undefined,
      };
      const res = await fetch("/api/users/fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to add field"); return; }
      setForm(defaultForm);
      setShowAdd(false);
      void load();
    } catch {
      setError("Network error");
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete(field: FieldDef) {
    await fetch(`/api/users/fields/${field.id}`, { method: "DELETE" });
    void load();
    setConfirmDelete(null);
  }

  function autoKey(label: string) {
    return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Custom Profile Fields</CardTitle>
            <p className="text-xs text-gray-400 mt-0.5">
              Fields added here appear on every user profile form. Removing a field hides it but does not delete existing values.
            </p>
          </div>
          <Button size="sm" onClick={() => { setShowAdd(true); setError(""); }}>
            + Add field
          </Button>
        </div>
      </CardHeader>
      <CardBody className="space-y-3">
        {loading && <p className="text-sm text-gray-400">Loading...</p>}

        {!loading && fields.length === 0 && (
          <p className="text-sm text-gray-400">No custom fields yet. Click &quot;Add field&quot; to create one.</p>
        )}

        {fields.map((field) => (
          <div key={field.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50/50 px-4 py-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium text-gray-800">
                {field.label}
                {field.isRequired && <span className="ml-1 text-xs text-red-500">required</span>}
              </p>
              <p className="text-xs text-gray-400">
                key: <code className="font-mono">{field.fieldKey}</code> - type: {field.fieldType}
                {field.options?.length > 0 && ` - options: ${field.options.join(", ")}`}
              </p>
            </div>
            <button
              onClick={() => setConfirmDelete(field)}
              className="ml-4 text-xs text-red-400 hover:text-red-600"
            >
              Remove
            </button>
          </div>
        ))}

        {/* Add field form */}
        {showAdd && (
          <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-4 space-y-3 mt-2">
            <p className="text-sm font-semibold text-gray-700">New field</p>
            {error && <p className="text-xs text-red-500">{error}</p>}
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Label (shown to users)"
                value={form.label}
                onChange={(e) => setForm((p) => ({
                  ...p,
                  label: e.target.value,
                  fieldKey: p.fieldKey || autoKey(e.target.value),
                }))}
                placeholder="e.g. Department"
              />
              <Input
                label="Field key (internal)"
                value={form.fieldKey}
                onChange={(e) => setForm((p) => ({ ...p, fieldKey: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "") }))}
                placeholder="e.g. department"
              />
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Type</label>
                <select
                  value={form.fieldType}
                  onChange={(e) => setForm((p) => ({ ...p, fieldType: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {FIELD_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={form.isRequired}
                    onChange={(e) => setForm((p) => ({ ...p, isRequired: e.target.checked }))}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                  Required field
                </label>
              </div>
              {form.fieldType === "select" && (
                <div className="sm:col-span-2">
                  <Input
                    label="Options (comma separated)"
                    value={form.options}
                    onChange={(e) => setForm((p) => ({ ...p, options: e.target.value }))}
                    placeholder="Sales, Marketing, Engineering, HR"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => { setShowAdd(false); setForm(defaultForm); }}>
                Cancel
              </Button>
              <Button size="sm" disabled={!form.label || !form.fieldKey || adding} onClick={handleAdd}>
                {adding ? "Adding..." : "Add field"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>

      {confirmDelete && (
        <ConfirmDialog
          title="Remove custom field"
          message={`Remove "${confirmDelete.label}" from all user profiles? Existing saved values are preserved but won't be shown until the field is re-added.`}
          confirmLabel="Yes, remove field"
          onConfirm={() => void handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </Card>
  );
}
