---
title: Anti-Corruption Layer — the generated PostgREST schema
created: 2026-09-13
type: refactor-plan
---

# Anti-Corruption Layer — Wulkanizator GO

A refactor plan, not an implementation. No production code, SQL or configuration is changed by this
document. Every `file:line` below was opened and read in this session; nothing is carried over from
`01-domain-distillation.md` or `02-invariant-aggregate-refactor.md` without re-verification.

## 0. Context discovered

**Base documents read:** `context/foundation/prd.md`, `context/foundation/tech-stack.md`,
`context/foundation/roadmap.md`, `README.md`, `AGENTS.md`.

**No document declares any component replaceable.** A grep for `wymien|swap|vendor|lock-in|portab|replace|migracj`
over `tech-stack.md`, `prd.md`, `README.md` and `AGENTS.md` returns nothing. `tech-stack.md:24`
picks the starter precisely _because_ it "ships auth + PostgreSQL database + edge deploy via
Supabase and Cloudflare Pages out of the box" — coupling was a deliberate, time-boxed choice, not
an oversight. **This matters for the framing below: the argument for an ACL here cannot be
"someday we swap Supabase", because nobody ever promised that. It has to stand on the boundary
damage the leak does today.** It does.

`AGENTS.md` does, however, make one explicit isolation promise, about a different dependency —
`AGENTS.md:14`: "`src/lib/workshop-clock.ts` is the only module permitted to convert between an
instant and workshop-local parts." That promise is broken in code (§2, candidate D).

**Stack** (`AGENTS.md:3`, verified against the tree): Astro 7 SSR + React 19 islands on Cloudflare
Workers, Supabase (Postgres + Auth + PostgREST), zod at the HTTP edge, Vitest + pgTAP + Playwright.

**External dependencies with a domain footprint** (`package.json:25-50`): `@supabase/supabase-js`,
`@supabase/ssr`, `zod`, `astro`, `react`, `lucide-react`, `pg` (dev, E2E only). The rest — Tailwind,
`clsx`, `tailwind-merge`, `class-variance-authority`, `@radix-ui/react-slot`, `tw-animate-css` —
are presentation-only and carry no domain meaning; they are out of scope and stay out.

**Layers** (the same six used in `01-domain-distillation.md`): UI islands · Astro pages · HTTP
routes · validation schemas · services · persistence, plus middleware and ambient types.

---

## 1. Leaking dependencies identified

### 1.1 The first grep is misleading — and that is the finding

The obvious suspect was the Supabase SDK. Grepping for the **package name** makes it look pristine:

```
$ grep -rn --include='*.ts' --include='*.tsx' --include='*.astro' "@supabase/" src e2e
src/env.d.ts:3:    user: import("@supabase/supabase-js").User | null;
src/lib/supabase.ts:1:import { createServerClient, parseCookieHeader } from "@supabase/ssr";
```

**Two files.** By the success criterion this exercise normally ends with — "a grep for the package
name returns only files in the ACL directory" — `@supabase/*` already passes.

It passes because the dependency does not travel under its own name. It travels as
`src/db/database.types.ts`, the 491-line file regenerated from the live schema by `npm run db:types`
(`AGENTS.md:11`), and as `TypedSupabaseClient` (`src/lib/supabase.ts:27`), a type alias over the
SDK's client. `src/types.ts:18-26` re-exports eight generated **table rows and enums** as the
project's domain vocabulary:

```ts
export type Workshop = Database["public"]["Tables"]["workshops"]["Row"];
export type Bay = Database["public"]["Tables"]["bays"]["Row"];
export type Service = Database["public"]["Tables"]["services"]["Row"];
export type WorkingHours = Database["public"]["Tables"]["working_hours"]["Row"];
export type Appointment = Database["public"]["Tables"]["appointments"]["Row"];
…
```

`AGENTS.md:19` calls `src/types.ts` "shared entity and DTO types". It is neither: it is the
database schema wearing domain names. Everything downstream of it — React island props, React
`useState` shapes, HTTP request bodies, HTTP response bodies — is therefore the database schema too.

### 1.2 Candidate inventory

| #     | Dependency                                        | How it travels                                                                                                                    | Files that know it today                                                                                                                                                                   |
| ----- | ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A** | **Supabase / PostgREST generated schema**         | `@/db/database.types` → `src/types.ts` row aliases → props, state, wire; plus snake_case column literals typed by hand in islands | **25 non-test files, 31 with tests** — every layer (§1.3)                                                                                                                                  |
| B     | Supabase SDK **client object**                    | `TypedSupabaseClient` as the first parameter of every service function                                                            | 4 (`env.d.ts:5`, `services/workshop-setup.ts`, `services/appointments.ts`, + `appointments.test.ts`)                                                                                       |
| C     | PostgREST **query & error protocol**              | `.from()/.select()/.eq()/.rpc()`, `error.code === "23P01"`, `maybeSingle()` null semantics                                        | 3 (`services/appointments.ts`, `services/workshop-setup.ts`, `middleware.ts:20`)                                                                                                           |
| D     | Native **`Date`** as the naive wall-clock carrier | `new Date(Date.UTC(…))` and `getUTC*` arithmetic outside `workshop-clock.ts`                                                      | 4 non-test (`components/appointments/DayPlanBoard.tsx:48`, `lib/schemas/day-plan.ts:17`, `lib/services/appointments.ts:72,76,83-84,182,195,251`, `lib/services/slot-suggestions.ts:75-76`) |
| E     | `zod`                                             | `z.infer` types re-exported as DTOs (`src/types.ts:2-15`), so validator shape _is_ the input type                                 | 2 schema files + `src/types.ts` + every route                                                                                                                                              |
| F     | `pg` (E2E back door)                              | raw SQL against `public.*` in `e2e/support/db.ts:36-108`                                                                          | 1                                                                                                                                                                                          |

### 1.3 Candidate A, file by file — every layer

Union of the greps for `@supabase/`, `db/database.types`, `TypedSupabaseClient`, `from "@/types"`,
and the literal column names `is_active|duration_min|is_closed|opens_at|closes_at|vehicle_type|workshop_id|starts_at`
plus `.from("`/`.rpc(`:

| Layer                   | Files                                                                                                                                                                                                                   | Evidence                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Generated / persistence | `src/db/database.types.ts`                                                                                                                                                                                              | the artifact itself, 491 lines                            |
| Client factory          | `src/lib/supabase.ts:1-27`                                                                                                                                                                                              | only legitimate knower                                    |
| Ambient globals         | `src/env.d.ts:3-5`                                                                                                                                                                                                      | `User` and `TypedSupabaseClient` on `App.Locals`          |
| Shared types            | `src/types.ts:1,18-26`                                                                                                                                                                                                  | the re-export that spreads it                             |
| Middleware              | `src/middleware.ts:4,20`                                                                                                                                                                                                | `.from("profiles")`, `UserProfile`                        |
| Services (6)            | `appointments.ts`, `workshop-setup.ts`, `day-plan.ts`, `appointment-transitions.ts`, `status-failure.ts`, `appointment-status.ts`                                                                                       | row types + enum in signatures                            |
| Validation (2)          | `schemas/appointment.ts:2,26`, `schemas/workshop-setup.ts`                                                                                                                                                              | zod objects mirror table columns 1:1                      |
| Auth                    | `lib/auth-guard.ts:1`                                                                                                                                                                                                   | `UserRole` = DB enum                                      |
| **UI islands (10)**     | `DayPlanBoard.tsx`, `NewAppointmentForm.tsx`, `AppointmentStatusPanel.tsx`, `StatusPill.tsx`, `Bays.tsx`, `ServiceDurations.tsx`, `WorkingHours.tsx`, `WorkshopDetailsForm.tsx`, `WorkshopSettings.tsx`, `UserMenu.tsx` | DB rows as props, snake_case in JSX and in `fetch` bodies |

**Answer to the verification question this phase asks: the dependency lives in 6 of 6 layers, in 25
production files (31 counting tests), and its column vocabulary appears on 93 lines of application
code** (measured in §6.1) — against 2 lines naming the package itself. The count is what the
package-name grep hides.

### 1.4 What does _not_ leak — checked, and clean

Stating the negatives matters, because two of the four classic signals genuinely do not fire here:

- **No client-side SDK.** No React component or `.astro` file imports `@supabase/*`. The SDK is
  never called from both sides of the client/server boundary; it is server-only, created per request
  from `astro:env/server` secrets (`src/lib/supabase.ts:3,10`).
- **No server library in the client bundle.** `src/types.ts`'s import of `@/db/database.types` is
  `import type` (`src/types.ts:1`), erased at compile time. The file's one runtime export,
  `Constants` (`database.types.ts:474-491`), is imported by nothing. The leak is a **contract**
  leak, not a bundle leak — and overstating it would be the easy error here.
- **Query knowledge is already confined** to three files (candidate C). The service layer really is
  the only place that speaks PostgREST verbs.

---

## 2. Classification, and the choice of #1

| Axis                             | A — generated schema                                                                             | B — client object    | C — query protocol     | D — native `Date`                       | E — zod                                           | F — `pg`       |
| -------------------------------- | ------------------------------------------------------------------------------------------------ | -------------------- | ---------------------- | --------------------------------------- | ------------------------------------------------- | -------------- |
| (a) layers / files touched       | **6 / 25**                                                                                       | 2 / 4                | 1 / 3                  | 3 / 4                                   | 3 / 5                                             | 1 / 1          |
| (b) cost of replacement today    | **highest — the change front is every prop, every state shape, every request and response body** | low — one type alias | low, already localized | n/a (platform primitive, not swappable) | medium, but zod _is_ the contract layer by design | nil, test-only |
| (c) documents declare isolation? | no                                                                                               | no                   | no                     | **yes — `AGENTS.md:14`**                | no (`AGENTS.md:19` endorses current shape)        | n/a            |
| Reaches the browser?             | **yes**                                                                                          | no                   | no                     | yes                                     | no                                                | no             |

**#1 is A — the generated PostgREST schema.**

The uncomfortable part is axis (c): the only _documented_ isolation promise in the repository is
about `Date`, not about Supabase, and that promise is broken —
`DayPlanBoard.tsx:48` builds a `Date` from date parts inside a React island, and
`schemas/day-plan.ts:17` does it again inside a validator, both outside the module `AGENTS.md:14`
names as the only permitted one. D is a real, documented intent-vs-code divergence and it is
recorded here so the report can say so.

It is still not #1, for three reasons:

1. **`Date` is not a swappable dependency.** An ACL's payoff is "the library changes, one directory
   changes". Nothing replaces `Date`. The right fix for D is a _branded type_ (`NaiveWallClock`) —
   which `02-invariant-aggregate-refactor.md:120-122` already identified and deliberately deferred
   as "a type-system problem, not an aggregate problem". Solving it inside A's value objects (§4.2)
   is strictly better than solving it alone, and that is what §4 does.
2. **A is the only candidate that crosses the trust boundary outward.** Eight of the eleven JSON
   success responses in `src/pages/api/` are a raw database row (§3.2). D never leaves the process
   as a contract.
3. **A subsumes B and C.** Any port narrow enough to hide the row shape also hides the client object
   and the query verbs; the reverse is false. Fixing B alone (renaming a type alias) buys nothing.

**Why A hurts even though nobody promised to replace Supabase.** The damage is not hypothetical
vendor lock-in — it is that **`npm run db:types` is a load-bearing step in the public API of this
application**. `AGENTS.md:11` mandates regenerating `database.types.ts` after every migration, and
`lefthook.yml`'s `pre-push` job enforces it. That pipeline is correct for persistence. What is wrong
is that it terminates in `src/types.ts`, from which it flows unmediated into ten React components:
**adding, renaming or dropping a Postgres column silently rewrites the HTTP contract and the props
of the browser UI.** There is no layer that would have to agree to the change.

---

## 3. Diagnosis

### 3.1 The same concept, reconstructed in four places

`working_hours` is the clearest instance. One domain concept — _a weekday's opening window_ — is
spelled out independently four times, each in a different layer, each in the database's vocabulary:

| #   | Place        | Code                                                                                                                                          |
| --- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Table        | `working_hours.Row` — `closes_at`, `is_closed`, `opens_at`, `weekday`, `workshop_id`, `created_at`, `id` (`database.types.ts`)                |
| 2   | Validator    | `workingHoursUpdateSchema` — `opens_at`, `closes_at`, `is_closed` (`schemas/workshop-setup.ts:39-50`)                                         |
| 3   | React draft  | `toDraft(row)` → `{ opensAt: row.opens_at, closesAt: row.closes_at, isClosed: row.is_closed }` (`components/settings/WorkingHours.tsx:33-38`) |
| 4   | Request body | `{ opens_at: …, closes_at: …, is_closed: … }` (`components/settings/WorkingHours.tsx:65-69`)                                                  |

The island converts _out of_ the database's naming into `HoursDraft` at :33-38 and converts _back
into_ it at :65-69 — a mapping that exists, works, and is in the wrong place. That mapping is the
ACL, currently living inside a presentational component.

The same doubling elsewhere:

- `duration_min` appears in `ServiceDurations.tsx` at :69, :70, :72, :73, :77, :80, :149, :184 —
  eight times in one island, including in `useState` and in two `fetch` bodies.
- `is_active: false` is the _soft-delete domain operation_ "deactivate", written as a column
  assignment in two islands: `Bays.tsx:24` and `ServiceDurations.tsx:94`.
- `NewAppointmentForm.tsx:102-105` hand-builds `{ service_id, bay_id, starts_at, first_name }`, and
  `:152` renders `booked.starts_at` / `booked.ends_at` — a raw `appointments` row held in React
  state and formatted for display by a regex (`:49-51`).

### 3.2 The database row _is_ the HTTP response

Of eleven JSON success responses in `src/pages/api/`, **eight return a PostgREST row verbatim**:

| Route                                             | Line                                          | Body                                                                                                                                                                                                           |
| ------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/appointments`                          | `appointments/index.ts:35`                    | the whole `appointments` row — `bay_id`, `created_at`, **`customer_id`**, `ends_at`, `id`, `service_id`, `starts_at`, `status`, **`workshop_id`** (`database.types.ts:38-46`, `Returns` of `book_appointment`) |
| `POST /api/bays` · `PATCH /api/bays/[id]`         | `bays/index.ts:21`, `bays/[id].ts:29`         | `bays` row incl. `workshop_id`, `created_at`                                                                                                                                                                   |
| `POST /api/services` · `PATCH /api/services/[id]` | `services/index.ts:21`, `services/[id].ts:29` | `services` row incl. `workshop_id`, `created_at`                                                                                                                                                               |
| `PUT /api/working-hours/[weekday]`                | `working-hours/[weekday].ts:29`               | `working_hours` row incl. `workshop_id`, `id`                                                                                                                                                                  |
| `PATCH /api/workshop`                             | `workshop.ts:21`                              | `workshops` row incl. `created_at`                                                                                                                                                                             |

`workshop_id` is not a secret — RLS guarantees the caller is inside that workshop — so this is not a
data breach. It is a **contract** defect: the browser receives, and can start depending on, columns
that exist for persistence reasons only, and every future migration on those five tables is an
unversioned change to a public API.

**The repository already knows how to do this correctly, in exactly the two places where a DTO
happens to exist:**

- `GET/POST /api/appointments/slots` returns `WireSlot` — `{ bayId, bayName, start, end }`
  (`services/appointments.ts:37-42`), mapped by `toWireSlot()` (`:47-54`).
- `PATCH /api/appointment-status/[id]` returns `DayPlanEntry` — nine camelCase domain fields
  (`services/day-plan.ts:17-27`), and `wizyty/[id].astro` consumes it with no database vocabulary
  anywhere on the page (`:27-62`).

So the fix is not novel architecture. It is **applying the pattern the booking slice already
established to the four entities the settings slice skipped.**

### 3.3 The declared promise the code does not keep

`AGENTS.md:14`:

> Appointment and other domain times are naive workshop-local wall-clock (`timestamp`, not
> `timestamptz`) — `src/lib/workshop-clock.ts` **is the only module permitted to convert between an
> instant and workshop-local parts.**

Broken at:

- `components/appointments/DayPlanBoard.tsx:46-49` — `new Date(Date.UTC(year, month - 1, day))`
  built from a split string, to read `getUTCDay()` for a weekday label.
- `lib/schemas/day-plan.ts:17` — the same construction inside a zod validator.
- `lib/services/appointments.ts:72, 76, 83-84, 251` — four more naive-`Date` constructions.

Each is individually defensible (all use `Date.UTC` + `getUTC*`, as the rule's second clause
requires) and none is a live bug. The point is structural: the convention is enforced by review,
and the type system cannot tell a naive wall-clock `Date` from an instant — `getWorkshopNow()`
returns `Date` and `new Date()` returns `Date`. The generated schema makes this worse by typing
`starts_at` / `ends_at` as bare `string` (`database.types.ts:33-34`), discarding the one fact that
matters about them.

### 3.4 An open question the library contract must settle

`day-plan.ts:11-14` and `workshop-clock.ts:79` both accept **either** separator in a timestamp
(`/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/`), and `STARTS_AT_PATTERN`
(`schemas/appointment.ts:7`) accepts both on the way in. Two different reader modules each guess at
PostgREST's serialization of `timestamp without time zone` rather than one module knowing it.
Separately, `appointments.ts:207` and `:334` branch on `error.code === "23P01"` — a **SQLSTATE** —
while PostgREST also emits its own `PGRST###` codes in the same field. Neither decision is written
down anywhere; both are inferred at two call sites each. §4.4 places both inside the adapter.

---

## 4. ACL design

Three pieces: **value objects** that own the shape of the data, a **narrow port** that states what
the domain needs, and an **adapter** that is the only code allowed to name Supabase.

### 4.1 Directory layout

```
src/domain/                 # no import of @supabase/*, @/db/database.types, or "@/lib/supabase"
  wall-clock.ts             #   NaiveWallClock (branded), OpeningWindow
  catalog.ts                #   Service, Bay  (domain shapes, not rows)
  schedule.ts               #   WeekSchedule, AppointmentSummary
  workshop.ts               #   WorkshopProfile
  ports.ts                  #   WorkshopCatalogPort, SchedulePort — interfaces only
  errors.ts                 #   SlotTaken, NotFound, StaleWrite — named domain failures
src/lib/adapters/supabase/  # the ONLY directory that may name the dependency
  client.ts                 #   today's src/lib/supabase.ts, moved
  mappers.ts                #   Row -> domain, domain -> Insert/Update. Bidirectional, one place
  catalog.adapter.ts        #   implements WorkshopCatalogPort
  schedule.adapter.ts       #   implements SchedulePort
  errors.ts                 #   SQLSTATE / PGRST code -> domain error. The only file naming "23P01"
```

`src/types.ts` keeps existing for the zod-inferred input types, and **stops re-exporting table
rows**: `src/types.ts:18-26` is deleted, replaced by re-exports from `src/domain/`.

### 4.2 Value objects

**`NaiveWallClock`** — the ACL for candidate D, folded in here. One branded type makes the
convention of `AGENTS.md:14` a compile error instead of a review note, and gives `starts_at`'s bare
`string` a meaning:

```ts
// src/domain/wall-clock.ts
declare const naive: unique symbol;
/** Workshop-local wall-clock. Carries no zone; comparable to other NaiveWallClocks only. */
export type NaiveWallClock = string & { readonly [naive]: true };

export function wallClock(value: string): NaiveWallClock; // validates, throws on garbage
export function wallClockFromParts(y: number, m: number, d: number, hh: number, mm: number): NaiveWallClock;
export function addMinutes(t: NaiveWallClock, minutes: number): NaiveWallClock;
export function dateOf(t: NaiveWallClock): DateOnly; // "YYYY-MM-DD"
export function timeOf(t: NaiveWallClock): "HH:MM";
export function weekdayOf(d: DateOnly): Weekday; // 0..6, Postgres `dow`
export function compare(a: NaiveWallClock, b: NaiveWallClock): number;
```

The representation is the **string**, not a `Date` — that is the decisive choice. The wire format,
the Postgres literal and the comparison order are already the same lexicographic string
(`day-plan.ts:11-14` relies on exactly this), so the `Date` round-trip in
`timestampStringToNaiveDate` / `naiveDateToTimestampString` (`workshop-clock.ts:46-53, 81-95`) exists
only to do arithmetic. Keep `Date` **inside** these functions as an implementation detail; never let
one out. `getWorkshopNow()` stays in `workshop-clock.ts`, retyped to return `NaiveWallClock`.

Consequence: `DayPlanBoard.tsx:46-49` and `schemas/day-plan.ts:17` call `weekdayOf()` and construct
no `Date` at all — the `AGENTS.md:14` promise becomes structurally true.

**Entities** — same fields, domain names, no persistence noise:

```ts
// src/domain/catalog.ts
export interface Service {
  id: ServiceId;
  name: string;
  durationMin: Minutes;
  isActive: boolean;
}
export interface Bay {
  id: BayId;
  name: string;
  vehicleType: string | null;
  isActive: boolean;
}
// src/domain/wall-clock.ts
export type OpeningWindow = { closed: true } | { closed: false; opensAt: "HH:MM"; closesAt: "HH:MM" };
export interface WeekSchedule {
  windowFor(day: Weekday): OpeningWindow;
}
// src/domain/workshop.ts
export interface WorkshopProfile {
  id: WorkshopId;
  name: string;
  phone: string | null;
  address: string | null;
}
```

`workshop_id` and `created_at` are **absent by construction** — that is the §3.2 fix. `id` fields are
branded (`ServiceId = string & {…}`) so a bay id can never be passed where a service id belongs, a
mistake the current `string`-typed rows permit at `NewAppointmentForm.tsx:102-103`.

`OpeningWindow` as a discriminated union is a second structural win: today
`WorkingHours.is_closed === false` with `opens_at === null` is representable
(`database.types.ts` allows both nullable) and only a zod `.refine()` at
`schemas/workshop-setup.ts:47-50` keeps it out. In the union it is unrepresentable.

### 4.3 The narrow ports

The domain states what it needs, in domain words. No `TypedSupabaseClient` — that is candidate B
dissolved:

```ts
// src/domain/ports.ts
export interface WorkshopCatalogPort {
  profile(): Promise<WorkshopProfile>;
  services(opts?: { includeInactive?: boolean }): Promise<Service[]>;
  bays(opts?: { includeInactive?: boolean }): Promise<Bay[]>;
  schedule(): Promise<WeekSchedule>;

  renameWorkshop(details: WorkshopProfile): Promise<WorkshopProfile>;
  addService(name: string, duration: Minutes): Promise<Service>;
  changeServiceDuration(id: ServiceId, duration: Minutes): Promise<Service>;
  deactivateService(id: ServiceId): Promise<void>; // not `{ is_active: false }`
  addBay(name: string, vehicleType: string | null): Promise<Bay>;
  deactivateBay(id: BayId): Promise<void>;
  setOpeningWindow(day: Weekday, window: OpeningWindow): Promise<OpeningWindow>;
}

export interface SchedulePort {
  appointmentsOn(date: DateOnly): Promise<AppointmentSummary[]>;
  appointment(id: AppointmentId): Promise<AppointmentSummary | null>;
  busyIntervals(from: NaiveWallClock, to: NaiveWallClock): Promise<Map<BayId, Interval[]>>;
  book(command: BookingCommand): Promise<BookingResult>; // Result, never a thrown PostgrestError
  advanceStatus(id: AppointmentId, from: Status, to: Status): Promise<StatusChangeResult>;
}
```

Eleven methods replace "hand this component the client and let it write SQL-shaped objects". Note
`deactivateService` — the domain operation, stated once, instead of `is_active: false` typed by hand
in two islands (`Bays.tsx:24`, `ServiceDurations.tsx:94`).

### 4.4 The adapter — and the two contract decisions it absorbs

```ts
// src/lib/adapters/supabase/mappers.ts   (the only file that may write snake_case)
import type { Database } from "@/db/database.types";
type ServiceRow = Database["public"]["Tables"]["services"]["Row"];

export function toService(row: ServiceRow): Service {
  return { id: row.id as ServiceId, name: row.name, durationMin: row.duration_min as Minutes, isActive: row.is_active };
}
export function toServiceUpdate(patch: Partial<Service>): Database["public"]["Tables"]["services"]["Update"] {
  return {
    ...(patch.name !== undefined && { name: patch.name }),
    ...(patch.durationMin !== undefined && { duration_min: patch.durationMin }),
    ...(patch.isActive !== undefined && { is_active: patch.isActive }),
  };
}
export function toOpeningWindow(row: WorkingHoursRow): OpeningWindow {
  return row.is_closed || !row.opens_at || !row.closes_at
    ? { closed: true }
    : { closed: false, opensAt: hhmm(row.opens_at), closesAt: hhmm(row.closes_at) };
}
```

**Decision 1 — the timestamp separator (§3.4).** PostgREST serializes a `timestamp without time
zone` as ISO-8601 with a `T` and no offset; the space-separated form is what raw SQL literals and
`e2e/support/db.ts` produce. Rather than leave two regexes independently tolerant, the adapter
**normalizes on the way in** — `wallClock(row.starts_at)` accepts both and emits one canonical
form — so `day-plan.ts:11-14`'s comparison assumption is guaranteed by a parser instead of assumed
by a comment, and `schemas/appointment.ts:7` can tighten to the single canonical form.

**Decision 2 — the error code namespace (§3.4).** `error.code` in a `PostgrestError` carries a
five-character **SQLSTATE** for database-raised errors and a `PGRST###` code for PostgREST-raised
ones. One table, one file:

```ts
// src/lib/adapters/supabase/errors.ts — the only file in the repo naming "23P01"
const DOMAIN_ERROR_BY_CODE: Record<string, DomainErrorKind> = {
  "23P01": "slot_taken",        // exclusion constraint appointments_no_overlap_per_bay
  "23505": "duplicate",
  "42501": "forbidden",         // RLS refusal
  PGRST116: "not_found",        // zero rows where one was required
};
export function toDomainError(error: PostgrestError): DomainError { … }
```

This is also where `02-invariant-aggregate-refactor.md:363-390`'s `REJECTION_BY_SQLSTATE` table
belongs once the guardian function raises `WG001`–`WG006` — the two plans converge on one file
rather than two, which is the point of doing them in this order.

**The adapter is the only thing that changes when the dependency does.** Everything above the port
speaks `Service`, `Bay`, `OpeningWindow`, `NaiveWallClock`.

### 4.5 Wiring

`src/middleware.ts` today attaches `supabase: TypedSupabaseClient | null` to `App.Locals`
(`env.d.ts:5`). It attaches the **ports** instead:

```ts
// src/env.d.ts
declare namespace App {
  interface Locals {
    user: import("@/domain/identity").CurrentUser | null; // not @supabase/supabase-js User
    profile: import("@/domain/identity").UserProfile | null;
    catalog: import("@/domain/ports").WorkshopCatalogPort | null;
    schedule: import("@/domain/ports").SchedulePort | null;
  }
}
```

`App.Locals.user` stops being `@supabase/supabase-js`'s `User` (`env.d.ts:3`), whose ~20 auth fields
nothing in this codebase reads.

---

## 5. Isolation proof, and before / after

### 5.1 Which files stop knowing the dependency

| File                                                                                                   | Today                                                          | After                                                                           |
| ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `src/db/database.types.ts`                                                                             | generated schema                                               | unchanged — still generated, now read by 1 directory                            |
| `src/lib/supabase.ts`                                                                                  | `@supabase/ssr`                                                | moves to `adapters/supabase/client.ts`                                          |
| `src/env.d.ts:3-5`                                                                                     | `@supabase/supabase-js`, `TypedSupabaseClient`                 | **port interfaces only**                                                        |
| `src/types.ts:1,18-26`                                                                                 | 8 row/enum aliases                                             | **deleted**; re-exports `src/domain/`                                           |
| `src/middleware.ts:20`                                                                                 | `.from("profiles")`                                            | calls an identity port                                                          |
| `services/appointments.ts`                                                                             | `TypedSupabaseClient` ×6, `.from()` ×9, `.rpc()`, `"23P01"` ×2 | takes `SchedulePort`; **zero** Supabase names                                   |
| `services/workshop-setup.ts`                                                                           | `TypedSupabaseClient` ×8, `.from()` ×10, `.rpc()`              | takes `WorkshopCatalogPort`; **zero**                                           |
| `services/day-plan.ts`, `appointment-transitions.ts`, `status-failure.ts`, `lib/appointment-status.ts` | `AppointmentStatus` = DB enum                                  | domain `Status` union                                                           |
| `schemas/workshop-setup.ts`, `schemas/appointment.ts`                                                  | fields named after columns                                     | fields named after the domain; adapter maps                                     |
| all 10 UI islands                                                                                      | row types as props, snake_case in JSX + `fetch`                | domain types; **no snake_case identifier survives in `src/components/`**        |
| `e2e/support/db.ts`                                                                                    | raw SQL                                                        | unchanged — a deliberate back door below the app, documented in `e2e/README.md` |

**Not touched by the refactor, which is the proof:** `supabase/migrations/**` (0 files), the RLS
policies, `supabase/tests/rls_workshop_scope.test.sql`, the exclusion constraint, and every table
definition. The database keeps its column names; only the app stops repeating them.

### 5.2 Before / after, the four duplicated places

**Opening hours** — `components/settings/WorkingHours.tsx:33-38, 65-69`

```ts
// before — the island converts out of, and back into, the database's vocabulary
function toDraft(row: WorkingHoursRow): HoursDraft {
  return { opensAt: toTimeInputValue(row.opens_at), closesAt: toTimeInputValue(row.closes_at),
           isClosed: row.is_closed };
}
await mutate(`/api/working-hours/${weekday}`, "PUT",
  { opens_at: draft.isClosed ? null : draft.opensAt, closes_at: …, is_closed: draft.isClosed });

// after — the island receives OpeningWindow and sends OpeningWindow; no null-pairing to reason about
function toDraft(w: OpeningWindow): HoursDraft { return w.closed ? CLOSED_DRAFT : { …w }; }
await mutate(`/api/working-hours/${weekday}`, "PUT", toOpeningWindow(draft));
```

**Deactivate** — `components/settings/Bays.tsx:24`, `ServiceDurations.tsx:94`

```ts
// before:  body: { is_active: false }          — a column assignment, twice
// after :  DELETE /api/bays/:id                — the route calls catalog.deactivateBay(id)
```

**Booking** — `components/appointments/NewAppointmentForm.tsx:102-105, 152`

```ts
// before
body: { service_id: selectedServiceId, bay_id: selectedSlot.bayId,
        starts_at: selectedSlot.start, first_name: firstName.trim(), phone }
… {fullDateLabel(booked.starts_at)}, {timeLabel(booked.starts_at)}–{timeLabel(booked.ends_at)}

// after — one vocabulary end to end; `booked` is AppointmentSummary, not an `appointments` row
body: { serviceId, bayId, startsAt: selectedSlot.start, customer: { firstName, phone } }
… {formatDate(booked.startsAt)}, {timeOf(booked.startsAt)}–{timeOf(booked.endsAt)}
```

**Response bodies** — all eight routes in §3.2 map through the adapter, so `workshop_id`,
`customer_id` and `created_at` stop being part of the public API. This is a **breaking wire change**;
§6 sequences it.

### 5.3 What the UI layer receives

Today `ustawienia.astro:8,14` hands `WorkshopSettings` a `WorkshopConfiguration` whose four fields
are arrays of raw rows (`src/types.ts:34-39`), serialized into the page HTML as island props —
`created_at` and `workshop_id` for every bay and service included. After the refactor the same prop
is four arrays of domain objects with no persistence fields, and the serialized payload shrinks
accordingly. The precedent is already in the repo: `wizyty/[id].astro:27-62` renders a `DayPlanEntry`
and contains no database vocabulary at all.

---

## 6. Verification and phased plan

### 6.1 Success criterion — the greps, and why the obvious one is not enough

The standard criterion is "grep for the package name returns only the ACL directory". Here it
**already passes today** (§1.1), so it proves nothing. The criterion for this dependency is four
greps, each of which must return only `src/lib/adapters/supabase/` and `src/db/database.types.ts`:

```bash
# 1. the package itself — passes today (2 files), must keep passing
grep -rn --include='*.ts' --include='*.tsx' --include='*.astro' "@supabase/" src

# 2. the generated schema — today: src/lib/supabase.ts, src/types.ts
grep -rn --include='*.ts' --include='*.tsx' --include='*.astro' "db/database.types" src

# 3. the client object — today: 4 files, 18 occurrences
grep -rn --include='*.ts' --include='*.tsx' --include='*.astro' "TypedSupabaseClient" src

# 4. the schema's vocabulary in application code — today: 10 islands, 2 schema files, 2 services
grep -rnE --include='*.ts' --include='*.tsx' --include='*.astro' \
  "is_active|duration_min|is_closed|opens_at|closes_at|vehicle_type|workshop_id|starts_at|ends_at|service_id|bay_id|first_name" \
  src/components src/pages src/lib/services src/lib/schemas
```

Plus one for the folded-in `Date` rule (`AGENTS.md:14`) — must return only `workshop-clock.ts` and
`src/domain/wall-clock.ts`:

```bash
grep -rnE --include='*.ts' --include='*.tsx' --include='*.astro' "new Date\(|Date\.UTC|Intl\.DateTimeFormat" src | grep -v '\.test\.'
```

**Baseline, measured today** (run from the repo root, `.test.` lines excluded):

| grep                                                 | today                                                                                          | target                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1 · `@supabase/`                                     | 2 lines, 2 files                                                                               | unchanged, both under `adapters/supabase/` |
| 2 · `db/database.types`                              | 2 lines (`lib/supabase.ts:4`, `types.ts:1`)                                                    | 1 line, in `adapters/supabase/mappers.ts`  |
| 3 · `TypedSupabaseClient`                            | 18 lines, 4 files                                                                              | 0 outside the adapter                      |
| 4 · column vocabulary                                | **93 lines** — `src/lib/services` 50, `src/components` 26, `src/lib/schemas` 16, `src/pages` 1 | 0 outside the adapter                      |
| 5 · `new Date(` / `Date.UTC` / `Intl.DateTimeFormat` | 12 lines outside `workshop-clock.ts`                                                           | 0                                          |

Grep 4 is the honest measure of this leak: **93 occurrences of database column names in application
code**, against 2 occurrences of the package's own name. That ratio is the finding.

A `dependency-cruiser` rule makes it permanent rather than a habit —
`.dependency-cruiser.cjs` is already installed (`package.json:58`, `dependency-cruiser@^18.2.0`; the config file `.dependency-cruiser.cjs` already exists at the repo root):

```js
{ name: "domain-must-not-know-supabase",
  severity: "error",
  from: { path: "^src/(domain|components|pages)/" },
  to:   { path: "^(node_modules/@supabase|src/db/database\\.types)" } }
```

### 6.2 Phases

Each phase is independently shippable and independently revertible, and no phase mixes a wire change
with a refactor — the convention `context/changes/refactor-opportunities/plan.md` uses.

| #   | Phase                                                                                                                                                   | Proof                                                                                                       |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `src/domain/` value objects + `NaiveWallClock`, with unit tests. Nothing imports them yet.                                                              | `npm test`; new files only, `git diff --stat` touches no existing module                                    |
| 2   | Adapter + mappers under `src/lib/adapters/supabase/`, with round-trip tests (`row → domain → Update → row`). Still unused.                              | mapper tests; greps 1–3 unchanged                                                                           |
| 3   | Ports defined; `services/workshop-setup.ts` and `services/appointments.ts` retyped to take a port. `App.Locals` swap in `middleware.ts` + `env.d.ts`.   | `npm run typecheck`; `npm test`; E2E green — **no wire change yet**, so `e2e/*.spec.ts` must pass untouched |
| 4   | Routes map responses through the adapter — the eight raw-row bodies of §3.2 become DTOs. Islands updated in the same phase, because it is one contract. | E2E green; grep 4 returns nothing under `src/components`                                                    |
| 5   | Delete `src/types.ts:18-26`; add the `dependency-cruiser` rule and wire it into `npm run lint`.                                                         | all five greps clean; `npx depcruise src` exits 0                                                           |
| 6   | `DayPlanBoard.tsx:48` and `schemas/day-plan.ts:17` move to `weekdayOf()`; tighten `STARTS_AT_PATTERN`.                                                  | the `Date` grep returns two files; `AGENTS.md:14` becomes true                                              |

**Ordering against `02-invariant-aggregate-refactor.md`.** That plan moves the serviceable-slot
invariant into a `security definer` guardian function raising `WG001`–`WG006`, and needs a SQLSTATE
→ domain-error table on the TypeScript side (`:363-390`). **Do phases 1–3 here first**: the adapter's
`errors.ts` is the file that table belongs in. Running the invariant plan first would create that
mapping inside `services/appointments.ts` and then move it, for no gain.

### 6.3 Names to register

`docs/reference/contract-surfaces.md` should gain: `NaiveWallClock`, `OpeningWindow`,
`WorkshopCatalogPort`, `SchedulePort`, `src/lib/adapters/supabase/` (as _the_ boundary), and the
`domain-must-not-know-supabase` rule name.

---

## Summary

The dependency that leaks worst in this repository is the **Supabase/PostgREST generated schema**,
and it hides from the grep everyone would run first: `@supabase/*` appears in exactly two files
(`src/lib/supabase.ts:1`, `src/env.d.ts:3`), so by the usual success criterion the SDK looks already
contained. It travels under a different name — `src/db/database.types.ts` flows through
`src/types.ts:18-26`, which re-exports eight database rows and enums as the project's domain
vocabulary, and from there into **6 of 6 layers and 25 production files**, including ten React
islands that read `is_closed`, `duration_min` and `starts_at` directly and hand-build request bodies
out of column names — 93 lines of application code speak the database's vocabulary, against 2 that
name the package. Eight of the eleven JSON success responses in `src/pages/api/` are a raw
PostgREST row carrying `workshop_id`, `customer_id` and `created_at`, which makes `npm run db:types`
— correctly mandated by `AGENTS.md:11` for persistence — a load-bearing step in the application's
public HTTP contract: any migration on those five tables silently rewrites the wire and the browser
props, with no layer that has to agree. The honest complication is that **no document ever promised
Supabase would be replaceable** (`tech-stack.md:24` chose the coupling deliberately), so the case for
this ACL rests on present boundary damage, not on hypothetical vendor swap; the one isolation promise
the repository _does_ make in writing is about `Date` (`AGENTS.md:14`) and it is broken in four
places, which this plan folds in as a `NaiveWallClock` branded type rather than treating as a
separate refactor. The design is a `src/domain/` of value objects with `workshop_id`/`created_at`
absent by construction and `OpeningWindow` as a union that makes the "open but no hours" state
unrepresentable, two narrow ports (`WorkshopCatalogPort`, `SchedulePort`) that replace passing
`TypedSupabaseClient` into eleven service functions, and a single `src/lib/adapters/supabase/`
directory that owns the row mapping plus the two contract decisions currently guessed at twice each
— PostgREST's timestamp separator and the `23P01`/`PGRST###` error-code namespaces. None of it
touches `supabase/migrations/`, the RLS policies or the pgTAP suite, which is the isolation proof.
The pattern is not new to this codebase: `WireSlot` and `DayPlanEntry` already do exactly this for
the two endpoints that happen to have DTOs, and `wizyty/[id].astro` renders a whole screen without a
single database identifier — the refactor is extending that to the four entities the settings slice
skipped, in six phases that must run before the invariant plan of
`02-invariant-aggregate-refactor.md`, whose SQLSTATE table belongs in the adapter this one creates.
