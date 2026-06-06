"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, CardBody, CardHeader, CardTitle, Input, PageShell, Toast } from "@/shared/ui";
import { useToast } from "@/shared/hooks/useToast";

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

interface LeadSuggestion {
  id: string;
  name: string;
  company: string | null;
  email: string;
}

const emptyItem = (): LineItem => ({ description: "", quantity: 1, unitPrice: 0 });
const defaultSignatureEnabled = true;

function calcPreview(items: LineItem[], taxPct: number, discount: number) {
  const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
  const tax = (subtotal * taxPct) / 100;
  return { subtotal, tax, total: subtotal + tax - discount };
}

const fmtINR = (n: number) => `Rs ${n.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export default function NewInvoicePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { toast, showToast, clearToast } = useToast();
  const [clientName, setClientName] = useState(searchParams.get("clientName") ?? "");
  const [leadId, setLeadId] = useState(searchParams.get("leadId") ?? "");
  const [leadSuggestions, setLeadSuggestions] = useState<LeadSuggestion[]>([]);
  const [taxPct, setTaxPct] = useState(18);
  const [discount, setDiscount] = useState(0);
  const [items, setItems] = useState<LineItem[]>([emptyItem()]);
  const [loading, setLoading] = useState(false);
  const [templateTitle, setTemplateTitle] = useState("Tax Invoice");
  const [templateNote, setTemplateNote] = useState("Thank you for your business. Payment is due as per agreed terms.");
  const [signatureEnabled, setSignatureEnabled] = useState(defaultSignatureEnabled);
  const [signatureName, setSignatureName] = useState("");
  const [signatureDesignation, setSignatureDesignation] = useState("");

  useEffect(() => {
    setTimeout(() => {
      const autoApplyGst = localStorage.getItem("invoice_auto_apply_gst") !== "false";
      const gstRate = Number(localStorage.getItem("invoice_default_gst_rate") || "18");
      if (autoApplyGst && !Number.isNaN(gstRate)) setTaxPct(gstRate);
      setTemplateTitle(localStorage.getItem("invoice_template_title") || "Tax Invoice");
      setTemplateNote(localStorage.getItem("invoice_template_note") || "Thank you for your business. Payment is due as per agreed terms.");
      setSignatureEnabled(localStorage.getItem("invoice_signature_enabled") !== "false");
      setSignatureName(localStorage.getItem("invoice_signature_name") || "");
      setSignatureDesignation(localStorage.getItem("invoice_signature_designation") || "");
    }, 0);
  }, []);

  useEffect(() => {
    async function loadLeadSuggestions() {
      try {
        const res = await fetch("/api/leads?limit=100&sort=desc");
        if (!res.ok) return;
        const json = await res.json();
        setLeadSuggestions(json.data ?? []);
      } catch {
        // Suggestions are optional; invoice creation still works without them.
      }
    }
    void loadLeadSuggestions();
  }, []);

  const updateItem = (index: number, field: keyof LineItem, value: string | number) =>
    setItems((prev) => prev.map((item, idx) => idx === index ? { ...item, [field]: value } : item));

  const preview = calcPreview(items, taxPct, discount);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: leadId || null, clientName, taxPercentage: taxPct, discount, items }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Failed to create invoice", "error");
        return;
      }
      router.push(`/invoices/${data.data.id}`);
    } catch {
      showToast("Network error", "error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageShell
      title="New invoice"
      description="Create a simple invoice with server-verified totals."
      width="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardHeader><CardTitle>Invoice details</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <div className="rounded-lg border border-blue-100 bg-blue-50/40 px-4 py-3">
              <p className="text-sm font-semibold text-blue-900">{templateTitle}</p>
              <p className="mt-1 text-xs text-blue-700">{templateNote}</p>
            </div>
            <Input
              label="Client name *"
              name="clientName"
              value={clientName}
              onChange={(e) => {
                const nextName = e.target.value;
                setClientName(nextName);
                const matchedLead = leadSuggestions.find((lead) => `${lead.name}${lead.company ? ` / ${lead.company}` : ""}` === nextName);
                setLeadId(matchedLead?.id ?? "");
              }}
              placeholder="Acme Corp"
              list="invoice-client-suggestions"
              required
            />
            <datalist id="invoice-client-suggestions">
              {leadSuggestions.map((lead) => (
                <option key={lead.id} value={`${lead.name}${lead.company ? ` / ${lead.company}` : ""}`}>
                  {lead.email}
                </option>
              ))}
            </datalist>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input label="GST Tax (%)" name="tax" type="number" min={0} max={100} value={taxPct} onChange={(e) => setTaxPct(Number(e.target.value))} hint="Auto-filled from Settings > Invoice Setup." />
              <Input label="Discount (Rs)" name="discount" type="number" min={0} value={discount} onChange={(e) => setDiscount(Number(e.target.value))} />
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Line items</CardTitle>
              <Button type="button" variant="secondary" size="sm" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
                Add item
              </Button>
            </div>
          </CardHeader>
          <CardBody className="space-y-3">
            {items.map((item, index) => (
              <div key={index} className="grid grid-cols-1 items-end gap-3 md:grid-cols-[1fr_80px_120px_auto]">
                <Input label={index === 0 ? "Description" : ""} name={`desc-${index}`} value={item.description} onChange={(e) => updateItem(index, "description", e.target.value)} placeholder="Consulting services" required />
                <Input label={index === 0 ? "Qty" : ""} name={`qty-${index}`} type="number" min={1} value={item.quantity} onChange={(e) => updateItem(index, "quantity", Number(e.target.value))} required />
                <Input label={index === 0 ? "Unit price (Rs)" : ""} name={`price-${index}`} type="number" min={0} step="0.01" value={item.unitPrice} onChange={(e) => updateItem(index, "unitPrice", Number(e.target.value))} required />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setItems((prev) => prev.filter((_, idx) => idx !== index))}
                  disabled={items.length === 1}
                >
                  Remove
                </Button>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardBody>
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-400">Preview estimate</p>
            <dl className="space-y-1.5 text-sm">
              {[
                ["Subtotal", fmtINR(preview.subtotal)],
                [`Tax (${taxPct}%)`, fmtINR(preview.tax)],
                ["Discount", `-${fmtINR(discount)}`],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-gray-500"><span>{label}</span><span>{value}</span></div>
              ))}
              <div className="flex justify-between border-t border-gray-100 pt-2 font-semibold text-gray-900">
                <span>Total</span><span>{fmtINR(preview.total)}</span>
              </div>
            </dl>
            {signatureEnabled && (
              <div className="mt-5 flex justify-end border-t border-gray-100 pt-4">
                <div className="min-w-48 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-right">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Digital Signature</p>
                  <p className="mt-6 text-sm font-semibold text-gray-900">{signatureName || "Authorized Signatory"}</p>
                  <p className="text-xs text-gray-500">{signatureDesignation || "For BusinessOps"}</p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>

        <div className="flex justify-end gap-3">
          <Button href="/invoices" variant="secondary">Cancel</Button>
          <Button type="submit" disabled={loading}>{loading ? "Creating..." : "Create invoice"}</Button>
        </div>
      </form>
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </PageShell>
  );
}
