# Day Plan View (S-03) — Plan Brief

> Full plan: `context/changes/day-plan-view/plan.md`

## What & Why

Roadmap slice **S-03**, the north star. After signing in, an owner or worker sees every appointment for
a chosen day with its status in one view, and taps a visit to see its details (PRD **FR-006**, **FR-008**).
This is where the loop `setup → add appointment → day plan view` closes end-to-end for the first time —
until it lands, S-02's bookings are only visible in Supabase Studio.

## Starting Point

S-02 shipped the whole data layer and left the seat warm: `src/pages/dashboard.astro:32` literally reads
*"Plan dnia pojawi się tutaj (S-03)"*, and `AppShell.astro:28` already points the `Dzisiaj` nav item at
`/dashboard`. Both roles can already SELECT appointments under RLS. What does not exist: any day-scoped
query, any status label or colour in `src/`, any date navigation anywhere in the repo, and any dynamic
Astro page.

## Desired End State

`/dashboard` is the day plan: a date header with `‹ / Dzisiaj / ›`, four stat tiles, five status filter
pills, and one time-on-the-left card per appointment carrying customer, service, bay and a colour-coded
status pill. Tapping a card opens `/wizyty/<id>` with the visit's details. Empty days and closed days say
so. A worker sees all of it except the "Nowa wizyta" CTA and the booking form behind it.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
| --- | --- | --- | --- |
| Layout: grid vs list | Brochure list (`TodayScreen`) | `design-system.md` is `status: locked` with near-1:1 authority and `lessons.md:26` makes that binding; the grid-shaped brochure screen is the unmapped `WeekScreen`, and per-bay filtering is already Parked | Plan |
| Detail surface | Server-rendered route `/wizyty/[id]` | Linkable, back-button-correct, zero client JS, and an obvious place for S-04 to drop the status control | Plan |
| Day navigation | `?data=YYYY-MM-DD`, SSR, plain links | Matches the server-fetch-then-island pattern both shipped pages use, keeps first paint complete for the 2-second NFR, and makes any day linkable | Plan |
| Freshness | None in S-03 | This slice mutates nothing, so it creates no staleness; the NFR's "2 seconds from a status change" is about the device making the change, which is S-04's | Plan |
| Stat tiles | Four status counts, no "Wolne okna" | The free-window tile needs a day-scoped calculation that does not exist — `suggestSlotsForService()` is service-specific and only looks forward from now | Plan |
| `notes` column | Not added | FR-008 defines details as "podgląd, nie formularz"; a column no screen writes to is dead schema plus a migration for nothing | Plan |
| Filters | React island, client-side | Instant with no round-trip, and it hands S-04 the component that already owns the row state it needs to mutate | Plan |
| Worker access | Split the guard table | `/wizyty` → `any`, `/wizyty/nowa` → `owner`; longest-prefix matching already resolves this, and it keeps every rule in the one auditable table | Plan |
| Sort order (roadmap unknown) | `starts_at` asc, bay name tie-break | Matches the ordering `slot-suggestions.ts:82` already establishes | Plan |
| `cancelled` appointments | Excluded from the board entirely | The brochure has no *Anulowane* pill (`App.jsx:316`) and nothing in the product can produce the status yet — S-02 writes only `waiting`, S-04 stops at `no_show` | Plan review |
| Where the queries live | Added to the existing `appointments.ts`, pure logic in `day-plan.ts` | Mirrors the `slot-suggestions.ts` / `appointments.ts` split AGENTS.md names as the precedent for testable logic | Plan review |

## Scope

**In scope:** day-scoped query + pure sort/count/filter with Vitest coverage; a status label/colour
module and `StatusPill` (both built for S-04 to reuse); naive-date helpers moved into `workshop-clock.ts`
(and retired from `NewAppointmentForm.tsx`); the `/dashboard` day plan screen; the `/wizyty/[id]` detail
page plus the repo's first `404.astro`; the auth-guard split with tests; docs and roadmap correction.

**Out of scope:** any schema change or migration; status changes and transitions (S-04); auto-refresh,
polling or Realtime; the bays × time grid and per-bay filter (Parked); the "Wolne okna" tile; car, notes
and customer history on the detail page (S-05/S-06); weekly or calendar view; editing or cancelling a
visit; any date picker; any new dependency or shadcn component.

## Architecture / Approach

Server-first page, presentational island. `/dashboard` resolves `?data=` (falling back to the workshop's
today), fetches exactly that day in one joined query, and hands sorted rows to a `DayPlanBoard` island
that holds a single piece of state — the active filter. Day navigation stays plain `<a>` links.
Everything order- and count-shaped lives in a pure, dependency-free module, the same split
`slot-suggestions.ts` uses beneath `appointments.ts`, so it is unit-testable without a database.

```
/dashboard?data=YYYY-MM-DD (Astro SSR)
   resolveDayParam() → getDayPlan()   ── one join query, RLS-scoped
        ▼
   DayPlanBoard (island: filter state only)
        ├─ header + ‹ Dzisiaj › links      ├─ 4 tiles ← countByStatus()  ┐ pure,
        └─ cards ← sortDayPlan()           └─ 5 pills ← filterByStatus() ┘ tested
                 │
                 ▼  /wizyty/[id] (Astro SSR, no island)
```

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Day-plan data layer | Day query, pure sort/count/filter, status mapping, clock helpers, tests | Naive-date arithmetic via `new Date(str)` reintroduces the exact timezone bug `workshop-clock.ts:9-13` exists to prevent |
| 2. Day plan screen | The `TodayScreen` replica on `/dashboard` | Drifting from the brochure instead of replicating it — the failure `lessons.md:26` already records |
| 3. Detail route & guard | `/wizyty/[id]`, `404.astro`, auth-guard split, guard tests | Widening `/wizyty` without adding the `/wizyty/nowa` entry silently opens booking to workers |
| 4. Ship | Docs, roadmap correction, merge | Leaving stale `/wizyty` access docs behind — the `lessons.md:12` failure mode |

**Prerequisites:** S-02 done (satisfied); local Supabase stack running with at least one booked
appointment; the brochure repo (already at `~/Code/wulkanizator-go-brochure`); a worker account for the
Phase 3 access checks.

**Estimated effort:** ~2–3 sessions across 4 phases. Phase 2 carries most of the work; 1 and 3 are small,
and 4 is process.

## Open Risks & Assumptions

- **The roadmap's S-03 line promises a grid this slice does not build.** Deliberate and resolved in
  favour of the locked design reference; Phase 4 rewrites the line rather than leaving it half-true.
- **The detail page is thinner than the brochure screen.** No car, no notes, no history — none of it is
  in the schema, and `book_appointment()` creates a fresh customer row per booking, so history cannot
  exist until S-05 adds dedupe.
- **No freshness mechanism ships.** An owner's tablet left open all morning shows a stale board. S-04
  inherits the whole problem at once, and will need the client-fetch path this slice declined.
- **Assumption: a workshop day holds tens of appointments, not hundreds.** Counting and sorting happen in
  memory; the PRD's 1–5 bay persona supports this, but it is an assumption, not a constraint.
- **This is the first dynamic Astro page in the repo**, and the first `404.astro` — verified that
  without the latter a missing visit renders a genuinely blank body, which is why the plan adds it.

## Success Criteria (Summary)

- An appointment booked at `/wizyty/nowa` is immediately visible on `/dashboard` at the right time with
  the right status — the north-star loop closes.
- The board is readable at a glance on a 360px phone and on a tablet, and every status renders the exact
  colour locked in `design-system.md:82-88`.
- A worker can see the day plan and open a visit, but cannot reach the booking form.
