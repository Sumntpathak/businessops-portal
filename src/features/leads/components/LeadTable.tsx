"use client";
import Link from "next/link";
import { Button, StatusBadge } from "@/shared/ui";
import type { Lead } from "@/features/leads/useLeads";

interface LeadTableProps {
  leads: Lead[];
  onDelete: (id: string) => void;
}

const fmt = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function LeadTable({ leads, onDelete }: LeadTableProps) {
  if (leads.length === 0) return (
    <div className="px-5 py-12 text-center">
      <p className="text-sm font-medium text-slate-600">No leads found</p>
      <p className="mt-1 text-sm text-slate-400">Try a different search or filter</p>
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
            {["Name", "Company", "Status", "Source", "Assigned to", "Created", ""].map((h) => (
              <th key={h} className="px-4 py-3">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {leads.map((lead) => (
            <tr key={lead.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3">
                <Link href={`/leads/${lead.id}`} className="font-medium text-slate-950 hover:underline">{lead.name}</Link>
                <p className="text-xs text-slate-400">{lead.email}</p>
              </td>
              <td className="px-4 py-3 text-slate-600">{lead.company ?? "—"}</td>
              <td className="px-4 py-3"><StatusBadge status={lead.status} /></td>
              <td className="px-4 py-3 text-slate-500">{lead.source}</td>
              <td className="px-4 py-3 text-slate-500">{lead.assigneeName ?? "Unassigned"}</td>
              <td className="px-4 py-3 text-slate-400">{fmt(lead.createdAt)}</td>
              <td className="px-4 py-3">
                <div className="flex gap-2">
                  <Link href={`/leads/${lead.id}/edit`}><Button variant="ghost" className="min-h-7 px-2 text-xs">Edit</Button></Link>
                  <Button variant="danger" className="min-h-7 px-2 text-xs" onClick={() => onDelete(lead.id)}>Delete</Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
