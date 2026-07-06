"use client";

import {
  createIntakeField,
  reorderIntakeFields,
  toggleIntakeField,
  updateIntakeField
} from "@/app/actions/intake-fields";

type IntakeField = {
  id: string;
  key: string;
  label: string;
  type: "text" | "select" | "boolean" | "number";
  options: string[];
  priority: "key" | "optional";
  active: boolean;
};

function FieldInputs({ field }: { field?: IntakeField }) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {field && <input type="hidden" name="id" value={field.id} />}
      <label className="text-sm">
        Label
        <input name="label" required maxLength={80} defaultValue={field?.label} className="mt-1 h-10 w-full rounded-md border bg-background px-3" />
      </label>
      <label className="text-sm">
        Type
        <select name="type" defaultValue={field?.type ?? "text"} className="mt-1 h-10 w-full rounded-md border bg-background px-3">
          <option value="text">Text</option>
          <option value="select">Select</option>
          <option value="boolean">Yes / no</option>
          <option value="number">Number</option>
        </select>
      </label>
      <label className="text-sm">
        Priority
        <select name="priority" defaultValue={field?.priority ?? "optional"} className="mt-1 h-10 w-full rounded-md border bg-background px-3">
          <option value="key">Key</option>
          <option value="optional">Optional</option>
        </select>
      </label>
      <label className="text-sm">
        Select options
        <input name="options" defaultValue={field?.options.join(", ")} placeholder="Student, Partner" className="mt-1 h-10 w-full rounded-md border bg-background px-3" />
      </label>
    </div>
  );
}

export function IntakeFieldsSettings({
  fields,
  canEdit
}: {
  fields: IntakeField[];
  canEdit: boolean;
}) {
  const moveOrder = (index: number, direction: -1 | 1) => {
    const ids = fields.map((field) => field.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return JSON.stringify(ids);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    return JSON.stringify(ids);
  };

  return (
    <section className="rounded-xl border">
      <div className="border-b p-5">
        <h2 className="font-semibold">Caller intake fields</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          The receptionist captures these details naturally during calls. Up to 25 fields may be active.
        </p>
      </div>

      <div className="divide-y">
        {fields.map((field, index) => (
          <div key={field.id} className="p-5">
            {canEdit ? (
              <details>
                <summary className="cursor-pointer list-none">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{field.label}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {field.key} ? {field.type} ? {field.priority} ? {field.active ? "active" : "inactive"}
                      </p>
                    </div>
                    <span className="text-sm text-muted-foreground">Edit</span>
                  </div>
                </summary>
                <form action={updateIntakeField} className="mt-5 space-y-4">
                  <FieldInputs field={field} />
                  <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background">Save field</button>
                </form>
                <div className="mt-4 flex flex-wrap gap-2">
                  <form action={reorderIntakeFields}>
                    <input type="hidden" name="order" value={moveOrder(index, -1)} />
                    <button disabled={index === 0} className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40">Move up</button>
                  </form>
                  <form action={reorderIntakeFields}>
                    <input type="hidden" name="order" value={moveOrder(index, 1)} />
                    <button disabled={index === fields.length - 1} className="rounded-md border px-3 py-1.5 text-sm disabled:opacity-40">Move down</button>
                  </form>
                  <form action={toggleIntakeField}>
                    <input type="hidden" name="id" value={field.id} />
                    <input type="hidden" name="active" value={field.active ? "false" : "true"} />
                    <button className="rounded-md border px-3 py-1.5 text-sm">{field.active ? "Deactivate" : "Activate"}</button>
                  </form>
                </div>
              </details>
            ) : (
              <div>
                <p className="font-medium">{field.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {field.key} ? {field.type} ? {field.priority} ? {field.active ? "active" : "inactive"}
                </p>
              </div>
            )}
          </div>
        ))}
        {fields.length === 0 && <p className="p-5 text-sm text-muted-foreground">No intake fields configured.</p>}
      </div>

      {canEdit && (
        <form action={createIntakeField} className="space-y-4 border-t p-5">
          <h3 className="font-medium">Add field</h3>
          <FieldInputs />
          <button className="rounded-md bg-foreground px-4 py-2 text-sm text-background">Add field</button>
        </form>
      )}
    </section>
  );
}
