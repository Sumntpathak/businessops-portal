"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardToolbar, EmptyState, PageShell, Pagination, Select, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/shared/ui";

interface AuditLog {
  id: string;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  metadata: string | null;
  createdAt: string;
}

const ENTITY_OPTIONS = ["lead", "invoice", "user", "auth", "payment"].map((value) => ({ label: value, value }));
const fmtDate = (date: string) => new Date(date).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export default function AuditLogsPage() {
  const [entityType, setEntityType] = useState("");
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(20);

  async function fetchLogs(page = 1, nextEntityType = entityType, nextLimit = limit) {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), limit: String(nextLimit) });
    if (nextEntityType) params.set("entityType", nextEntityType);
    const res = await fetch(`/api/audit-logs?${params}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.data);
      setPagination({ page: data.pagination.page, totalPages: data.pagination.totalPages, total: data.pagination.total });
    }
    setLoading(false);
  }

  useEffect(() => {
    const savedLimit = localStorage.getItem("pref_audit_logs_limit");
    const initLimit = savedLimit ? Number(savedLimit) : 20;
    const timer = window.setTimeout(() => {
      if (savedLimit) {
        setLimit(initLimit);
      }
      void fetchLogs(1, "", initLimit);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <PageShell title="Audit logs" description={`${pagination.total} total logged events. Important workspace actions are recorded for accountability.`}>
      <Card>
        <CardToolbar className="items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              label="Entity type"
              hideLabel
              value={entityType}
              onChange={(e) => {
                const next = e.target.value;
                setEntityType(next);
                void fetchLogs(1, next, limit);
              }}
              options={ENTITY_OPTIONS}
              placeholder="All entities"
              wrapperClassName="w-full sm:w-44"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => void fetchLogs(pagination.page, entityType, limit)}>Refresh</Button>
          </div>
        </CardToolbar>

        {loading ? <EmptyState title="Loading..." />
          : logs.length === 0 ? <EmptyState title="No logs found" />
          : (
            <Table wrapperClassName="max-h-[580px] overflow-y-auto relative">
              <TableHead>
                <TableRow>
                  {["Action", "Entity", "Actor", "Timestamp"].map((header) => <TableHeaderCell key={header}>{header}</TableHeaderCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell className="font-mono text-xs font-semibold text-gray-700">{log.action}</TableCell>
                    <TableCell>
                      <span className="text-gray-600">{log.entityType}</span>
                      {log.entityId && <span className="ml-1 font-mono text-xs text-gray-400">{log.entityId.slice(0, 8)}</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-gray-400">{log.actorUserId ? log.actorUserId.slice(0, 8) : "system"}</TableCell>
                    <TableCell className="text-xs text-gray-400">{fmtDate(log.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={(page) => fetchLogs(page, entityType, limit)}
          limit={limit}
          onLimitChange={(newLimit) => {
            setLimit(newLimit);
            localStorage.setItem("pref_audit_logs_limit", String(newLimit));
            void fetchLogs(1, entityType, newLimit);
          }}
        />
      </Card>
    </PageShell>
  );
}
