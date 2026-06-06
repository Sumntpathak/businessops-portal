"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  EmptyState,
  StatusBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/shared/ui";
import { Icon } from "@/shared/icons/Icon";
import type { Lead } from "@/features/leads/useLeads";

interface LeadTableProps {
  leads: Lead[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onDelete: (id: string) => void;
  canDelete?: boolean;
}

const fmt = (d: string) =>
  new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function RowActions({ leadId, onDelete, canDelete }: { leadId: string; onDelete: (id: string) => void; canDelete?: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex justify-end" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Lead actions"
        onClick={() => setOpen((value) => !value)}
        className="grid size-8 place-items-center rounded-lg text-gray-400 opacity-0 transition hover:bg-gray-100 hover:text-gray-700 group-hover:opacity-100 focus:opacity-100"
      >
        <Icon name="moreVertical" />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-20 w-40 rounded-lg border border-gray-200 bg-white p-1 text-sm shadow-lg">
          <Link
            href={`/leads/${leadId}`}
            className="block rounded-md px-3 py-2 text-gray-700 transition hover:bg-gray-50"
          >
            View profile
          </Link>
          <Link
            href={`/leads/${leadId}/edit`}
            className="block rounded-md px-3 py-2 text-gray-700 transition hover:bg-gray-50"
          >
            Edit
          </Link>
          {canDelete && (
            <button
              type="button"
              onClick={() => onDelete(leadId)}
              className="block w-full rounded-md px-3 py-2 text-left text-red-600 transition hover:bg-red-50"
            >
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function LeadTable({ leads, selectedIds, onToggle, onToggleAll, onDelete, canDelete }: LeadTableProps) {
  const router = useRouter();

  if (leads.length === 0) {
    return <EmptyState title="No leads found" description="Try a different search or filter." />;
  }

  const allSelected = leads.every((lead) => selectedIds.includes(lead.id));

  return (
    <Table wrapperClassName="max-h-[580px] overflow-y-auto relative">
      <TableHead>
        <tr>
          <TableHeaderCell className="w-10">
            <input
              type="checkbox"
              aria-label="Select all leads"
              checked={allSelected}
              onChange={onToggleAll}
              className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-200"
            />
          </TableHeaderCell>
          {["Name", "Company", "Status", "Source", "Assigned to", "Created", ""].map((header) => (
            <TableHeaderCell key={header}>{header}</TableHeaderCell>
          ))}
        </tr>
      </TableHead>
      <TableBody>
        {leads.map((lead) => (
          <TableRow
            key={lead.id}
            onClick={() => router.push(`/leads/${lead.id}`)}
            className="group cursor-pointer"
          >
            <TableCell onClick={(e) => e.stopPropagation()} className="w-10">
              <input
                type="checkbox"
                aria-label={`Select ${lead.name}`}
                checked={selectedIds.includes(lead.id)}
                onChange={() => onToggle(lead.id)}
                className="size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-200"
              />
            </TableCell>
            <TableCell>
              <div className="flex items-center gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
                  {initials(lead.name)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-gray-950">{lead.name}</p>
                  <p className="mt-0.5 truncate text-xs text-gray-400">{lead.email}</p>
                </div>
              </div>
            </TableCell>
            <TableCell>{lead.company ?? "-"}</TableCell>
            <TableCell>
              <StatusBadge status={lead.status} />
            </TableCell>
            <TableCell className="text-gray-500">{lead.source}</TableCell>
            <TableCell className="text-gray-500">{lead.assigneeName ?? "Unassigned"}</TableCell>
            <TableCell className="text-gray-400">{fmt(lead.createdAt)}</TableCell>
            <TableCell className="w-12">
              <RowActions leadId={lead.id} onDelete={onDelete} canDelete={canDelete} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
