"use client";

import { useParams } from "next/navigation";
import { LeadForm } from "@/features/leads/components/LeadForm";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { EmptyState } from "@/shared/ui";

export default function EditLeadPage() {
  const { id } = useParams<{ id: string }>();
  const { data, loading, status } = useApiResource<{
    name: string;
    email: string;
    phone: string;
    company: string;
    source: string;
    status: string;
    assignedTo: string | null;
    notes: string;
  }>(`/api/leads/${id}`);

  if (loading) return <EmptyState title="Loading..." description="Fetching lead details." />;
  if (status === 403 || status === 404) return <EmptyState title="Lead not found or access denied" />;

  return (
    <LeadForm
      leadId={id}
      initialValues={data ? { ...data, assignedTo: data.assignedTo ?? "" } : undefined}
      cancelHref={`/leads/${id}`}
    />
  );
}
