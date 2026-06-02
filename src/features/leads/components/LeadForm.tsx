"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button, Card, CardBody, CardHeader, Input } from "@/shared/ui";
import { useToast } from "@/shared/hooks/useToast";
import { Toast } from "@/shared/ui";
import { LEAD_STATUSES } from "@/shared/constants";
import { createLeadSchema, updateLeadSchema } from "@/features/leads/lead.schema";

const SOURCES = ["Website","Referral","Cold Call","Social Media","Email Campaign","Walk-In","Other"];

type FormState = { name: string; email: string; phone: string; company: string; source: string; status: string; notes: string; };

interface LeadFormProps {
  /** undefined = create mode, defined = edit mode */
  initialValues?: Partial<FormState>;
  leadId?: string;
  cancelHref: string;
}

function toForm(v: Partial<FormState> = {}): FormState {
  return { name: v.name ?? "", email: v.email ?? "", phone: v.phone ?? "", company: v.company ?? "", source: v.source ?? "Other", status: v.status ?? "New", notes: v.notes ?? "" };
}

export function LeadForm({ initialValues, leadId, cancelHref }: LeadFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(toForm(initialValues));
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [loading, setLoading] = useState(false);
  const { toast, showToast, clearToast } = useToast();

  const set = (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [field]: e.target.value }));

  const isEdit = !!leadId;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const parsed = (isEdit ? updateLeadSchema : createLeadSchema).safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(
        Object.entries(parsed.error.flatten().fieldErrors).map(([key, value]) => [key, value?.[0] ?? "Invalid value"]),
      ));
      showToast("Please fix the highlighted fields", "error");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(isEdit ? `/api/leads/${leadId}` : "/api/leads", {
        method: isEdit ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.details) setErrors(Object.fromEntries(Object.entries(data.details as Record<string,string[]>).map(([k,v])=>[k,v[0]])));
        showToast(data.error ?? "Failed", "error");
        return;
      }
      router.push(isEdit ? `/leads/${leadId}` : `/leads/${data.data.id}`);
    } catch { showToast("Network error", "error"); }
    finally { setLoading(false); }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex items-center gap-2 text-sm">
        <Link href="/leads" className="text-slate-500 hover:text-slate-800">Leads</Link>
        {isEdit && <><span className="text-slate-300">/</span><Link href={`/leads/${leadId}`} className="text-slate-500 hover:text-slate-800">Detail</Link></>}
        <span className="text-slate-300">/</span>
        <span className="font-medium text-slate-950">{isEdit ? "Edit" : "New lead"}</span>
      </div>

      <Card>
        <CardHeader><h2 className="text-sm font-semibold text-slate-800">Lead details</h2></CardHeader>
        <CardBody>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input label="Full name *" name="name" value={form.name} onChange={set("name")} placeholder="Arjun Mehta" hint="Letters and spaces only" error={errors.name} />
            <Input label="Email *" name="email" type="email" value={form.email} onChange={set("email")} placeholder="arjun@company.com" error={errors.email} />
            <Input label="Phone" name="phone" value={form.phone} onChange={set("phone")} placeholder="9876543210" hint="Digits only" error={errors.phone} />
            <Input label="Company" name="company" value={form.company} onChange={set("company")} placeholder="TechCorp" hint="Letters and spaces only" error={errors.company} />

            <div className="grid grid-cols-2 gap-4">
              {(["source", "status"] as const).map((field) => (
                <label key={field} className="block">
                  <span className="block text-sm font-medium text-slate-700 capitalize">{field}</span>
                  <select value={form[field]} onChange={set(field)} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200">
                    {(field === "source" ? SOURCES : LEAD_STATUSES).map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
              ))}
            </div>

            <label className="block">
              <span className="block text-sm font-medium text-slate-700">Notes</span>
              <textarea value={form.notes} onChange={set("notes")} rows={4} className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-slate-200" />
            </label>

            <div className="flex justify-end gap-3 pt-2">
              <Link href={cancelHref}><Button variant="secondary" type="button">Cancel</Button></Link>
              <Button type="submit" disabled={loading}>{loading ? "Saving…" : isEdit ? "Save changes" : "Create lead"}</Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </div>
  );
}
