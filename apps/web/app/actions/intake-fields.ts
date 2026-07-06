"use server";

import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { schema, withTenant } from "@recepto/db";
import { requireTenant } from "@/lib/auth-helpers";
import { db } from "@/lib/db";
import {
  canManageIntakeFields,
  intakeFieldMutationSchema,
  normalizeSelectOptions,
  slugifyIntakeKey
} from "@/lib/intake-fields";

const idSchema = z.string().uuid();
const orderSchema = z.array(z.string().uuid()).max(100);

async function ownerContext() {
  const context = await requireTenant();
  if (!canManageIntakeFields(context.tenant.role)) {
    throw new Error("Owner access required");
  }
  return context;
}

function mutationFrom(formData: FormData) {
  const parsed = intakeFieldMutationSchema.parse({
    id: formData.get("id") || undefined,
    label: formData.get("label"),
    type: formData.get("type"),
    options: formData.get("options") ?? "",
    priority: formData.get("priority")
  });
  const options = parsed.type === "select" ? normalizeSelectOptions(parsed.options) : [];
  if (parsed.type === "select" && options.length === 0) {
    throw new Error("Select fields require at least one option");
  }
  return { ...parsed, options };
}

async function assertActiveCapacity(tenantId: string) {
  const scoped = withTenant(db, tenantId);
  const [row] = await db
    .select({ value: count() })
    .from(schema.intakeFields)
    .where(scoped.where(schema.intakeFields, eq(schema.intakeFields.active, true)));
  if ((row?.value ?? 0) >= 25) throw new Error("Active intake field limit reached");
}

function refresh() {
  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/callers");
}

export async function createIntakeField(formData: FormData) {
  const context = await ownerContext();
  const values = mutationFrom(formData);
  await assertActiveCapacity(context.tenantId);
  const scoped = withTenant(db, context.tenantId);
  const [last] = await db
    .select({ sort: schema.intakeFields.sort })
    .from(schema.intakeFields)
    .where(scoped.where(schema.intakeFields))
    .orderBy(desc(schema.intakeFields.sort))
    .limit(1);

  await db.insert(schema.intakeFields).values(
    scoped.values({
      key: slugifyIntakeKey(values.label),
      label: values.label,
      type: values.type,
      options: values.options,
      priority: values.priority,
      sort: (last?.sort ?? 0) + 10,
      active: true
    })
  );
  refresh();
}

export async function updateIntakeField(formData: FormData) {
  const context = await ownerContext();
  const values = mutationFrom(formData);
  const id = idSchema.parse(values.id);
  const scoped = withTenant(db, context.tenantId);
  await db
    .update(schema.intakeFields)
    .set({
      label: values.label,
      type: values.type,
      options: values.options,
      priority: values.priority,
      updatedAt: new Date()
    })
    .where(scoped.where(schema.intakeFields, eq(schema.intakeFields.id, id)));
  refresh();
}

export async function toggleIntakeField(formData: FormData) {
  const context = await ownerContext();
  const id = idSchema.parse(formData.get("id"));
  const active = z.enum(["true", "false"]).parse(formData.get("active")) === "true";
  if (active) await assertActiveCapacity(context.tenantId);
  const scoped = withTenant(db, context.tenantId);
  await db
    .update(schema.intakeFields)
    .set({ active, updatedAt: new Date() })
    .where(scoped.where(schema.intakeFields, eq(schema.intakeFields.id, id)));
  refresh();
}

export async function reorderIntakeFields(formData: FormData) {
  const context = await ownerContext();
  const ids = orderSchema.parse(JSON.parse(String(formData.get("order") ?? "[]")));
  if (ids.length === 0) return;
  const scoped = withTenant(db, context.tenantId);
  const owned = await db
    .select({ id: schema.intakeFields.id })
    .from(schema.intakeFields)
    .where(scoped.where(schema.intakeFields, inArray(schema.intakeFields.id, ids)));
  if (owned.length !== ids.length) throw new Error("Invalid intake field order");

  await db.transaction(async (tx) => {
    const transactionScope = withTenant(tx, context.tenantId);
    for (const [index, id] of ids.entries()) {
      await tx
        .update(schema.intakeFields)
        .set({ sort: (index + 1) * 10, updatedAt: new Date() })
        .where(transactionScope.where(schema.intakeFields, eq(schema.intakeFields.id, id)));
    }
  });
  refresh();
}
