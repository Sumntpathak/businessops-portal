# Gemini Prompt — Recepto dashboard UI fixes (CSS/Tailwind only)

Copy everything below this line into Gemini.

---

You are fixing UI layout issues in a Next.js 14 (App Router) + Tailwind + shadcn/ui dashboard, dark theme. Work ONLY inside `apps/web/`. There is a stray duplicate Next app at the repo root (`src/`, `next.config.ts`) — DO NOT touch it.

## HARD CONSTRAINTS
1. Tailwind className changes and small wrapper `<div>`s only. No new dependencies, no logic changes, no route changes, no component API changes, no state management.
2. One exception allowed: adding `usePathname()` to the sidebar for active-link highlighting (requires `"use client"` at the top of `sidebar.tsx`). Nothing else non-CSS.
3. Dark theme stays default. Do not restyle colors globally — only spacing, layout, overflow, borders, and the sidebar look.
4. After changes, `pnpm --filter @recepto/web build` must pass with zero errors.

## PROBLEM 1 — the main bug: page scroll drags the sidebar with it
`apps/web/app/dashboard/layout.tsx` currently renders:

```tsx
<div className="flex min-h-screen">
  <Sidebar />
  <div className="min-w-0 flex-1">
    <Topbar ... />
    <CalendarWarning ... />
    <main className="p-5 sm:p-8">{children}</main>
  </div>
</div>
```

With `min-h-screen` the document itself scrolls, so on data-heavy pages (Calls, Bookings) the sidebar scrolls out of view. Fix by making the shell a fixed-height app frame with independent scroll areas:

```tsx
<div className="flex h-dvh overflow-hidden">
  <Sidebar />                                      {/* own scroll, never moves */}
  <div className="flex min-w-0 flex-1 flex-col">
    <Topbar ... />                                 {/* fixed at top of column */}
    <CalendarWarning ... />
    <main className="flex-1 overflow-y-auto p-5 sm:p-8">{children}</main>
  </div>
</div>
```

Inside `Sidebar` (`apps/web/components/dashboard/sidebar.tsx`), make the `<aside>` a full-height flex column: keep the logo row fixed and let only the nav area scroll if it ever overflows: `<aside className="... flex h-full flex-col">`, nav gets `flex-1 overflow-y-auto`.

Check `Topbar` doesn't rely on `sticky top-0` against document scroll — in the new frame it sits naturally; remove any `sticky` if present.

## PROBLEM 2 — sidebar should feel like the Claude desktop app sidebar
Reference: dark charcoal panel, subtle 1px right border, compact nav items with icon + label, rounded-lg hover fill, clearly highlighted active item, generous but tight vertical rhythm. Apply to `sidebar.tsx`:

- Panel: `bg-background` (or `bg-muted/20`), `border-r border-border/60`, width stays `w-64`.
- Nav items: `rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors`.
- Active item (via `usePathname()`; exact match for `/dashboard`, `startsWith` for the rest): `bg-muted text-foreground`.
- Logo row: keep, but soften: `text-xs font-semibold tracking-[0.25em] text-muted-foreground`.
- Icons: `h-4 w-4 shrink-0`.

## PROBLEM 3 — data-heavy pages overflow badly
For every page under `apps/web/app/dashboard/**` that renders a table or long list (Calls list, call transcript detail, Bookings list/calendar):

- Wrap wide tables in `<div className="overflow-x-auto rounded-lg border">` so they scroll horizontally inside their card instead of stretching the page.
- Give the transcript timeline on the call detail page its own max height only if it already has one — otherwise leave vertical growth to the main scroll area (that's now correct after Problem 1).
- Ensure every flex child that holds a table/grid has `min-w-0` so it can shrink (missing `min-w-0` is the usual cause of layout blowout).
- Sticky table headers where tables are tall: `[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:bg-background` on the wrapper, or `sticky top-0 bg-background` on the `<th>` row — only if the table sits inside its own `overflow-y-auto` container.

## PROBLEM 4 — consistency pass (light touch)
- Same page padding everywhere: `p-5 sm:p-8` from the layout; remove per-page duplicate outer padding so nothing is double-padded.
- Page titles consistent: `text-lg font-semibold tracking-tight` + `text-sm text-muted-foreground` subtitle.
- Cards: consistent `rounded-xl border bg-card` and `p-4 sm:p-6`.
- No horizontal scrollbar on the document at any viewport ≥ 768px. Mobile (< md): sidebar stays hidden as today — do not build a drawer.

## DELIVERABLE
Changed files only, with a one-line note per file saying what changed. Then run `pnpm --filter @recepto/web build` and confirm it passes.
