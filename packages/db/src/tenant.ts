import { and, eq, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

type TenantScopedTable = {
  tenantId: PgColumn;
};

/**
 * Binds a database handle to one trusted tenant ID and builds tenant-safe predicates and insert values.
 */
export function withTenant<TDatabase>(db: TDatabase, tenantId: string) {
  if (!tenantId.trim()) {
    throw new Error("withTenant requires a non-empty tenantId");
  }

  return {
    db,
    tenantId,
    where<TTable extends TenantScopedTable>(table: TTable, condition?: SQL): SQL {
      const tenantCondition = eq(table.tenantId, tenantId);
      return condition ? and(tenantCondition, condition)! : tenantCondition;
    },
    values<TValues extends Record<string, unknown>>(
      values: TValues
    ): TValues & { tenantId: string } {
      return { ...values, tenantId };
    }
  };
}
