"use client";

import { useState } from "react";
import { parseBusinessInfo, type BusinessInfo } from "@recepto/shared";
import { Button } from "@/components/ui/button";

type Office = BusinessInfo["offices"][number];
type Faq = BusinessInfo["faqs"][number];

const inputClass = "h-10 w-full rounded-md border bg-background px-3 text-sm";
const areaClass = "min-h-[72px] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm";

async function responseError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return body?.error?.message ?? "Something went wrong.";
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-xs text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function BusinessInfoEditor({ initial, disabled }: { initial: unknown; disabled: boolean }) {
  const [info, setInfo] = useState<BusinessInfo>(() => parseBusinessInfo(initial));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string>();

  const patch = (next: Partial<BusinessInfo>) => setInfo((current) => ({ ...current, ...next }));
  const patchOffice = (index: number, next: Partial<Office>) =>
    patch({ offices: info.offices.map((office, i) => (i === index ? { ...office, ...next } : office)) });
  const patchFaq = (index: number, next: Partial<Faq>) =>
    patch({ faqs: info.faqs.map((faq, i) => (i === index ? { ...faq, ...next } : faq)) });

  async function save() {
    setSaving(true); setMessage(undefined);
    const response = await fetch("/api/agent/business-info", {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessInfo: info })
    });
    setSaving(false);
    if (!response.ok) { setMessage(await responseError(response)); return; }
    const body = (await response.json()) as { data: { businessInfo: BusinessInfo } };
    setInfo(body.data.businessInfo);
    setMessage("Saved. New calls use these details straight away (within a minute).");
  }

  return (
    <section className="rounded-xl border p-5">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold">Business details</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The receptionist only answers from these details, services, prices and hours. Anything else, it takes a message.
          </p>
        </div>
        <Button onClick={save} disabled={disabled || saving}>{saving ? "Saving…" : "Save details"}</Button>
      </div>
      {message ? <p role="status" className="mb-4 rounded-lg border bg-muted/20 px-4 py-3 text-sm">{message}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Receptionist name"><input value={info.receptionistName} onChange={(e) => patch({ receptionistName: e.target.value })} placeholder="Riya" maxLength={40} className={inputClass} /></Field>
        <Field label="Receptionist voice" hint="Keeps grammar (e.g. Hindi sakti/sakta) consistent.">
          <select value={info.receptionistGender} onChange={(e) => patch({ receptionistGender: e.target.value as BusinessInfo["receptionistGender"] })} className={inputClass}>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
        </Field>
        <Field label="Email"><input value={info.email} onChange={(e) => patch({ email: e.target.value })} placeholder="enquiry@example.com" maxLength={120} className={inputClass} /></Field>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Field label="About the business" hint="Two or three sentences the receptionist can say.">
          <textarea value={info.about} onChange={(e) => patch({ about: e.target.value })} maxLength={600} className={areaClass} />
        </Field>
        <Field label="Never discuss" hint="Topics to decline and take a message instead, e.g. visa eligibility, timelines, legal advice.">
          <textarea value={info.outOfScope} onChange={(e) => patch({ outOfScope: e.target.value })} maxLength={400} className={areaClass} />
        </Field>
      </div>
      <div className="mt-4"><Field label="Website"><input value={info.website} onChange={(e) => patch({ website: e.target.value })} maxLength={200} className={inputClass} /></Field></div>

      <div className="mt-6 flex items-center justify-between">
        <h3 className="font-semibold">Offices</h3>
        <Button variant="outline" type="button" disabled={info.offices.length >= 10} onClick={() => patch({ offices: [...info.offices, { name: "", address: "", phone: "", notes: "" }] })}>Add office</Button>
      </div>
      <div className="mt-3 space-y-3">
        {info.offices.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No offices yet.</p> : null}
        {info.offices.map((office, index) => (
          <div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_2fr_1fr_1.4fr_auto]">
            <input aria-label="Office name" value={office.name} onChange={(e) => patchOffice(index, { name: e.target.value })} placeholder="Name, e.g. Carnegie" className={inputClass} />
            <input aria-label="Office address" value={office.address} onChange={(e) => patchOffice(index, { address: e.target.value })} placeholder="Address" className={inputClass} />
            <input aria-label="Office phone" value={office.phone} onChange={(e) => patchOffice(index, { phone: e.target.value })} placeholder="Phone" className={inputClass} />
            <input aria-label="Office notes" value={office.notes} onChange={(e) => patchOffice(index, { notes: e.target.value })} placeholder="Notes, e.g. parking at rear" className={inputClass} />
            <Button variant="outline" type="button" onClick={() => patch({ offices: info.offices.filter((_, i) => i !== index) })}>Remove</Button>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between">
        <h3 className="font-semibold">Common questions</h3>
        <Button variant="outline" type="button" disabled={info.faqs.length >= 40} onClick={() => patch({ faqs: [...info.faqs, { question: "", answer: "" }] })}>Add question</Button>
      </div>
      <div className="mt-3 space-y-3">
        {info.faqs.length === 0 ? <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">No questions yet.</p> : null}
        {info.faqs.map((faq, index) => (
          <div key={index} className="grid gap-3 rounded-lg border p-3 md:grid-cols-[1fr_2fr_auto]">
            <input aria-label="Question" value={faq.question} onChange={(e) => patchFaq(index, { question: e.target.value })} placeholder="Question" maxLength={200} className={inputClass} />
            <input aria-label="Answer" value={faq.answer} onChange={(e) => patchFaq(index, { answer: e.target.value })} placeholder="Short spoken answer" maxLength={500} className={inputClass} />
            <Button variant="outline" type="button" onClick={() => patch({ faqs: info.faqs.filter((_, i) => i !== index) })}>Remove</Button>
          </div>
        ))}
      </div>
    </section>
  );
}
