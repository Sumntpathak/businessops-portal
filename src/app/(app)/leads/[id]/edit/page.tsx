"use client";
import { useParams } from "next/navigation";
import { LeadForm } from "@/features/leads/components/LeadForm";
import { useApiResource } from "@/shared/hooks/useApiResource";

export default function EditLeadPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, status } = useApiResource<{ name: string; email: string; phone: string; company: string; source: string; status: string; notes: string }>(`/api/leads/${id}`);

  if (loading) return <div className="py-20 text-center text-sm text-slate-400">Loading…</div>;
  if (status === 403 || status === 404) return <div className="py-20 text-center text-sm text-slate-600">Lead not found or access denied.</div>;

  return <LeadForm leadId={id} initialValues={data ?? undefined} cancelHref={`/leads/${id}`} />;
}
