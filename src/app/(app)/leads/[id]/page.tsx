"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  Breadcrumb,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  CardToolbar,
  ConfirmDialog,
  EmptyState,
  Input,
  PageShell,
  Select,
  StatusBadge,
  Textarea,
  Toast,
  type ToastType,
} from "@/shared/ui";
import { FileUpload } from "@/features/uploads/FileUpload";
import { Icon } from "@/shared/icons/Icon";
import { cn } from "@/shared/utils/cn";

interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  source: string;
  status: string;
  assigneeName: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface FollowUp {
  id: string;
  message: string;
  followUpDate: string;
  status: string;
  createdAt: string;
}

type MessageChannel = "email" | "whatsapp";

interface IntegrationStatus {
  email: { type: string; provider: string } | null;
  whatsapp: { type: string; provider: string } | null;
  payment: { type: string; provider: string } | null;
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [lead, setLead] = useState<Lead | null>(null);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [newFU, setNewFU] = useState({ followUpDate: "", message: "" });
  const [followUpPreset, setFollowUpPreset] = useState("tomorrow");
  const [addingFU, setAddingFU] = useState(false);
  const [showAddFU, setShowAddFU] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: ToastType } | null>(null);
  const [integrationStatus, setIntegrationStatus] = useState<IntegrationStatus>({ email: null, whatsapp: null, payment: null });
  const [showMessageMenu, setShowMessageMenu] = useState(false);
  const [messageChannel, setMessageChannel] = useState<MessageChannel | null>(null);
  const [messageForm, setMessageForm] = useState({ recipient: "", subject: "", body: "" });
  const [sendingMessage, setSendingMessage] = useState(false);

  // Clipboard copy state
  const [copiedEmail, setCopiedEmail] = useState(false);

  const showToast = (msg: string, type: ToastType = "success") => setToast({ message: msg, type });

  useEffect(() => {
    const controller = new AbortController();

    async function fetchLead() {
      try {
        const [leadRes, fuRes, integrationRes] = await Promise.all([
          fetch(`/api/leads/${id}`, { signal: controller.signal }),
          fetch(`/api/leads/${id}/followups`, { signal: controller.signal }),
          fetch("/api/integrations/status", { signal: controller.signal }).catch(() => null),
        ]);
        if (controller.signal.aborted) return;
        if (leadRes.status === 403) {
          setForbidden(true);
          return;
        }
        if (leadRes.status === 404) {
          setNotFound(true);
          return;
        }
        if (!leadRes.ok) throw new Error();
        const leadData = await leadRes.json();
        const fuData = await fuRes.json();
        const integrationData = integrationRes && integrationRes.ok ? await integrationRes.json() : null;
        if (controller.signal.aborted) return;
        setLead(leadData.data);
        setFollowUps(fuData.data || []);
        if (integrationData?.data) setIntegrationStatus(integrationData.data);
      } catch {
        if (!controller.signal.aborted) setToast({ message: "Failed to load lead", type: "error" });
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void fetchLead();
    return () => controller.abort();
  }, [id]);

  async function handleDelete() {
    setDeleting(true);
    const res = await fetch(`/api/leads/${id}`, { method: "DELETE" });
    if (res.ok) {
      router.push("/leads");
      return;
    }
    const data = await res.json();
    showToast(data.error ?? "Delete failed", "error");
    setDeleting(false);
    setShowDelete(false);
  }

  async function handleAddFollowUp(e: React.FormEvent) {
    e.preventDefault();
    setAddingFU(true);
    try {
      const res = await fetch(`/api/leads/${id}/followups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newFU),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error ?? "Failed to add follow-up", "error");
        return;
      }
      setFollowUps((prev) => [...prev, data.data]);
      setNewFU({ followUpDate: "", message: "" });
      setFollowUpPreset("tomorrow");
      setShowAddFU(false);
      showToast("Follow-up added");
    } catch {
      showToast("Network error", "error");
    } finally {
      setAddingFU(false);
    }
  }

  async function updateFUStatus(fuId: string, status: string) {
    const res = await fetch(`/api/followups/${fuId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      setFollowUps((prev) => prev.map((f) => (f.id === fuId ? { ...f, status } : f)));
      showToast(`Marked as ${status}`);
    } else {
      showToast("Update failed", "error");
    }
  }

  const handleCopyEmail = () => {
    if (lead?.email && typeof navigator !== "undefined") {
      void navigator.clipboard.writeText(lead.email).then(() => {
        setCopiedEmail(true);
        setTimeout(() => setCopiedEmail(false), 2000);
        showToast("Email copied to clipboard");
      });
    }
  };

  const openMessageForm = (channel: MessageChannel) => {
    if (!lead) return;
    setMessageChannel(channel);
    setShowMessageMenu(false);
    setMessageForm({
      recipient: channel === "email" ? lead.email : lead.phone ?? "",
      subject: channel === "email" ? `Follow-up with ${lead.name}` : "",
      body: channel === "email"
        ? `Hi ${lead.name},\n\nFollowing up on your enquiry with ${lead.company ?? "our team"}.`
        : `Hi ${lead.name}, following up on your enquiry with ${lead.company ?? "our team"}.`,
    });
  };

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
          relatedEntity: "lead",
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

  const getPresetDate = (days: number) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split("T")[0];
  };

  const handleFollowUpPresetChange = (value: string) => {
    setFollowUpPreset(value);
    if (value === "today") setNewFU((prev) => ({ ...prev, followUpDate: getPresetDate(0) }));
    if (value === "tomorrow") setNewFU((prev) => ({ ...prev, followUpDate: getPresetDate(1) }));
    if (value === "three-days") setNewFU((prev) => ({ ...prev, followUpDate: getPresetDate(3) }));
    if (value === "next-week") setNewFU((prev) => ({ ...prev, followUpDate: getPresetDate(7) }));
  };

  // Helper date formatter
  const formatDateString = (dateStr: string) => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  };

  // Helper relative date calculators
  const getRelativeDateLabel = (dateStr: string) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dateStr + "T00:00:00");
    target.setHours(0, 0, 0, 0);

    const diffTime = target.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays === -1) return "Yesterday";
    if (diffDays > 1) return `In ${diffDays} days`;
    return `${Math.abs(diffDays)} days overdue`;
  };

  const getBorderColorClass = (status: string, dateStr: string) => {
    if (status !== "Pending") {
      return status === "Completed" ? "border-l-emerald-500" : "border-l-gray-300";
    }
    const today = new Date().toISOString().split("T")[0];
    if (dateStr < today) {
      return "border-l-red-500 bg-red-50/5"; // Overdue
    }
    if (dateStr === today) {
      return "border-l-blue-500 bg-blue-50/5"; // Today
    }
    return "border-l-gray-200"; // Upcoming
  };

  const getRelativeBadgeClass = (dateStr: string, status: string) => {
    if (status !== "Pending") return "bg-gray-100 text-gray-500 border-gray-200";
    const today = new Date().toISOString().split("T")[0];
    if (dateStr < today) {
      return "bg-red-50 text-red-600 border-red-100 font-semibold";
    }
    if (dateStr === today) {
      return "bg-blue-50 text-blue-600 border-blue-100 font-semibold";
    }
    return "bg-gray-50 text-gray-500 border-gray-200";
  };

  if (loading) return <EmptyState title="Loading..." description="Fetching lead details." />;
  
  if (forbidden) {
    return (
      <EmptyState
        title="Access denied"
        description="You do not have permission to view this lead."
        action={<Button variant="secondary" href="/leads">Back to leads</Button>}
      />
    );
  }
  
  if (notFound) {
    return (
      <EmptyState
        title="Lead not found"
        description="The lead you are looking for does not exist or has been deleted."
        action={<Button variant="secondary" href="/leads">Back to leads</Button>}
      />
    );
  }
  
  if (!lead) return null;

  return (
    <PageShell
      width="full"
      title={lead.name}
      description={lead.company ?? "No company recorded"}
      meta={<StatusBadge status={lead.status} />}
      breadcrumbs={
        <Breadcrumb items={[{ label: "Leads", href: "/leads" }, { label: lead.name }]} />
      }
      actions={
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <Button variant="secondary" href={`/invoices/new?leadId=${lead.id}&clientName=${encodeURIComponent(`${lead.name}${lead.company ? ` / ${lead.company}` : ""}`)}`}>
            <Icon name="invoice" />
            Create Invoice
          </Button>
          {(integrationStatus.email || integrationStatus.whatsapp) && (
            <div className="relative">
              <Button variant="secondary" onClick={() => setShowMessageMenu((prev) => !prev)}>
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
          <Button variant="secondary" href={`/leads/${id}/edit`}>
            <Icon name="user" />
            Edit Lead
          </Button>
          <Button variant="danger" onClick={() => setShowDelete(true)}>
            Delete
          </Button>
        </div>
      }
    >
      <div className="mx-auto max-w-6xl min-w-0">
        <div className="grid min-w-0 grid-cols-1 items-start gap-4 sm:gap-6 lg:grid-cols-3">
          
          {/* LEFT: Main Workspace Area (2/3 width) */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Notes Section (Rich Quote style) */}
            {lead.notes && (
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <div className="flex items-center gap-2">
                    <Icon name="message" className="size-4.5 text-amber-500" />
                    <CardTitle>Lead Notes</CardTitle>
                  </div>
                </CardHeader>
                <CardBody className="p-5">
                  <div className="relative border-l-4 border-amber-500 bg-amber-50/15 p-4 rounded-r-lg">
                    <p className="whitespace-pre-wrap text-sm text-gray-700 leading-relaxed font-normal">
                      {lead.notes}
                    </p>
                  </div>
                </CardBody>
              </Card>
            )}

            {/* Follow-ups timeline */}
            <Card className="shadow-sm border-gray-200/80 bg-white">
              <CardHeader className="border-b border-gray-100 p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon name="clock" className="size-4.5 text-blue-500" />
                    <CardTitle>Scheduled Follow-ups</CardTitle>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setShowAddFU((v) => !v);
                      setFollowUpPreset("tomorrow");
                      setNewFU((prev) => ({ ...prev, followUpDate: prev.followUpDate || getPresetDate(1) }));
                    }}
                    className="flex items-center gap-1"
                  >
                    <Icon name="plus" className="size-3.5" />
                    Add follow-up
                  </Button>
                </div>
              </CardHeader>

              {showAddFU && (
                <CardToolbar className="bg-gray-50/50 p-4 border-b border-gray-100">
                  <form onSubmit={handleAddFollowUp} className="flex w-full flex-col gap-3.5 sm:flex-row sm:flex-wrap sm:items-end">
                    <div className="w-full sm:w-48">
                      <Select
                        label="When"
                        value={followUpPreset}
                        onChange={(e) => handleFollowUpPresetChange(e.target.value)}
                        options={[
                          { label: "Today", value: "today" },
                          { label: "Tomorrow", value: "tomorrow" },
                          { label: "In 3 days", value: "three-days" },
                          { label: "Next week", value: "next-week" },
                          { label: "Custom date", value: "custom" },
                        ]}
                      />
                    </div>
                    {followUpPreset === "custom" && (
                      <Input
                        label="Custom Date"
                        type="date"
                        required
                        value={newFU.followUpDate}
                        onChange={(e) => setNewFU((p) => ({ ...p, followUpDate: e.target.value }))}
                        wrapperClassName="w-full sm:w-44"
                      />
                    )}
                    <Input
                      label="Action Note"
                      required
                      value={newFU.message}
                      onChange={(e) => setNewFU((p) => ({ ...p, message: e.target.value }))}
                      placeholder="What is the next callback step?"
                      wrapperClassName="min-w-48 flex-1"
                    />
                    <div className="flex w-full flex-wrap gap-2 sm:w-auto">
                      <Button type="submit" disabled={addingFU}>
                        {addingFU ? "Adding..." : "Add Action"}
                      </Button>
                      <Button type="button" variant="ghost" onClick={() => setShowAddFU(false)}>
                        Cancel
                      </Button>
                    </div>
                  </form>
                </CardToolbar>
              )}

              <CardBody className="p-0">
                {followUps.length === 0 ? (
                  <EmptyState title="No follow-ups scheduled" description="Keep this lead active by creating a callback task." />
                ) : (
                  <div className="divide-y divide-gray-100">
                    {followUps.map((fu) => (
                      <div
                        key={fu.id}
                        className={cn(
                          "flex flex-col items-start justify-between gap-3 border-l-4 p-4 transition-colors duration-150 sm:flex-row sm:items-center",
                          getBorderColorClass(fu.status, fu.followUpDate)
                        )}
                      >
                        <div className="min-w-0 space-y-1">
                          <p className="text-sm font-medium text-gray-800 leading-relaxed">{fu.message}</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={cn("inline-flex items-center rounded px-2 py-0.5 text-[10px] font-medium border", getRelativeBadgeClass(fu.followUpDate, fu.status))}>
                              {getRelativeDateLabel(fu.followUpDate)}
                            </span>
                            <span className="text-[11px] text-gray-400">
                              Scheduled due: {formatDateString(fu.followUpDate)}
                            </span>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 self-end sm:self-center">
                          <StatusBadge status={fu.status} />
                          {fu.status === "Pending" && (
                            <div className="flex gap-1.5 ml-1">
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => updateFUStatus(fu.id, "Completed")}
                                className="bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 hover:text-emerald-800 h-8 text-xs font-semibold"
                              >
                                Done
                              </Button>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => updateFUStatus(fu.id, "Cancelled")}
                                className="text-gray-500 border-gray-200 hover:bg-gray-50 h-8 text-xs font-semibold"
                              >
                                Cancel
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            {/* Attachments Section */}
            <Card className="shadow-sm border-gray-200/80 bg-white">
              <CardHeader className="border-b border-gray-100 p-5">
                <div className="flex items-center gap-2">
                  <Icon name="paperclip" className="size-4.5 text-gray-500" />
                  <CardTitle>Attachments & Files</CardTitle>
                </div>
              </CardHeader>
              <CardBody className="p-5">
                <FileUpload entityType="lead" entityId={id} />
              </CardBody>
            </Card>

          </div>

          {/* RIGHT: Contact details and Assignee Metadata (1/3 width) */}
          <div className="space-y-6">
            {messageChannel && (
              <Card className="shadow-sm border-gray-200/80 bg-white">
                <CardHeader className="border-b border-gray-100 p-5">
                  <CardTitle>{messageChannel === "email" ? "Send Email" : "Send WhatsApp"}</CardTitle>
                </CardHeader>
                <CardBody className="p-5">
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
            
            {/* Contact Card */}
            <Card className="shadow-sm border-gray-200/80 bg-white">
              <CardHeader className="border-b border-gray-100 p-5 bg-gray-50/20">
                <CardTitle>Contact Information</CardTitle>
              </CardHeader>
              <CardBody className="p-5 space-y-4">
                {/* Email coordinates */}
                <div className="border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Email Address
                  </span>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <a
                      href={`mailto:${lead.email}`}
                      className="text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline truncate"
                    >
                      {lead.email}
                    </a>
                    <button
                      type="button"
                      onClick={handleCopyEmail}
                      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition"
                      title="Copy email to clipboard"
                    >
                      {copiedEmail ? (
                        <Icon name="check" className="text-emerald-600" />
                      ) : (
                        <Icon name="copy" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Phone details */}
                <div className="border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Phone Number
                  </span>
                  <div className="mt-1 flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-gray-800">
                      {lead.phone ?? "-"}
                    </span>
                    {lead.phone && (
                      <a
                        href={`tel:${lead.phone}`}
                        className="p-1 rounded hover:bg-blue-50 text-blue-500 hover:text-blue-700 transition"
                        title="Start call dialer"
                      >
                        <Icon name="phone" />
                      </a>
                    )}
                  </div>
                </div>

                {/* Company details */}
                <div className="border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Company
                  </span>
                  <span className="mt-1 block text-sm font-medium text-gray-800">
                    {lead.company ?? "-"}
                  </span>
                </div>

                {/* Lead Source */}
                <div className="border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Lead Source
                  </span>
                  <div className="mt-1.5">
                    <span className="inline-flex items-center rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-600">
                      {lead.source}
                    </span>
                  </div>
                </div>
              </CardBody>
            </Card>

            {/* Systems and Metadata details */}
            <Card className="shadow-sm border-gray-200/80 bg-white">
              <CardHeader className="border-b border-gray-100 p-5 bg-gray-50/20">
                <CardTitle>System Information</CardTitle>
              </CardHeader>
              <CardBody className="p-5 space-y-4">
                {/* Assignee info */}
                <div className="border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Assigned Owner
                  </span>
                  <span className="mt-1 block text-sm font-medium text-gray-800">
                    {lead.assigneeName ?? "Unassigned"}
                  </span>
                </div>

                {/* Created Date */}
                <div className="border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Registration Date
                  </span>
                  <span className="mt-1 block text-sm font-medium text-gray-800">
                    {formatDateString(lead.createdAt)}
                  </span>
                </div>

                {/* Updated Date */}
                <div className="border-b border-gray-50 pb-3 last:border-b-0 last:pb-0">
                  <span className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                    Last Modified
                  </span>
                  <span className="mt-1 block text-sm font-medium text-gray-800">
                    {formatDateString(lead.updatedAt)}
                  </span>
                </div>
              </CardBody>
            </Card>

          </div>
        </div>
      </div>

      {showDelete && (
        <ConfirmDialog
          title="Delete this lead?"
          message={`"${lead.name}" and all associated follow-ups will be permanently removed.`}
          onConfirm={handleDelete}
          onCancel={() => setShowDelete(false)}
          loading={deleting}
        />
      )}
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
    </PageShell>
  );
}
