# Project Structure

This codebase uses a feature-first Next.js layout.

```text
src/
  app/                 Next.js routes, layouts, and route handlers only
  features/            Business domains grouped by product area
    auth/
    leads/
    follow-ups/
    users/
  server/              Backend-only infrastructure
    audit/
    auth/
    db/
    http/
  shared/              Reusable UI, layout, hooks, constants, and utilities
```

## Naming

- Use singular domain names inside files: `lead.service.ts`, `lead.repository.ts`, `lead.handlers.ts`.
- Use kebab-case for multi-word folders and files: `follow-ups`, `follow-up.service.ts`.
- Keep `src/app` thin; route files should import handlers from `features/*/server`.
- Keep database, cookies, JWT, audit, and HTTP helpers under `src/server`.
- Keep reusable components under `src/shared/ui` and feature components under `src/features/<feature>/components`.

## Boundaries

- Feature code can import from `src/server` and `src/shared`.
- Shared code should not import feature code.
- Client components should not import `src/server/*`.
- Route handlers should stay small and delegate to feature handlers.
