"use client";
import { useEffect, useState } from "react";
import { Button, Card, CardToolbar, EmptyState, Input, PageShell, Pagination, Select, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Toast } from "@/shared/ui";
import { useInvoices } from "@/features/invoices/useInvoices";
import { useToast } from "@/shared/hooks/useToast";
import { INVOICE_STATUSES } from "@/shared/constants";
import { Icon } from "@/shared/icons/Icon";

const STATUS_OPTIONS = INVOICE_STATUSES.map((s) => ({ label: s, value: s }));

const fmt = (n: string) => `Rs ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const fmtDate = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export default function InvoicesPage() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setInput] = useState("");
  const [limit, setLimit] = useState(10);
  const { invoices, pagination, loading, error, refetch } = useInvoices({ status, search, limit });
  const { toast, clearToast } = useToast();

  useEffect(() => {
    const savedLimit = localStorage.getItem("pref_invoices_limit");
    if (savedLimit) {
      setTimeout(() => {
        setLimit(Number(savedLimit));
      }, 0);
    }
  }, []);

  return (
    <PageShell
      title="Invoices"
      description={`${pagination.total} total invoices. Track billing status, client totals, and payment progress.`}
      actions={
        <Button href="/invoices/new">
          <Icon name="plus" />
          New invoice
        </Button>
      }
    >
      <Card>
        <CardToolbar className="items-stretch justify-between gap-3 sm:items-center sm:gap-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setSearch(searchInput);
            }}
            className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center"
          >
            <Input
              label="Search invoices"
              hideLabel
              value={searchInput}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Search client or invoice #"
              list="invoice-search-suggestions"
              icon={
                <Icon name="search" className="text-gray-400" />
              }
              wrapperClassName="w-full sm:w-80"
            />
            <datalist id="invoice-search-suggestions">
              {invoices.flatMap((invoice) => [invoice.invoiceNumber, invoice.clientName]).map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
            {search && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setInput("");
                }}
              >
                Clear
              </Button>
            )}
          </form>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Select
              label="Status"
              hideLabel
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={STATUS_OPTIONS}
              placeholder="All statuses"
              wrapperClassName="w-full sm:w-44"
            />
          </div>
        </CardToolbar>

        {loading ? <EmptyState title="Loading..." />
          : error ? <EmptyState title="Could not load invoices" description={error} />
          : invoices.length === 0 ? <EmptyState title="No invoices found" description="Create your first invoice to get started." />
          : (
            <Table wrapperClassName="max-h-[580px] overflow-y-auto relative">
              <TableHead>
                <TableRow>
                  {["Invoice #", "Client", "Status", "Total", "Created", ""].map((h) => <TableHeaderCell key={h}>{h}</TableHeaderCell>)}
                </TableRow>
              </TableHead>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell className="font-mono text-xs font-semibold text-gray-700">{inv.invoiceNumber}</TableCell>
                    <TableCell className="font-medium text-gray-900">
                      <div className="flex items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700 border border-blue-100 select-none">
                          {inv.clientName
                            ? inv.clientName
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .slice(0, 2)
                                .toUpperCase()
                            : "CL"}
                        </span>
                        <span className="min-w-0 break-words">{inv.clientName}</span>
                      </div>
                    </TableCell>
                    <TableCell><StatusBadge status={inv.status} /></TableCell>
                    <TableCell className="font-semibold text-gray-900">{fmt(inv.totalAmount)}</TableCell>
                    <TableCell className="text-gray-400">{fmtDate(inv.createdAt)}</TableCell>
                    <TableCell><Button href={`/invoices/${inv.id}`} variant="ghost" size="sm">View</Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          onPageChange={refetch}
          limit={limit}
          onLimitChange={(newLimit) => {
            setLimit(newLimit);
            localStorage.setItem("pref_invoices_limit", String(newLimit));
          }}
        />
      </Card>
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </PageShell>
  );
}
