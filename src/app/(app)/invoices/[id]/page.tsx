"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useApiResource } from "@/shared/hooks/useApiResource";
import { useToast } from "@/shared/hooks/useToast";
import { Breadcrumb, Button, Card, CardBody, CardHeader, CardTitle, EmptyState, Input, PageShell, StatusBadge, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Textarea, Toast } from "@/shared/ui";
import { FileUpload } from "@/features/uploads/FileUpload";
import { Icon } from "@/shared/icons/Icon";

interface InvoiceItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
}

interface Invoice {
  id: string;
  invoiceNumber: string;
  clientName: string;
  status: string;
  subtotal: string;
  taxPercentage: string;
  taxAmount: string;
  discount: string;
  totalAmount: string;
  leadId: string | null;
  createdAt: string;
  updatedAt: string;
  items: InvoiceItem[];
}

type MessageChannel = "email" | "whatsapp";

interface IntegrationStatus {
  email: { type: string; provider: string } | null;
  whatsapp: { type: string; provider: string } | null;
  payment: { type: string; provider: string } | null;
}

const fmt = (n: string) => `Rs ${Number(n).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
const fmtDate = (value: string) => new Date(value).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
const defaultTemplateTitle = "Tax Invoice";
const defaultTemplateNote = "Thank you for your business. Payment is due as per agreed terms.";

export default function InvoiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: invoice, loading, status: httpStatus, refetch } = useApiResource<Invoice>(`/api/invoices/${id}`);
  const { toast, showToast, clearToast } = useToast();
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus>({ email: null, whatsapp: null, payment: null });
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const [messageChannel, setMessageChannel] = useState<MessageChannel | null>(null);
  const [messageForm, setMessageForm] = useState({ recipient: "", subject: "", body: "" });
  const [sendingMessage, setSendingMessage] = useState(false);
  const [paymentLink, setPaymentLink] = useState("");
  const [templateTitle, setTemplateTitle] = useState(defaultTemplateTitle);
  const [templateNote, setTemplateNote] = useState(defaultTemplateNote);
  const [signatureEnabled, setSignatureEnabled] = useState(true);
  const [signatureName, setSignatureName] = useState("");
  const [signatureDesignation, setSignatureDesignation] = useState("");
  const [actionPending, setActionPending] = useState(false);
  const invoiceUrl = typeof window === "undefined" ? "" : window.location.href;

  useEffect(() => {
    async function loadIntegrationStatus() {
      try {
        const res = await fetch("/api/integrations/status");
        if (!res.ok) return;
        const json = await res.json();
        setIntegrationStatus(json.data);
      } catch {
        // Message actions remain hidden if status cannot load.
      }
    }
    void loadIntegrationStatus();
  }, []);

  useEffect(() => {
    setTimeout(() => {
      setTemplateTitle(localStorage.getItem("invoice_template_title") || defaultTemplateTitle);
      setTemplateNote(localStorage.getItem("invoice_template_note") || defaultTemplateNote);
      setSignatureEnabled(localStorage.getItem("invoice_signature_enabled") !== "false");
      setSignatureName(localStorage.getItem("invoice_signature_name") || "");
      setSignatureDesignation(localStorage.getItem("invoice_signature_designation") || "");
    }, 0);
  }, []);

  async function changeStatus(newStatus: string) {
    setActionPending(true);
    try {
      const res = await fetch(`/api/invoices/${id}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Update failed", "error");
        return;
      }
      showToast(`Invoice marked as ${newStatus}`);
      refetch();
    } catch {
      showToast("Network error", "error");
    } finally {
      setActionPending(false);
    }
  }

  async function sendInvoice() {
    setActionPending(true);
    try {
      const res = await fetch(`/api/invoices/${id}/send`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Send failed", "error");
        return;
      }
      showToast("Invoice sent");
      refetch();
    } catch {
      showToast("Network error", "error");
    } finally {
      setActionPending(false);
    }
  }

  async function triggerPayment() {
    setActionPending(true);
    try {
      const res = await fetch("/api/payments/mock-create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: id }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Payment initiation failed", "error");
        return;
      }
      showToast(`Payment initiated: ${data.data.transactionId}`);
    } catch {
      showToast("Network error", "error");
    } finally {
      setActionPending(false);
    }
  }

  async function simulatePayment(status: "Success" | "Failed") {
    setActionPending(true);
    try {
      const res = await fetch("/api/payments/mock-webhook-test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: id, status }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Webhook failed", "error");
      } else {
        if (status === "Success") {
          showToast("Payment marked paid");
        } else {
          showToast("Payment logged as failed", "error");
        }
        refetch();
      }
    } catch {
      showToast("Network error", "error");
    } finally {
      setActionPending(false);
    }
  }

  const openMessageForm = (channel: MessageChannel) => {
    if (!invoice) return;
    setMessageChannel(channel);
    setShowMessageMenu(false);
    setMessageForm({
      recipient: "",
      subject: channel === "email" ? `Invoice #${invoice.invoiceNumber}` : "",
      body: channel === "email"
        ? `Hello,\n\nInvoice #${invoice.invoiceNumber} for ${fmt(invoice.totalAmount)} is ready for ${invoice.clientName}.`
        : `Your invoice #${invoice.invoiceNumber} for ${fmt(invoice.totalAmount)} is ready.`,
    });
  };

  function getShareText() {
    if (!invoice) return "";
    return [
      `Invoice ${invoice.invoiceNumber}`,
      `Client: ${invoice.clientName}`,
      `Amount: ${fmt(invoice.totalAmount)}`,
      `Status: ${invoice.status}`,
      invoiceUrl ? `Link: ${invoiceUrl}` : "",
    ].filter(Boolean).join("\n");
  }

  function shareByEmail() {
    if (!invoice) return;
    const subject = `Invoice ${invoice.invoiceNumber} - ${invoice.clientName}`;
    const body = `Hello,\n\nPlease find the invoice details below:\n\n${getShareText()}\n\nThank you.`;
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function shareByWhatsApp() {
    const text = getShareText();
    if (!text) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  async function copyInvoiceLink() {
    if (!invoiceUrl) return;
    try {
      await navigator.clipboard.writeText(invoiceUrl);
      showToast("Invoice link copied");
    } catch {
      showToast("Could not copy invoice link", "error");
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!messageChannel) return;
    setSendingMessage(true);
    try {
      const res = await fetch("/api/messages/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: messageChannel,
          recipient: messageForm.recipient,
          subject: messageChannel === "email" ? messageForm.subject : null,
          body: messageForm.body,
          relatedEntity: "invoice",
          relatedId: id,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Message send failed", "error");
        return;
      }
      showToast("Message sent");
      setMessageChannel(null);
    } catch {
      showToast("Network error sending message", "error");
    } finally {
      setSendingMessage(false);
    }
  }

  function handleGeneratePaymentLink() {
    if (!invoice || !integrationStatus.payment) return;
    const providerSlug = integrationStatus.payment.provider.replace("_mock", "").replace(/_/g, "-");
    setPaymentLink(`https://pay.mock-${providerSlug}.local/inv/${invoice.invoiceNumber}`);
    showToast("Payment link generated");
  }

  if (loading) return <EmptyState title="Loading..." />;
  if (httpStatus === 404 || !invoice) return <EmptyState title="Invoice not found" action={<Button href="/invoices">Back to invoices</Button>} />;

  return (
    <PageShell
      width="lg"
      title={invoice.invoiceNumber}
      description={invoice.clientName}
      meta={<StatusBadge status={invoice.status} />}
      breadcrumbs={<Breadcrumb items={[{ label: "Invoices", href: "/invoices" }, { label: invoice.invoiceNumber }]} />}
      actions={
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={shareByEmail}>
            <Icon name="mail" />
            Email
          </Button>
          <Button variant="secondary" size="sm" onClick={shareByWhatsApp}>
            <Icon name="smartphone" />
            WhatsApp
          </Button>
          {(integrationStatus.email || integrationStatus.whatsapp) && (
            <div className="relative">
              <Button variant="secondary" size="sm" onClick={() => setShowMessageMenu((prev) => !prev)}>
                <Icon name="send" />
                Send Message
              </Button>
              {showMessageMenu && (
                <div className="absolute right-0 z-30 mt-2 w-44 rounded-lg border border-gray-200 bg-white p-1 shadow-md">
                  {integrationStatus.email && (
                    <button
                      type="button"
                      onClick={() => openMessageForm("email")}
                      className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Send Email
                    </button>
                  )}
                  {integrationStatus.whatsapp && (
                    <button
                      type="button"
                      onClick={() => openMessageForm("whatsapp")}
                      className="w-full rounded-md px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                    >
                      Send WhatsApp
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {invoice.status === "Draft" && <Button variant="secondary" size="sm" onClick={sendInvoice} disabled={actionPending}><Icon name="send" />{actionPending ? "Sending..." : "Send"}</Button>}
          {invoice.status === "Draft" && <Button variant="danger" size="sm" onClick={() => changeStatus("Cancelled")} disabled={actionPending}>{actionPending ? "Cancelling..." : "Cancel"}</Button>}
          {invoice.status === "Sent" && <Button size="sm" onClick={triggerPayment} disabled={actionPending}><Icon name="creditCard" />{actionPending ? "Processing..." : "Process payment"}</Button>}
          {invoice.status === "Sent" && <Button variant="danger" size="sm" onClick={() => changeStatus("Cancelled")} disabled={actionPending}>{actionPending ? "Cancelling..." : "Cancel"}</Button>}
        </div>
      }
    >
      <Card className="overflow-hidden border-blue-100">
        <CardBody className="bg-gradient-to-r from-blue-50 to-white p-5">
          <div className="grid gap-4 md:grid-cols-[1.2fr_0.8fr] md:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-600">{templateTitle}</p>
              <h2 className="mt-1 text-2xl font-semibold text-gray-950">{invoice.clientName}</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-600">{templateNote}</p>
            </div>
            <div className="grid gap-2 rounded-lg border border-blue-100 bg-white/80 p-4 shadow-sm">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-500">Invoice No.</span>
                <span className="font-mono font-semibold text-gray-950">{invoice.invoiceNumber}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-500">Created</span>
                <span className="font-medium text-gray-900">{fmtDate(invoice.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="text-gray-500">Total</span>
                <span className="text-lg font-semibold text-blue-700">{fmt(invoice.totalAmount)}</span>
              </div>
            </div>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>Invoice Items</CardTitle>
              <p className="mt-1 text-sm text-gray-500">{invoice.items.length} billable line item{invoice.items.length === 1 ? "" : "s"}</p>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-right">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Status</p>
              <p className="text-sm font-semibold text-gray-900">{invoice.status}</p>
            </div>
          </div>
        </CardHeader>
        <Table>
          <TableHead>
            <TableRow>
              {["Description", "Qty", "Unit price", "Total"].map((header) => <TableHeaderCell key={header}>{header}</TableHeaderCell>)}
            </TableRow>
          </TableHead>
          <TableBody>
            {invoice.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell>{item.description}</TableCell>
                <TableCell>{item.quantity}</TableCell>
                <TableCell>{fmt(item.unitPrice)}</TableCell>
                <TableCell className="font-semibold text-gray-900">{fmt(item.lineTotal)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {messageChannel && (
        <Card>
          <CardHeader><CardTitle>{messageChannel === "email" ? "Send Email" : "Send WhatsApp"}</CardTitle></CardHeader>
          <CardBody>
            <form onSubmit={handleSendMessage} className="space-y-4">
              <Input
                label="Recipient"
                value={messageForm.recipient}
                onChange={(e) => setMessageForm((prev) => ({ ...prev, recipient: e.target.value }))}
                required
              />
              {messageChannel === "email" && (
                <Input
                  label="Subject"
                  value={messageForm.subject}
                  onChange={(e) => setMessageForm((prev) => ({ ...prev, subject: e.target.value }))}
                  required
                />
              )}
              <Textarea
                label="Body"
                rows={5}
                value={messageForm.body}
                onChange={(e) => setMessageForm((prev) => ({ ...prev, body: e.target.value }))}
                required
              />
              <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                <Button type="button" variant="secondary" onClick={() => setMessageChannel(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={sendingMessage}>
                  {sendingMessage ? "Sending..." : "Send"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      {integrationStatus.payment && (
        <Card>
          <CardHeader><CardTitle>Payment Link</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <div className="rounded-lg border border-gray-200 bg-gray-50/50 px-4 py-3">
              <p className="break-all font-mono text-sm text-gray-700">
                {paymentLink || "No payment link generated yet."}
              </p>
            </div>
            <div className="flex justify-end">
              <Button size="sm" onClick={handleGeneratePaymentLink}>
                Generate Payment Link
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <Card>
        <CardBody>
          <dl className="space-y-2 text-sm">
            {[
              ["Subtotal", fmt(invoice.subtotal)],
              [`Tax (${invoice.taxPercentage}%)`, fmt(invoice.taxAmount)],
              ["Discount", `-${fmt(invoice.discount)}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between text-gray-500"><span>{label}</span><span>{value}</span></div>
            ))}
            <div className="flex justify-between border-t border-gray-100 pt-2 text-base font-semibold text-gray-900">
              <span>Total</span><span>{fmt(invoice.totalAmount)}</span>
            </div>
          </dl>
          {invoice.status === "Paid" && (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-700">
              Payment confirmed via webhook
            </div>
          )}
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

        <Card>
          <CardHeader><CardTitle>Share Invoice</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <Button className="w-full justify-start" variant="secondary" onClick={shareByEmail}>
              <Icon name="mail" />
              Open Email Draft
            </Button>
            <Button className="w-full justify-start" variant="secondary" onClick={shareByWhatsApp}>
              <Icon name="smartphone" />
              Open WhatsApp Web
            </Button>
            <Button className="w-full justify-start" variant="ghost" onClick={copyInvoiceLink}>
              <Icon name="copy" />
              Copy Invoice Link
            </Button>
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Optional Supporting Files</CardTitle>
        </CardHeader>
        <CardBody>
          <FileUpload entityType="invoice" entityId={id} />
        </CardBody>
      </Card>

      {invoice.status === "Sent" && (
        <Card>
          <CardHeader><CardTitle>Payment test</CardTitle></CardHeader>
          <CardBody className="space-y-3">
            <p className="text-xs text-gray-500">
              Simulate a payment callback to test the paid and failed invoice states.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={actionPending} onClick={() => simulatePayment("Success")}>
                {actionPending ? "Simulating..." : "Simulate success"}
              </Button>
              <Button size="sm" variant="danger" disabled={actionPending} onClick={() => simulatePayment("Failed")}>
                {actionPending ? "Simulating..." : "Simulate failure"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </PageShell>
  );
}
