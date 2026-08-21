# Day Plan View (S-03) Implementation Plan

## Overview

Roadmap slice **S-03**, the north star: after logging in, an owner or worker lands on the day plan and
sees every appointment for a chosen day with its status in one view, and can tap a visit to see its
details. This is the slice where the loop `setup → add appointment → day plan view` closes end-to-end
for the first time.

It covers PRD **FR-006** (one view, all appointments, all statuses) and **FR-008** (details on entering
a visit). It is entirely read-path: **no migration, no schema change, no new table, no new grant**.
Everything it renders was already shipped by S-02.

## Current State Analysis

**The data layer is finished.** `appointments` (`supabase/migrations/20260821090000_appointments_and_customers.sql:35-46`)
carries `workshop_id`, `customer_id`, `service_id`, `bay_id`, naive `starts_at` / `ends_at`, and a
five-value `public.appointment_status` enum (`:21`) whose literals are English snake_case:
`waiting`, `in_progress`, `done`, `no_show`, `cancelled`. RLS lets **both roles** SELECT within their
workshop (`:85-88`), and `UPDATE` is already column-narrowed to `status` alone
(`20260821151500_appointments_update_status_only.sql:10-11`) — S-04's database work is done in advance.

**The destination is reserved.** `src/pages/dashboard.astro:32` says verbatim
*"Plan dnia pojawi się tutaj (S-03)"*, and `src/layouts/AppShell.astro:28` already routes the
`Dzisiaj` nav item to `/dashboard`. The CTA to `/wizyty/nowa` is already owner-gated at
`dashboard.astro:17`.

**What is missing:**

- No day-scoped appointment query. `suggestSlotsForService()` (`src/lib/services/appointments.ts:133`)
  is service-specific and only looks forward from *now* across a 14-day horizon — it cannot answer
  "what is on the board for this date".
- No status presentation layer. The Polish labels and Tailwind classes exist only as a table in
  `context/foundation/design-system.md:82-88`; nothing in `src/` renders a status.
- No date navigation of any kind. A repo-wide grep for `searchParams` / `Astro.url` hits only the two
  auth pages' `?error` handling (`src/pages/auth/signin.astro:5`, `signup.astro:5`).
- No dynamic Astro page anywhere — `[id].ts` exists only as API routes (`src/pages/api/bays/[id].ts`).
- `workshopTodayDateString()` is private inside `src/components/appointments/NewAppointmentForm.tsx:53-56`,
  duplicating logic the day plan needs on both server and client.

**Constraint discovered — the detail view outruns the schema.** The brochure's `VisitDetailScreen`
shows a car, workshop notes, and customer history. None exist: `customers` is `first_name` + `phone`
only (`20260821090000_...sql:25-31`), `appointments` has no `notes` column, and `book_appointment()`
inserts a **new** customer row per booking with no dedupe
(`20260821150000_book_appointment_ownership_check.sql:49-51`) — so there is no history to show. The
detail page renders what exists and nothing more.

**Conflict resolved.** `context/foundation/roadmap.md:126` describes S-03 as *"a bays × time grid"*.
The locked design reference (`design-system.md`, `status: locked`, `authority: primary UI/UX reference — near-1:1`)
maps S-03 to `TodayScreen` (`brochure src/App.jsx:293`), which is a **chronological list**. The list
wins: `lessons.md:26` makes brochure fidelity a standing rule, the grid-shaped brochure screen is
`WeekScreen` (explicitly unmapped to any MVP slice), and "per-bay filter on the day plan" sits in the
roadmap's **Parked** section. Phase 4 corrects the roadmap line.

## Desired End State

An owner or worker signs in, lands on `/dashboard`, and sees the workshop's day: a header naming the
date with `‹ / Dzisiaj / ›` navigation, four stat tiles, five status filter pills, and a
time-on-the-left card per appointment carrying customer, service, bay and a colour-coded status pill.
Tapping a card opens `/wizyty/<id>` with the visit's full detail. Days with no appointments, and days
the workshop is closed, say so rather than rendering an empty list.

Verify by: booking a visit at `/wizyty/nowa`, seeing it appear on `/dashboard` at the right time with
status *Oczekuje*, navigating to the next day and back, filtering to *Oczekuje* and to *Gotowe*, and
opening the visit's detail page. A worker account can do all of that except reach `/wizyty/nowa`.

### Key Discoveries:

- Both roles may already SELECT appointments — `20260821090000_appointments_and_customers.sql:85-88`.
  No RLS work in this slice.
- `UPDATE` is already narrowed to the `status` column with no role gate — `20260821151500_appointments_update_status_only.sql:10-11`.
- `src/pages/dashboard.astro:32` is a placeholder explicitly reserved for this slice.
- Server-props-then-island is the established pattern: `src/pages/ustawienia.astro:8,14` and
  `src/pages/wizyty/nowa.astro:8,14` both server-fetch and pass props into a `client:load` island.
  Islands never fetch their own initial data.
- `src/lib/workshop-clock.ts` is the only module permitted to touch timezones (`AGENTS.md`), exposes
  `getWorkshopNow()` (`:33`), `naiveDateToTimestampString()` (`:49`), `timestampStringToNaiveDate()` (`:60`),
  and deliberately omits local→instant conversion (`:9-13`).
- On any naive `Date`, only `getUTC*` accessors are correct — `workshop-clock.ts:28-32`, `AGENTS.md`.
- `auth-guard.ts:23-30` resolves by longest matching prefix, so `/wizyty` and `/wizyty/nowa` can carry
  different access levels in the same table.
- Only one shadcn component is installed (`src/components/ui/button.tsx`); every shipped feature
  component hand-rolls `<button className="rounded-xl …">`. No `dialog`, `card`, or `badge` exists.
- Slot ordering precedent — start ascending, then bay name — `src/lib/services/slot-suggestions.ts:82`.
- Weekday labelling precedent in Polish, keyed by Postgres `dow` — `src/components/settings/WorkingHours.tsx:17-27`.
- The only JS test file in the repo is `src/lib/services/slot-suggestions.test.ts`; Vitest is wired
  (`npm test`).

## What We're NOT Doing

- **No status changes.** No buttons, no transitions, no `PATCH` route. That is S-04, which already has
  its DB grant.
- **No schema change.** No migration, no `notes` column, no `db:types` regeneration.
- **No bays × time grid** and no per-bay filter (roadmap **Parked**).
- **No auto-refresh** — no polling, no Supabase Realtime (`tech-stack.md:17` records `has_realtime: false`).
  Freshness lands with S-04, the slice that actually mutates.
- **No "Wolne okna" stat tile** — it needs a day-scoped free-window calculation that does not exist.
- **No car, plate, notes, or customer history** on the detail page — none of it is in the schema.
- **No weekly or calendar view**; the `Kalendarz` nav item stays disabled.
- **No editing or cancelling** an appointment.
- **No date picker** — day navigation is previous / today / next only.
- **No new runtime dependency** and no new shadcn component.

## Implementation Approach

The page is server-first and the island is presentational. `/dashboard` resolves the requested date
from `?data=YYYY-MM-DD` (falling back to the workshop's today), server-fetches exactly that day's
appointments with their customer, service and bay joined in one query, and hands the shaped rows to a
`DayPlan` island. The island owns only what needs interactivity: the active status filter. Day
navigation stays as plain `<a>` links, so the browser's back button and the 2-second first-paint NFR
both work for free.

Everything order- and count-shaped is pulled into a **pure, dependency-free module** — the same split
`slot-suggestions.ts` uses against `appointments.ts` — so sorting, the four tile counts, and filtering
are unit-testable without a database.

Two artifacts exist specifically so S-04 inherits them: `src/lib/appointment-status.ts` (the single
mapping from enum literal → Polish label → Tailwind classes) and the `StatusPill` component.

```
/dashboard?data=YYYY-MM-DD (Astro, SSR)
      │  resolveDayParam()  → naive date string
      │  getDayPlan(supabase, date)  ── one join query, RLS-scoped
      ▼
   DayPlanBoard (React island, client:load)
      ├─ day header + ‹ Dzisiaj › links (plain <a>, ?data=)
      ├─ 4 stat tiles      ← countByStatus()   ┐ pure,
      ├─ 5 filter pills    ← local useState    │ Vitest-
      └─ appointment cards ← sortDayPlan()     ┘ covered
              │ each card links to
              ▼
     /wizyty/[id] (Astro, SSR, no island)
```

## Critical Implementation Details

**Naive-date arithmetic.** Day navigation adds and subtracts days from a naive `YYYY-MM-DD` string.
Doing this with `new Date(str)` parses as UTC midnight and then reads back through the runtime's zone —
the exact bug class `workshop-clock.ts:9-13` exists to prevent. All date arithmetic goes into
`workshop-clock.ts` and operates on `Date.UTC` fields only.

**Day-boundary query bounds.** A day is the half-open range `[date 00:00:00, date+1 00:00:00)`, matching
the `'[)'` bound the exclusion constraint already uses (`20260821090000_...sql:60`). Using `<=` on the
upper bound pulls a midnight-starting appointment onto both days.

**Guard ordering.** `auth-guard.ts:23-30` picks the *longest* matching prefix, so `["/wizyty", "any"]`
and `["/wizyty/nowa", "owner"]` coexist correctly — but the table currently holds only `["/wizyty", "owner"]`.
Widening it without simultaneously adding the `/wizyty/nowa` entry silently opens booking to workers.
Phase 3 adds both in one edit and proves it with a test.

## Phase 1: Day-plan data layer

### Overview

Everything the screen needs, with no screen: a day-scoped query, the pure sort/count/filter functions,
the status presentation mapping, and the clock helpers day navigation depends on. Ends with `npm test`
green and no UI touched.

### Changes Required:

#### 1. Clock helpers for naive dates

**File**: `src/lib/workshop-clock.ts`

**Intent**: Give the rest of the system the two naive-date operations the day plan needs — "what is
today in the workshop, as `YYYY-MM-DD`" and "shift a `YYYY-MM-DD` by N days" — so no caller is tempted
to reach for `new Date(str)` or a local-field accessor. `workshopTodayDateString()` currently lives
privately in `NewAppointmentForm.tsx:53-56`; this becomes its home.

**Contract**: Two new exports alongside the existing four. `workshopTodayDateString(now?: Date): string`
returning `YYYY-MM-DD` built from `getWorkshopNow()`'s `getUTC*` fields. `shiftDateString(date: string, days: number): string`
doing the same, via `Date.UTC` arithmetic only. Both must reject/avoid local-field accessors — the
module doc at `:1-13` states the invariant they preserve.

#### 2. Retire the component's private copy

**File**: `src/components/appointments/NewAppointmentForm.tsx`

**Intent**: Complete the move begun in item 1. Extracting the helper without deleting its original
leaves two copies free to diverge — the failure `lessons.md:12` records.

**Contract**: Delete the private `workshopTodayDateString` (`:53-56`) and import it from
`@/lib/workshop-clock` instead; the existing `getWorkshopNow` import (`:16`) becomes unnecessary if it
has no other use in the file. Delete the private `pad2` helper too if nothing else in the file calls it.
Behaviour must not change: `today` at `:73` still resolves to the workshop-local date, and the
slot-chip date suffix at `:222` still compares against it.

#### 3. Status presentation mapping

**File**: `src/lib/appointment-status.ts` (new)

**Intent**: One place that turns an `AppointmentStatus` enum literal into the Polish label and the
Tailwind classes locked in `design-system.md:82-88`. S-04 renders the same statuses on its buttons, so
this must not live inside a component.

**Contract**: Exports a record keyed by every `AppointmentStatus` value giving `{ label, pillClasses }`,
plus a `DAY_PLAN_FILTER_STATUSES` display order holding exactly the four the board filters on —
`waiting`, `in_progress`, `done`, `no_show`. `cancelled` keeps its label and classes (S-04 or a later
cancel feature will need them) but is deliberately absent from that list; see item 4 for why the board
never shows a cancelled row. Labels and classes copied verbatim from
`design-system.md:82-88` — `waiting`→`Oczekuje`/amber, `in_progress`→`W trakcie`/blue,
`done`→`Gotowe`/emerald, `no_show`→`Nie przyjechał`/rose, `cancelled`→`Anulowane`/slate. Typed so a
future enum value fails the build rather than falling through to a default.

#### 4. Pure day-plan logic

**File**: `src/lib/services/day-plan.ts` (new)

**Intent**: The sort order, the four tile counts, and the status filter — all pure, so they are
testable without Supabase. This file holds **no I/O**, mirroring `slot-suggestions.ts`, which carries
that constraint as an explicit header at `:1-12`; the queries that feed it live in `appointments.ts`
(item 5), exactly as `slot-suggestions.ts` sits beneath `appointments.ts` today. AGENTS.md names that
pair as the precedent for testable business logic.

**Contract**: A `DayPlanEntry` view-model (appointment id, status, naive `startsAt`/`endsAt` strings,
customer first name and phone, service name and `durationMin`, bay name) exported through `src/types.ts`.
Plus `sortDayPlan(entries)` — ascending `startsAt`, bay name as tie-break, matching
`slot-suggestions.ts:82`; `countByStatus(entries)` returning the four tile numbers (total, `waiting`,
`done`, `no_show`); and `filterByStatus(entries, status | null)` where `null` means *Wszystkie*.

`cancelled` rows never reach these functions — the query (item 5) excludes them, so the board shows
only bookings that still stand and the *Wizyty* total means booked work. Two reasons: the brochure has
no *Anulowane* pill (`App.jsx:316` lists exactly `Wszystkie`, `Oczekuje`, `W trakcie`, `Gotowe`,
`Nie przyjechał`), and nothing in the product can currently produce the status — S-02 writes only
`waiting`, and S-04's scope stops at `no_show` (`roadmap.md:37`). Note this is *not* the same treatment
as `no_show`, which stays visible and keeps its own tile.
None of these touch `Date` — they compare the naive wire strings directly. That is safe because the
format is zero-padded and left-aligned (`YYYY-MM-DDTHH:MM:SS`), so byte order matches chronological
order. It is **not** safe to assume a fixed width: Postgres serializes a `timestamp` with a
variable-length fractional tail when one is present (`…T09:00:00`, `…T09:00:00.5`, `…T09:00:00.123456`),
and `starts_at` is `timestamp(6)` with no precision cast constraining it
(`20260821090000_appointments_and_customers.sql:41`). Every write today goes through
`naiveDateToTimestampString()`, which emits whole seconds, so values are 19 characters by convention
only — never slice by index to extract the time; match it, as `NewAppointmentForm.tsx:58-60` already does.

#### 5. Day-scoped query

**File**: `src/lib/services/appointments.ts`

**Intent**: Fetch one day's appointments with everything the card and the detail page render. Extends
the existing appointments service rather than starting a new I/O module, so every appointment query
sits beside `suggestSlotsForService()` (`:133`) and `bookAppointment()` (`:170`) — where S-04 will look
for them. RLS scopes it to the caller's workshop, so no `workshop_id` parameter — matching the rule
stated at `workshop-setup.ts:12-17`.

**Contract**: `getDayPlan(supabase, date: string): Promise<{ entries: DayPlanEntry[]; workingHours: WorkingHours | null }>`.
Two parallel selects — the `Promise.all` shape `getWorkshopConfiguration()` uses (`workshop-setup.ts:19-24`):
appointments joined to `customers`, `services` and `bays`, bounded by `starts_at >= '<date> 00:00:00'`
and `starts_at < '<date+1> 00:00:00'` (built with `shiftDateString`); excluding `cancelled` the way `appointments.ts:88` already
does for slot computation; and the single `working_hours` row for that date's weekday, which is what
lets the screen tell a closed day from a merely empty one.
Rows are mapped from the nested join shape to flat `DayPlanEntry` objects, then passed through `sortDayPlan()`.
The generated types will surface the joined `customers` / `services` / `bays` relations as possibly
`null` even though all three FKs are `not null`
(`20260821090000_appointments_and_customers.sql:38-40`). **Drop such a row rather than asserting it
away**: a non-null assertion turns an impossible-by-schema state into a runtime crash on the north-star
screen, while skipping it degrades to one missing card. Log the skip so it is not silent.
Errors throw, as every function in `workshop-setup.ts` does. `getAppointmentDetail(supabase, id): Promise<DayPlanEntry | null>`
uses the same join with `.maybeSingle()`, so an id from another workshop returns `null` rather than
leaking existence — the pattern `updateBay()` already uses (`workshop-setup.ts:70`).

#### 6. Tests for the pure layer

**File**: `src/lib/services/day-plan.test.ts` (new)

**Intent**: Cover the ordering and counting rules that the screen's correctness rests on, following
`slot-suggestions.test.ts`.

**Contract**: Cases for — same-start appointments on different bays ordering by bay name; counts with
zero appointments; counts where `in_progress` rows exist but have no tile of their own (the total must
still include them); `filterByStatus(…, null)` returning everything unchanged; and `shiftDateString`
crossing a month boundary, a year boundary, and a leap day.

### Success Criteria:

#### Automated Verification:

- `src/lib/services/day-plan.test.ts` exists and all its cases pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- No UI changed — `/dashboard`, `/ustawienia` and `/wizyty/nowa` still render exactly as before.

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human before proceeding to the next phase.

---

## Phase 2: Day plan screen

### Overview

`/dashboard` stops being a placeholder and becomes the `TodayScreen` replica. Open the brochure screen
at `~/Code/wulkanizator-go-brochure/src/App.jsx:293` before writing any markup — `lessons.md:26`
requires replicating it, not working from the token summary.

### Changes Required:

#### 1. Date resolution schema

**File**: `src/lib/schemas/day-plan.ts` (new)

**Intent**: Validate the `?data=` query parameter. A page cannot answer 400 usefully, so a malformed or
absent value resolves to the workshop's today rather than erroring.

**Contract**: A zod schema accepting `YYYY-MM-DD` and a `resolveDayParam(raw: string | null): string`
that returns the validated value or `workshopTodayDateString()`. Follows the regex-not-`z.coerce.date()`
precedent set at `src/lib/schemas/appointment.ts:6`, and validates *value* ranges as well as digit
shape — the gap flagged as F4 in S-02's implementation review.

#### 2. The day plan page

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the placeholder card entirely with the server-fetched day plan, keeping the
`AppShell` wrapper and the existing owner-gated CTA.

**Contract**: Reads `Astro.url.searchParams.get("data")` through `resolveDayParam()`, calls
`getDayPlan()`, and renders `<DayPlanBoard client:load … />` with the entries, the day's `workingHours`
row, the resolved date, the previous/next date strings, and the workshop's today. Keeps `ctaHref={profile?.role === "owner" ? "/wizyty/nowa" : undefined}`
(`:17`) and the `supabase ? … : "Supabase nie jest skonfigurowany."` fallback both shipped pages use
(`ustawienia.astro:16-18`). The settings card is removed — that entry point already exists in the nav
rail (`AppShell.astro:33`). **The sign-out form at `dashboard.astro:33-40` stays**, demoted below the
appointment list: it is the only sign-out reachable by a signed-in user, since `Topbar.astro:16`'s copy
is rendered solely through `Welcome.astro:28` on the unauthenticated landing page, and `AppShell`'s
avatar (`:57-59`) is a plain `<div>`, not a control. Moving sign-out into the shell is the better
long-term home but is out of scope here — it would edit a shared layout from inside a feature slice and
make the avatar interactive, which the brochure's own shell (`App.jsx:262-264`) does not.

#### 3. Status pill

**File**: `src/components/appointments/StatusPill.tsx` (new)

**Intent**: The badge from `brochure App.jsx:169-184`, driven by the Phase 1 mapping. Named export —
the convention for non-root components (`settings/Bays.tsx:7`).

**Contract**: `({ status }: { status: AppointmentStatus })` rendering
`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold` plus the mapped
classes. Class composition through `cn()` from `@/lib/utils`, never string concatenation (`AGENTS.md`).

#### 4. Day plan island

**File**: `src/components/appointments/DayPlanBoard.tsx` (new)

**Intent**: The screen itself — header, tiles, pills, list. It holds exactly one piece of state, the
active filter; everything else arrives as props already sorted.

**Contract**: Default export (island-root convention, `NewAppointmentForm.tsx:72`) taking
`{ entries, workingHours, date, prevDate, nextDate, today }`. Four `Stat`-shaped tiles from `countByStatus()`
replicating `brochure App.jsx:186-202` (gradient-text KPI value, `tone` per tile: slate / amber / emerald / rose).
Five filter pills — *Wszystkie* plus `DAY_PLAN_FILTER_STATUSES`, matching `App.jsx:316` exactly —
with the active pill `bg-slate-900 text-white` (`App.jsx:317`). Cards on the `grid-cols-[60px_1fr]` time-then-body layout of `App.jsx:323-350`, each
wrapping a link to `/wizyty/<id>`. Day navigation is three `<a>` elements to `?data=<prevDate>`,
`?data=<today>`, `?data=<nextDate>` — the *Dzisiaj* link renders inert when `date === today`.
Header subtitle names the weekday and date in Polish, reusing the label style of
`WorkingHours.tsx:17-27`. Two empty states, switched on the `workingHours` prop: no appointments on an open day, and a day the
workshop is closed (`is_closed`, or no row for that weekday).
No status buttons, no phone-call button, no "Otwórz" button beyond the card link itself.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`

#### Manual Verification:

- An appointment booked at `/wizyty/nowa` appears on `/dashboard` at the correct time with status *Oczekuje*.
- The four stat tiles match the visible list; filtering to each status shows exactly the matching cards
  and *Wszystkie* restores the full list.
- `‹` and `›` move one day at a time, *Dzisiaj* returns, and the browser back button retraces the days.
- A day with no appointments, and a Sunday (closed by the default seed), each show their own message.
- The screen is usable at 360px — no horizontal scroll, tiles and pills wrap.
- Visually compared side by side against the brochure's `TodayScreen`.
- A worker account sees the day plan without the "Nowa wizyta" CTA.
- Sign-out still works from `/dashboard` and returns to the sign-in page.

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human before proceeding to the next phase.

---

## Phase 3: Detail route and guard split

### Overview

FR-008: tapping a visit opens its details. A server-rendered page, no island, replicating the main card
of `brochure App.jsx:478-519` minus every control that belongs to S-04.

### Changes Required:

#### 1. Route table split

**File**: `src/lib/auth-guard.ts`

**Intent**: Let a worker open a visit while keeping booking owner-only. Both entries change together —
widening `/wizyty` alone would open `/wizyty/nowa` to workers.

**Contract**: `["/wizyty", "owner"]` (`:13`) becomes `["/wizyty", "any"]`, and `["/wizyty/nowa", "owner"]`
is added. Longest-prefix resolution (`:23-30`) then routes `/wizyty/nowa` to `owner` and `/wizyty/<id>`
to `any`. `/api/appointments` stays `owner` — nothing in this slice calls it.

#### 2. Guard tests

**File**: `src/lib/auth-guard.test.ts` (new)

**Intent**: The split's correctness is entirely in prefix ordering, which is invisible on reading. Pin it.

**Contract**: Asserts a worker profile is allowed on `/wizyty/<uuid>` and redirected from `/wizyty/nowa`;
an owner is allowed on both; an unauthenticated caller is redirected to `/auth/signin` from both. Also
pins that `/wizyty/nowabc` (a prefix that is not a path segment) does not match the `nowa` rule — the
boundary `matchRoute` handles at `:24`.

#### 3. Not-found page

**File**: `src/pages/404.astro` (new)

**Intent**: Give the 404 the detail route returns something to render. Without this file the response
is a blank white page: Astro treats a null-bodied 404 as reroutable, looks up route `/404`, finds
nothing, and emits status 404 with a `null` body. `wrangler.jsonc:11`'s `not_found_handling` does not
rescue it — that setting only applies to the adapter's `env.ASSETS.fetch()` path, which a matched
route's frontmatter never reaches.

**Contract**: A minimal page inside `AppShell` (`active="Dzisiaj"`, no CTA) with a short Polish message
and a link back to `/dashboard`. Astro renders it in place of the empty body and preserves the 404
status. Not prerendered — the site is `output: "server"` (`astro.config.mjs:11`) and no page opts in.

#### 4. Detail page

**File**: `src/pages/wizyty/[id].astro` (new)

**Intent**: Show one visit's details, read-only. First dynamic Astro page in the repo.

**Contract**: Reads `Astro.params.id`, calls `getAppointmentDetail()`, and returns a 404 `Response` when
it is `null` — which covers both a bad id and an id belonging to another workshop, since RLS makes the
two indistinguishable. Renders inside `AppShell` (`title="Szczegóły wizyty"`, `active="Dzisiaj"`, no CTA):
customer first name with `StatusPill`, the `HH:MM–HH:MM · service` subheading, and the three-box
`Usługa / Czas / Stanowisko` row of `App.jsx:496-500` — `Stanowisko` replacing the brochure's `Opony`
box, which has no data behind it until S-06. Phone rendered as a `tel:` link. A back link returns to
`/dashboard?data=<the visit's date>` so the user lands on the day they came from. No status-change
block, no notes block, no customer-history block.

### Success Criteria:

#### Automated Verification:

- `src/lib/auth-guard.test.ts` exists and all its cases pass: `npm test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Production build succeeds: `npm run build`
- RLS suite still passes: `npm run db:test`

#### Manual Verification:

- Tapping a card on the day plan opens that visit's details; the back link returns to the same day.
- A worker account can open a visit detail but is redirected away from `/wizyty/nowa`.
- A random UUID and a malformed id both render the 404 page (not a blank body) with a working link back
  to the day plan, and the response status is 404.
- The detail page is readable at 360px and visually matches the brochure's `VisitDetailScreen` main card,
  minus the omitted blocks.

**Implementation Note**: After completing this phase and all automated verification passes, pause here
for manual confirmation from the human before proceeding to the next phase.

---

## Phase 4: Ship

### Overview

Documentation, roadmap correction, and the merge. **This slice ships no migration**, so the
`lessons.md:5` "merge is deploying — push the schema before the merge" hazard does not apply; merging to
`main` deploys app code only, against a schema production already has.

### Changes Required:

#### 1. Route documentation

**File**: `README.md`

**Intent**: The auth-routes table (`README.md`, "Auth routes") lists every protected route and its access
level; `/dashboard` is described there as an "example protected page" and `/wizyty/nowa` as owner-only.
Both descriptions are now wrong.

**Contract**: `/dashboard` becomes the day plan (any authenticated role), and a `/wizyty/<id>` row is
added (any authenticated role, appointment details). Keep the existing table shape.

#### 2. Symbol-rename sweep

**File**: (grep-driven)

**Intent**: `lessons.md:12` — moving `workshopTodayDateString` out of `NewAppointmentForm.tsx` and
changing the `/wizyty` guard entry are exactly the shape that leaves stale instructions behind.

**Contract**: `grep -rn` for `workshopTodayDateString`, `/wizyty`, and `PROTECTED_ROUTES` across
`README.md`, `AGENTS.md`, `CLAUDE.md` and `context/`, and fix every hit that now describes the old
behaviour.

#### 3. Roadmap correction

**File**: `context/foundation/roadmap.md`

**Intent**: The S-03 outcome line (`:126`) promises a bays × time grid this slice deliberately does not
build, and the sort-order unknown (`:133`) is now resolved.

**Contract**: Rewrite the S-03 `- **Outcome:**` line to describe the chronological list with stat tiles,
status filters and a detail page. Strike the sort-order unknown, recording the resolution (start ascending,
bay name tie-break). Flip S-03's `- **Status:**` and its `## At a glance` row to `done` — via
`/10x-archive`, not by hand. Add the grid to **Parked** with a pointer to `WeekScreen`.

#### 4. Merge sequence

**File**: (process, not a file)

**Intent**: Record the ship order so it is followed rather than remembered.

**Contract**: 1) work on a feature branch; 2) `npm run lint && npm run typecheck && npm test && npm run build`
all green; 3) `npm run db:test` green (unchanged, but proves nothing regressed); 4) open the PR, let CI
pass; 5) merge to `main`, which auto-deploys; 6) smoke-test `/dashboard` and one `/wizyty/<id>` on
production. No `supabase db push` step — there is no migration.

### Success Criteria:

#### Automated Verification:

- Full gate passes: `npm run lint && npm run typecheck && npm test && npm run build`
- RLS suite passes: `npm run db:test`
- CI is green on the PR

#### Manual Verification:

- Grep sweep returns no stale references to the moved helper or the old `/wizyty` access rule.
- README's route table matches the shipped guard table.
- Production `/dashboard` shows the day plan for a real workshop, and a visit's detail page opens.

---

## Testing Strategy

### Unit Tests:

- `src/lib/services/day-plan.test.ts` — `sortDayPlan` (equal starts tie-broken by bay name; already-sorted
  input unchanged), `countByStatus` (empty day; a day containing `in_progress` and `cancelled`, which have
  no tile but must count toward the total), `filterByStatus` (each status; `null` returns all).
- `src/lib/workshop-clock.ts` helpers via the same file — `shiftDateString` across month end, year end,
  and 29 February; `workshopTodayDateString` for an instant where UTC and Europe/Warsaw disagree on the
  date (23:30 UTC in summer), which must return the Warsaw date.
- `src/lib/auth-guard.test.ts` — the worker/owner/anonymous matrix over `/wizyty`, `/wizyty/nowa` and
  `/wizyty/<uuid>`, plus the `/wizyty/nowabc` non-segment boundary.

### Integration Tests:

- No new pgTAP. The SELECT policies this slice reads through are already covered at
  `supabase/tests/rls_workshop_scope.test.sql:288-519`; `npm run db:test` runs as a regression gate only.

### Manual Testing Steps:

1. Sign in as an owner, book a visit for today at `/wizyty/nowa`, confirm it appears on `/dashboard`
   with status *Oczekuje* at the right time and bay.
2. Book a second visit for tomorrow; confirm it does **not** appear on today's board and does appear
   after tapping `›`.
3. Tap each filter pill; confirm the card set and that the tiles do not change (they describe the day,
   not the filter).
4. Tap a card, confirm the detail page, then use the back link and confirm you land on the same day.
5. Navigate to a Sunday and confirm the closed-day message; navigate to an empty open day and confirm
   the empty-day message.
6. Move a booked visit's status directly in Supabase Studio to `in_progress`, `done` and `no_show` in
   turn; reload and confirm each renders the right label and colour per `design-system.md:82-88`. Then
   set it to `cancelled` and confirm the row disappears from the board and stops counting toward *Wizyty*.
7. Repeat steps 1–5 at 360px width.
8. Sign in as a worker; confirm the day plan renders without the CTA, a visit detail opens, and
   `/wizyty/nowa` redirects to `/dashboard`.

## Performance Considerations

The NFR is *"plan dnia widoczny w mniej niż 2 sekundy"*. The page issues one joined query bounded to a
single day, served by the existing `appointments_workshop_id_starts_at_idx`
(`20260821090000_...sql:48`) — the index this access pattern was already built for. Counts and sorting
happen in memory over a day's worth of rows (tens, per the PRD's 1–5 bay persona), not in SQL. The only
client JS is the filter island; day navigation is plain links, so first paint carries the full board.

## Migration Notes

None. No schema change, no data backfill, no `npm run db:types`. The one behavioural change to an
existing contract is the `/wizyty` guard entry, which widens read access to a route that did not exist
before this slice — `/wizyty/nowa` keeps its owner-only rule, pinned by a test.

## References

- Brochure reference: `~/Code/wulkanizator-go-brochure/src/App.jsx:293` (`TodayScreen`),
  `:478` (`VisitDetailScreen`), `:169` (`StatusPill`), `:186` (`Stat`)
- Design authority: `context/foundation/design-system.md:23-30`, `:82-88`
- Prior slice: `context/archive/2026-08-21-add-appointment-with-slots/plan.md` and `reviews/impl-review.md`
- Schema: `supabase/migrations/20260821090000_appointments_and_customers.sql`
- Pattern to follow — page/island split: `src/pages/wizyty/nowa.astro:8,14`
- Pattern to follow — pure logic beneath a service: `src/lib/services/slot-suggestions.ts` / `.test.ts`
- Standing rules: `context/foundation/lessons.md:5,12,26`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Day-plan data layer

#### Automated

- [x] 1.1 `src/lib/services/day-plan.test.ts` exists and all its cases pass: `npm test` — 71e27c5
- [x] 1.2 Type checking passes: `npm run typecheck` — 71e27c5
- [x] 1.3 Linting passes: `npm run lint` — 71e27c5
- [x] 1.4 Production build succeeds: `npm run build` — 71e27c5

#### Manual

- [x] 1.5 No UI changed — `/dashboard`, `/ustawienia` and `/wizyty/nowa` still render exactly as before — 71e27c5

### Phase 2: Day plan screen

#### Automated

- [x] 2.1 Unit tests pass: `npm test` — 0d213e5
- [x] 2.2 Type checking passes: `npm run typecheck` — 0d213e5
- [x] 2.3 Linting passes: `npm run lint` — 0d213e5
- [x] 2.4 Production build succeeds: `npm run build` — 0d213e5

#### Manual

- [x] 2.5 A booked appointment appears on `/dashboard` at the correct time with status *Oczekuje* — 0d213e5
- [x] 2.6 Stat tiles match the list; each filter pill shows exactly its matching cards; *Wszystkie* restores all — 0d213e5
- [x] 2.7 Day navigation moves one day at a time, *Dzisiaj* returns, browser back retraces — 0d213e5
- [x] 2.8 Empty open day and closed (Sunday) day each show their own message — 0d213e5
- [x] 2.9 Usable at 360px — no horizontal scroll, tiles and pills wrap — 0d213e5
- [x] 2.10 Visually compared side by side against the brochure's `TodayScreen` — 0d213e5
- [x] 2.11 A worker account sees the day plan without the "Nowa wizyta" CTA — 0d213e5
- [x] 2.12 Sign-out still works from `/dashboard` and returns to the sign-in page — 0d213e5

### Phase 3: Detail route and guard split

#### Automated

- [x] 3.1 `src/lib/auth-guard.test.ts` exists and all its cases pass: `npm test` — e383de8
- [x] 3.2 Type checking passes: `npm run typecheck` — e383de8
- [x] 3.3 Linting passes: `npm run lint` — e383de8
- [x] 3.4 Production build succeeds: `npm run build` — e383de8
- [x] 3.5 RLS suite still passes: `npm run db:test` — e383de8

#### Manual

- [x] 3.6 Tapping a card opens that visit's details; the back link returns to the same day — e383de8
- [x] 3.7 A worker can open a visit detail but is redirected away from `/wizyty/nowa` — e383de8
- [x] 3.8 A random UUID and a malformed id both render the 404 page with a link back, status 404 — e383de8
- [x] 3.9 Detail page readable at 360px and matches `VisitDetailScreen`'s main card, minus omitted blocks — e383de8

### Phase 4: Ship

#### Automated

- [x] 4.1 Full gate passes: `npm run lint && npm run typecheck && npm test && npm run build`
- [x] 4.2 RLS suite passes: `npm run db:test`
- [ ] 4.3 CI is green on the PR

#### Manual

- [x] 4.4 Grep sweep returns no stale references to the moved helper or the old `/wizyty` access rule
- [x] 4.5 README's route table matches the shipped guard table
- [ ] 4.6 Production `/dashboard` shows the day plan and a visit's detail page opens
