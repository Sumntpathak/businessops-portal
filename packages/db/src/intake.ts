export const DEFAULT_INTAKE_FIELDS = [
  { key: "service_interest", label: "Service interest", type: "text" as const, options: [], priority: "key" as const, sort: 10, active: true },
  { key: "target_date", label: "Target date", type: "text" as const, options: [], priority: "key" as const, sort: 20, active: true },
  { key: "preferred_language", label: "Preferred language", type: "text" as const, options: [], priority: "optional" as const, sort: 30, active: true },
  { key: "how_heard", label: "How they heard about us", type: "text" as const, options: [], priority: "optional" as const, sort: 40, active: true }
] as const;
