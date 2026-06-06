"use client";
import { type ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Breadcrumb,
  Button,
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  PageShell,
  Select,
  Textarea,
  Toast,
} from "@/shared/ui";
import { useToast } from "@/shared/hooks/useToast";
import { LEAD_STATUSES } from "@/shared/constants";
import { Icon } from "@/shared/icons/Icon";
import { createLeadSchema, updateLeadSchema } from "@/features/leads/lead.schema";
import { cn } from "@/shared/utils/cn";

const SOURCES = ["Website","Referral","Cold Call","Social Media","Email Campaign","Walk-In","Other"];
const SOURCE_OPTIONS = SOURCES.map((source) => ({ label: source, value: source }));
const STATUS_OPTIONS = LEAD_STATUSES.map((status) => ({ label: status, value: status }));
const COUNTRY_CODES = [
  { label: "India (+91)", value: "91" },
  { label: "USA (+1)", value: "1" },
  { label: "UK (+44)", value: "44" },
  { label: "UAE (+971)", value: "971" },
  { label: "Australia (+61)", value: "61" },
];
const statusColor: Record<string, string> = {
  New: "bg-blue-500",
  Contacted: "bg-sky-500",
  "Follow-Up": "bg-amber-500",
  Converted: "bg-emerald-500",
  Lost: "bg-red-500",
};

type FormState = {
  name: string;
  email: string;
  phone: string;
  company: string;
  source: string;
  status: string;
  assignedTo: string;
  notes: string;
};

interface UserOption {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
}

interface LeadFormProps {
  /** undefined = create mode, defined = edit mode */
  initialValues?: Partial<FormState>;
  leadId?: string;
  cancelHref: string;
}

function toForm(v: Partial<FormState> = {}): FormState {
  return {
    name: v.name ?? "",
    email: v.email ?? "",
    phone: formatPhone(v.phone ?? ""),
    company: v.company ?? "",
    source: v.source ?? "Other",
    status: v.status ?? "New",
    assignedTo: v.assignedTo ?? "",
    notes: v.notes ?? "",
  };
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function formatPhone(value: string) {
  const digits = onlyDigits(value).slice(0, 12);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function splitCountryPhone(value: string) {
  const digits = onlyDigits(value);
  const match = COUNTRY_CODES
    .slice()
    .sort((a, b) => b.value.length - a.value.length)
    .find((country) => digits.startsWith(country.value) && digits.length > country.value.length + 4);
  return {
    countryCode: match?.value ?? "91",
    localPhone: match ? digits.slice(match.value.length) : digits,
  };
}

function FieldIcon({ children }: { children: ReactNode }) {
  return (
    <span className="pointer-events-none absolute left-3 top-[34px] text-gray-400">
      {children}
    </span>
  );
}

function IconInput({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("relative", className)}>{children}</div>;
}

function StatusPicker({
  error,
  onChange,
  value,
}: {
  error?: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <span className="block text-sm font-medium text-gray-700">Status</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "mt-1 flex min-h-10 w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-950 outline-none transition-colors hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100",
          error && "border-red-300 focus:border-red-500 focus:ring-red-100",
        )}
      >
        <span className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", statusColor[value] ?? "bg-gray-400")} />
          {value}
        </span>
        <Icon name="chevronDown" className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-2 w-full rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
          {STATUS_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50"
            >
              <span className={cn("size-2 rounded-full", statusColor[option.value] ?? "bg-gray-400")} />
              {option.label}
            </button>
          ))}
        </div>
      )}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </div>
  );
}

function AgentPicker({
  agents,
  value,
  onChange,
}: {
  agents: UserOption[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = agents.find((agent) => agent.id === value);
  const duplicateNames = agents.reduce<Record<string, number>>((acc, agent) => {
    acc[agent.name] = (acc[agent.name] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="relative">
      <span className="block text-sm font-medium text-gray-700">Assign to agent</span>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-1 flex min-h-10 w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-3 text-left text-sm text-gray-950 outline-none transition-colors hover:border-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
      >
        <span className="flex min-w-0 items-center gap-3">
          <Avatar name={selected?.name ?? "Unassigned"} />
          <span className="truncate">{selected?.name ?? "Unassigned"}</span>
        </span>
        <Icon name="chevronDown" className="text-gray-400" />
      </button>
      {open && (
        <div className="absolute z-20 mt-2 max-h-72 w-full overflow-y-auto rounded-lg border border-gray-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50"
          >
            <Avatar name="Unassigned" />
            Unassigned
          </button>
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              onClick={() => {
                onChange(agent.id);
                setOpen(false);
              }}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-50"
            >
              <Avatar name={agent.name} />
              <span className="min-w-0">
                <span className="block truncate font-medium text-gray-800">{agent.name}</span>
                {duplicateNames[agent.name] > 1 && (
                  <span className="block truncate text-xs text-gray-500">{agent.email}</span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">
      {initials || "UA"}
    </span>
  );
}

export function LeadForm({ initialValues, leadId, cancelHref }: LeadFormProps) {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(toForm(initialValues));
  const [phoneCountryCode, setPhoneCountryCode] = useState(() => splitCountryPhone(initialValues?.phone ?? "").countryCode);
  const [errors, setErrors] = useState<Partial<FormState>>({});
  const [canAssign, setCanAssign] = useState(false);
  const [agentOptions, setAgentOptions] = useState<UserOption[]>([]);
  const [recommendedAgentId, setRecommendedAgentId] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast, showToast, clearToast } = useToast();

  const set = (field: keyof FormState) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((p) => ({ ...p, [field]: e.target.value }));
  const setValue = (field: keyof FormState, value: string) =>
    setForm((p) => ({ ...p, [field]: value }));

  const isEdit = !!leadId;

  useEffect(() => {
    let cancelled = false;

    async function loadAgents() {
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) return;
      const meJson = await meRes.json();
      const role = meJson.data?.role;
      const allowed = role === "admin" || role === "manager";
      if (cancelled) return;
      setCanAssign(allowed);
      if (!allowed) return;

      const usersRes = await fetch("/api/users");
      if (!usersRes.ok) return;
      const usersJson = await usersRes.json();
      const agents = (usersJson.data as UserOption[])
        .filter((user) => user.role === "agent" && user.isActive);
      if (cancelled) return;
      setAgentOptions(agents);

      if (!isEdit && agents.length > 0) {
        const leadsRes = await fetch("/api/leads?limit=100&sort=desc");
        const leadsJson = leadsRes.ok ? await leadsRes.json() : { data: [] };
        const workload = new Map(agents.map((agent) => [agent.id, 0]));
        for (const lead of leadsJson.data ?? []) {
          if (lead.assignedTo && workload.has(lead.assignedTo)) {
            workload.set(lead.assignedTo, (workload.get(lead.assignedTo) ?? 0) + 1);
          }
        }
        const recommended = agents
          .slice()
          .sort((a, b) => (workload.get(a.id) ?? 0) - (workload.get(b.id) ?? 0))[0];
        setRecommendedAgentId(recommended?.id ?? "");
        if (recommended) {
          setForm((prev) => prev.assignedTo ? prev : { ...prev, assignedTo: recommended.id });
        }
      }
    }

    void loadAgents();
    return () => {
      cancelled = true;
    };
  }, [isEdit]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    const payload = {
      ...form,
      phone: form.phone ? `${phoneCountryCode}${onlyDigits(form.phone)}` : "",
      assignedTo: form.assignedTo || null,
    };
    const parsed = (isEdit ? updateLeadSchema : createLeadSchema).safeParse(payload);
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

  const breadcrumbItems = [
    { label: "Leads", href: "/leads" },
    ...(isEdit ? [{ label: "Detail", href: `/leads/${leadId}` }] : []),
    { label: isEdit ? "Edit" : "New lead" },
  ];

  return (
    <PageShell
      width="lg"
      title={isEdit ? "Edit lead" : "New lead"}
      description="Keep lead details concise so the team can qualify and follow up quickly."
      breadcrumbs={<Breadcrumb items={breadcrumbItems} />}
    >
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle size="sm">Lead details</CardTitle>
        </CardHeader>
        <CardBody className="p-0">
          <form onSubmit={handleSubmit}>
            <div className="grid gap-4 p-6 sm:grid-cols-2">
              <IconInput>
                <Input
                  label="Full name *"
                  name="name"
                  value={form.name}
                  onChange={set("name")}
                  placeholder="Arjun Mehta"
                  error={errors.name}
                  className="pl-9"
                />
                <FieldIcon>
                  <Icon name="user" />
                </FieldIcon>
              </IconInput>
              <IconInput>
                <Input
                  label="Company"
                  name="company"
                  value={form.company}
                  onChange={set("company")}
                  placeholder="TechCorp"
                  error={errors.company}
                  className="pl-9"
                />
                <FieldIcon>
                  <Icon name="building" />
                </FieldIcon>
              </IconInput>
              <IconInput>
                <Input
                  label="Email *"
                  name="email"
                  type="email"
                  value={form.email}
                  onChange={set("email")}
                  placeholder="arjun@company.com"
                  error={errors.email}
                  className="pl-9"
                />
                <FieldIcon>
                  <span className="text-sm font-semibold">@</span>
                </FieldIcon>
              </IconInput>
              <IconInput>
                <Input
                  label="Phone"
                  name="phone"
                  value={form.phone}
                  onChange={(e) => setValue("phone", formatPhone(e.target.value))}
                  placeholder="9876543210"
                  error={errors.phone}
                  className="pl-9"
                />
                <FieldIcon>
                  <Icon name="phone" />
                </FieldIcon>
              </IconInput>
              <Select
                label="Country Code"
                value={phoneCountryCode}
                onChange={(e) => setPhoneCountryCode(e.target.value)}
                options={COUNTRY_CODES}
              />
              <Select label="Source" name="source" value={form.source} onChange={set("source")} options={SOURCE_OPTIONS} />
              <StatusPicker value={form.status} onChange={(value) => setValue("status", value)} error={errors.status} />

              {canAssign && (
                <div className="sm:col-span-2">
                  <AgentPicker
                    agents={agentOptions}
                    value={form.assignedTo}
                    onChange={(value) => setValue("assignedTo", value)}
                  />
                  {recommendedAgentId && (
                    <p className="mt-2 text-xs text-blue-600">
                      Auto-assigned to the agent with the lightest current workload. You can change it if needed.
                    </p>
                  )}
                </div>
              )}

              <Textarea
                label="Notes"
                name="notes"
                value={form.notes}
                onChange={set("notes")}
                rows={4}
                wrapperClassName="sm:col-span-2"
              />
            </div>

            <div className="sticky bottom-0 z-10 flex justify-end gap-3 border-t border-gray-100 bg-white/85 px-6 py-4 backdrop-blur">
              <Button variant="secondary" type="button" href={cancelHref}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? "Saving..." : isEdit ? "Save changes" : "Create lead"}
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {toast && <Toast message={toast.message} type={toast.type} onClose={clearToast} />}
    </PageShell>
  );
}
