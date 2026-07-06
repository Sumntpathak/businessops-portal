-- Idempotent data migration: give every existing tenant a useful starter schema.
INSERT INTO "intake_fields" ("tenant_id", "key", "label", "type", "options", "priority", "sort", "active")
SELECT
  tenant."id",
  defaults."key",
  defaults."label",
  defaults."type"::"intake_field_type",
  '[]'::jsonb,
  defaults."priority"::"intake_field_priority",
  defaults."sort",
  true
FROM "tenants" AS tenant
CROSS JOIN (
  VALUES
    ('service_interest', 'Service interest', 'text', 'key', 10),
    ('target_date', 'Target date', 'text', 'key', 20),
    ('preferred_language', 'Preferred language', 'text', 'optional', 30),
    ('how_heard', 'How they heard about us', 'text', 'optional', 40)
) AS defaults("key", "label", "type", "priority", "sort")
ON CONFLICT ("tenant_id", "key") DO NOTHING;