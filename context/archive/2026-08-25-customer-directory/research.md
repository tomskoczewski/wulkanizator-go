---
date: 2026-08-25T01:06:18+02:00
researcher: tomaszskoczewski
git_commit: 8a93fe2914ef6123e80e8e6ac6bc9c2e08fcc9bf
branch: main
repository: tomskoczewski/wulkanizator-go
topic: "S-05 Customer directory — customers + cars, list/search, and linking an existing customer to a booking"
tags: [research, codebase, customers, cars, rls, search, ui, s-05]
status: complete
last_updated: 2026-08-25
last_updated_by: tomaszskoczewski
---

# Research: S-05 Customer directory

**Date**: 2026-08-25T01:06:18+02:00
**Researcher**: tomaszskoczewski
**Git Commit**: `8a93fe2914ef6123e80e8e6ac6bc9c2e08fcc9bf` (clean, `main` in sync with `origin/main`)
**Branch**: `main`
**Repository**: `tomskoczewski/wulkanizator-go`

> Permalink base for any `path:line` below:
> `https://github.com/tomskoczewski/wulkanizator-go/blob/8a93fe2914ef6123e80e8e6ac6bc9c2e08fcc9bf/<path>#L<line>`

## Research Question

What does the codebase already contain, and what conventions must be followed, to implement roadmap slice **S-05 `customer-directory`** (`context/foundation/roadmap.md:153-164`): *"the owner browses, adds, edits, and searches customers; each customer has a phone number + one or more cars (make, model, plate). When adding an appointment (S-02), an existing customer can be selected instead of typed as a walk-in."*

Scope confirmed with the user before research:
- **Include the S-02 retrofit** — how existing walk-in customer storage reconciles with a real directory.
- **Practical survey** on search implementation — what the repo supports today, cheapest workable approach, final call left to `/10x-plan`.

## Summary

**The headline: `customers` is not a new table. It already exists**, created in S-02 (`supabase/migrations/20260821090000_appointments_and_customers.sql:25-33`) with exactly the walk-in minimum — `first_name` + `phone` — and `appointments.customer_id` is already a `not null` FK to it. This was deliberate. S-02's plan states the reason verbatim (`context/archive/2026-08-21-add-appointment-with-slots/plan.md:776-777`):

> S-05 will extend `customers` additively (last name, cars, search) rather than migrating data, which is the reason the table exists in this slice rather than denormalized columns on `appointments`.

So the feared retrofit — un-denormalizing customer strings off `appointments` — **does not exist**. There is nothing to migrate. But three real inherited problems replace it:

1. **`book_appointment()` unconditionally INSERTs a new customer row on every booking** (`supabase/migrations/20260821150000_book_appointment_ownership_check.sql:42-44`). Its signature takes `p_first_name`/`p_phone`, not a `customer_id`. There is currently **no path** to attach an appointment to an existing customer — the core of S-05's outcome requires changing this RPC's signature.
2. **There is no dedupe.** No unique constraint on `(workshop_id, phone)`, and every booking mints a fresh row. By the time the directory ships, `customers` will contain duplicates — including *orphans*, because S-02's 409-retry loop leaks a customer row per attempt. S-02's plan-review flagged this and named S-05 as the inheritor (`context/archive/2026-08-21-add-appointment-with-slots/reviews/plan-review.md:68-79, 94`).
3. **`customers` has no UPDATE grant and no UPDATE policy**, and no table in the schema has a DELETE grant. The migration comment names this slice as the owner of the fix (`supabase/migrations/20260821090000_appointments_and_customers.sql:65-66`): *"`customers` gets no UPDATE grant either — that lands with S-05's edit UI."*

Beyond the data layer, three findings shape the work:

- **`cars` is genuinely new.** No cars/vehicles table exists. The only vehicle-ish column anywhere is `bays.vehicle_type text`, which is unrelated.
- **The app has no search infrastructure of any kind.** Zero occurrences of `.ilike()`, `.textSearch()`, `.or()`, `.range()`, `.limit()` across `src/`. No `pg_trgm`, no `gin`, no `tsvector`, no expression index. No debounce hook. No search input in any screen. This is greenfield.
- **The nav entry already exists as a disabled placeholder.** `src/layouts/AppShell.astro:22` is `{ icon: Users, label: "Klienci" }` with no `href`; `"Klienci"` is already in the `NavKey` union. Shipping the directory is a one-line change there.

Two scope tensions surfaced that the plan must resolve explicitly — see [Open Questions](#open-questions): **who can read/write the directory** (PRD says owner-only; S-02 already granted SELECT to workers), and **how far the brochure's customer card is allowed to be replicated** (it renders tire storage and visit history, both of which the roadmap risk line and the parked S-06 rule out).

---

## Detailed Findings

### 1. Data model — what exists today

#### `customers` (S-02) — `supabase/migrations/20260821090000_appointments_and_customers.sql:25-33`

```sql
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops (id) on delete cascade,
  first_name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

create index customers_workshop_id_idx on public.customers (workshop_id);
```

No `last_name`, no `updated_at`, no soft-delete flag, no unique constraint. `src/types.ts:25` already exports `export type Customer = Database["public"]["Tables"]["customers"]["Row"];` — currently referenced nowhere.

#### `appointments` link — `supabase/migrations/20260821090000_appointments_and_customers.sql:36-48`

`customer_id uuid not null references public.customers (id) on delete restrict`. The `on delete restrict` matters: it means a customer with any appointment cannot be hard-deleted, which is consistent with the schema-wide no-DELETE posture but forecloses cleanup of the orphan rows described above.

#### Workshop-scoped table conventions (what `cars` must copy)

Distilled from `supabase/migrations/20260815183000_workshop_configuration.sql:32-56`:

- `id uuid primary key default gen_random_uuid()`
- `workshop_id uuid not null references public.workshops (id) on delete cascade` — cascade for the workshop FK; `on delete restrict` for intra-workshop FKs (`customer_id`, `service_id`, `bay_id`)
- `created_at timestamptz not null default now()`
- **`updated_at` does not exist on any table, and there is no `updated_at` trigger anywhere.** Adding one to `customers` would be a new convention, not an existing one.
- One index per table: `<table>_workshop_id_idx on public.<table> (workshop_id)`
- Constraint naming `<table>_<rule>`: `services_duration_min_positive`, `working_hours_weekday_range`, `appointments_ends_after_starts`
- Soft delete via `is_active boolean not null default true` (`bays`, `services`). No DELETE grant or policy exists on any table in the schema.

**Open design point for `cars`:** it must carry `workshop_id` (the AGENTS.md hard rule) *in addition to* `customer_id`, because every RLS policy scopes on `public.current_workshop_id()`. That is a denormalization the schema already accepts elsewhere.

### 2. RLS — the exact pattern, and the gap S-05 must close

Current `customers` policies, verbatim (`supabase/migrations/20260821090000_appointments_and_customers.sql:68-82`):

```sql
alter table public.customers enable row level security;
grant select, insert on public.customers to authenticated;

create policy customers_select_own_workshop on public.customers
  for select to authenticated
  using (workshop_id = public.current_workshop_id());

create policy customers_insert_owner on public.customers
  for insert to authenticated
  with check (workshop_id = public.current_workshop_id() and public.current_user_role() = 'owner');
```

Note **SELECT is role-blind** — a worker can read customers, because the day plan shows customer names. This is the source of the access-control tension in Open Questions #1.

Conventions to follow:
- Policy naming `<table>_<operation>_<scope>`: `_select_own_workshop`, `_insert_owner`, `_update_owner`
- **Never `for all`** — one policy per operation
- **Grants mirror policies exactly.** From `supabase/migrations/20260814235519_role_and_workshop_scope.sql:76-78`: *"Postgres checks table privileges before RLS, so an operation with no grant is denied before RLS is even consulted."* An absent grant is the primary deny mechanism. S-01's plan states the rule as (`context/archive/2026-08-15-workshop-setup/plan.md:77`): *"Every new table's `grant` line must list exactly the operations that have a `create policy` below it — and no more."*
- `anon` gets no explicit deny policies — deny is structural (every policy `to authenticated`, grants only `to authenticated`, and `execute` on the scope helpers revoked from `public, anon` at `20260814235519:61-65`)
- Column-level grants are established precedent when a narrow write surface is wanted: `grant update (status) on public.appointments to authenticated;` (`supabase/migrations/20260821151500_appointments_update_status_only.sql:10-11`)

Scope helpers (`supabase/migrations/20260814235519_role_and_workshop_scope.sql:41-65`) — `public.current_workshop_id()` and `public.current_user_role()`, both `stable security definer set search_path = ''`, execute revoked from `public, anon`.

### 3. The `book_appointment()` RPC — the load-bearing change

Current definition, `supabase/migrations/20260821150000_book_appointment_ownership_check.sql:13-59`:

```sql
create or replace function public.book_appointment(
  p_first_name text, p_phone text, p_service_id uuid, p_bay_id uuid,
  p_starts_at timestamp, p_ends_at timestamp
) returns public.appointments
language plpgsql security definer set search_path = ''
as $$
declare
  v_workshop_id uuid; v_customer_id uuid; v_appointment public.appointments;
begin
  v_workshop_id := public.current_workshop_id();
  if v_workshop_id is null then raise exception 'no workshop resolved for current user'; end if;
  if public.current_user_role() <> 'owner' then raise exception 'only an owner may book an appointment'; end if;
  if not exists (select 1 from public.bays where id = p_bay_id and workshop_id = v_workshop_id) then
    raise exception 'bay does not belong to this workshop'; end if;
  if not exists (select 1 from public.services where id = p_service_id and workshop_id = v_workshop_id) then
    raise exception 'service does not belong to this workshop'; end if;

  insert into public.customers (workshop_id, first_name, phone)
  values (v_workshop_id, p_first_name, p_phone)
  returning id into v_customer_id;

  insert into public.appointments (workshop_id, customer_id, service_id, bay_id, starts_at, ends_at)
  values (v_workshop_id, v_customer_id, p_service_id, p_bay_id, p_starts_at, p_ends_at)
  returning * into v_appointment;

  return v_appointment;
end;
$$;
```

Four things bind any change to it:

1. **The unconditional customer INSERT is the thing S-05 must make conditional.** Either a new `p_customer_id uuid default null` parameter (insert only when null) or a second function. Changing the signature requires a new migration — `20260821150000_book_appointment_ownership_check.sql` is the precedent for amending it via `create or replace`, followed by `npm run db:types`.
2. **The ownership checks are non-negotiable.** They exist because S-02's impl-review found them missing (`context/archive/2026-08-21-add-appointment-with-slots/reviews/impl-review.md:24-36`, F1, CRITICAL). A `p_customer_id` parameter needs the *same* treatment: `if not exists (select 1 from public.customers where id = p_customer_id and workshop_id = v_workshop_id) then raise exception …`. Skipping it is a cross-workshop data leak in a `security definer` function that bypasses RLS.
3. **The transactional guarantee is asserted by a pgTAP test** — an exclusion violation on the appointment insert rolls the customer insert back, so a lost race leaves no orphan (`supabase/tests/rls_workshop_scope.test.sql:497-527`).
4. The revoke/grant pair (`revoke execute … from public, anon; grant execute … to authenticated;`) is the established convention for every RPC.

Call chain today: `src/components/appointments/NewAppointmentForm.tsx:105-107` → `src/pages/api/appointments/index.ts:14` → `src/lib/schemas/appointment.ts:17-18` → `src/lib/services/appointments.ts:197-198` → RPC.

### 4. API / service / schema conventions

#### There are no GET endpoints in this codebase

Every read is done **server-side in `.astro` frontmatter** via a service function and passed to a React island as props. `src/pages/dashboard.astro:8-12` is the reference:

```astro
const { profile, supabase } = Astro.locals;
const today = workshopTodayDateString();
const date = resolveDayParam(Astro.url.searchParams.get("data"));
const plan = supabase ? await getDayPlan(supabase, date) : null;
```

Client-side `fetch()` is used **only for interaction-driven data**, never for first paint (`src/components/appointments/NewAppointmentForm.tsx:83` fetches slots after a service is picked). This is directly relevant to search: the established precedent for a server-side list param is a **plain `<a href="?param=">` link + a zod resolver in `src/lib/schemas/`** (`resolveDayParam`, used by the date stepper at `DayPlanBoard.tsx:130-155`), *not* a fetch endpoint.

#### API route anatomy — `src/pages/api/appointments/index.ts:1-40`

- `export const prerender = false;` immediately after imports
- `if (!locals.supabase) return Response.json({ error: "Supabase is not configured" }, { status: 503 });` as the first statement
- **Routes never read `locals.profile` and never touch `workshop_id`** — RLS + `current_workshop_id()` handle scoping, role gating is entirely the middleware route table
- `const body: unknown = await request.json().catch(() => null);` then `schema.safeParse(body)` — never `parse()`
- Path params validated **before** the body: `z.uuid().safeParse(params.id)` (`src/pages/api/appointment-status/[id].ts:13`)
- Two error shapes, and the distinction is load-bearing for `useJsonMutation`:
  - field validation → `{ errors: flattenError(parsed.error).fieldErrors }` + `400`
  - everything else → `{ error: "<message>" }` + `400/404/409/500/503`
- Success returns the bare entity, no envelope: `201` create, `200` update
- **Routes never inspect Supabase error codes.** Services translate them into a discriminated-union outcome; the route `switch`es exhaustively (`src/pages/api/appointment-status/[id].ts:27-42`)
- **No shared response helper exists** — every route hand-rolls `Response.json`

Note `src/pages/api/appointments/index.ts:23-24`: raw constraint DETAIL is deliberately never forwarded, *because it is produced before RLS filtering and can leak another workshop's data*. **The same reasoning applies to any unique-violation on a future `(workshop_id, phone)` constraint.**

#### Zod conventions — `src/lib/schemas/workshop-setup.ts`

- `<entity><Verb>Schema` → `z.infer` → `<Entity><Verb>Input`, types grouped at file bottom
- Separate Create and Update schemas; every Update ends with `.refine((val) => Object.keys(val).length > 0, { message: "Brak pól do zaktualizowania" })`
- Field names are **snake_case, mirroring DB columns** — the wire contract is the DB shape
- `.trim()` universal on strings; **no `z.coerce.*` anywhere**; uuids are `z.string().trim().pipe(z.uuid("…"))`
- **Validation messages are Polish; infrastructure errors are English.** The split tracks user-facing vs developer-facing.
- **Phone has no format validation today** — `z.string().trim().min(1, "Telefon jest wymagany")` (`src/lib/schemas/appointment.ts:18`), column is plain `text not null`. No normalization, no E.164. The brochure mock stores phones with spaces (`'500 600 700'`, `'22 123 45 67'`), which is a live problem for phone search.
- No shared primitives file — the uuid pattern is copy-pasted per field
- No `.max()` on any text field anywhere. S-01's impl-review noted this as accepted at MVP scale (`context/archive/2026-08-15-workshop-setup/reviews/impl-review.md:221`).

#### Service layer — `src/lib/services/`

| Module | DB? | Test |
|---|---|---|
| `appointments.ts` | yes | `appointments.test.ts` |
| `workshop-setup.ts` | yes | **none** |
| `day-plan.ts` | pure | `day-plan.test.ts` |
| `appointment-transitions.ts` | pure | `appointment-transitions.test.ts` |
| `slot-suggestions.ts` | pure | `slot-suggestions.test.ts` |

- Supabase client is always the **first positional parameter**, typed `TypedSupabaseClient`
- **`workshop_id` is never a parameter.** RLS handles reads; inserts resolve it via a private `currentWorkshopId(supabase)` helper calling `supabase.rpc("current_workshop_id")` (`src/lib/services/workshop-setup.ts:52-56`)
- Two return conventions: **ordinary CRUD throws** (`if (error) throw error; return data;`, route's try/catch → 500); **domain operations with expected failure modes return a discriminated union** (`BookOutcome`, `StatusChangeOutcome`). Rationale at `src/lib/services/appointments.ts:318-319`.
- `.single()` for must-exist, `.maybeSingle()` for may-not-exist — the latter deliberate so RLS makes "wrong workshop" and "doesn't exist" indistinguishable (`appointments.ts:287-288`)
- Join select strings hoisted to a module const and reused: `DAY_PLAN_SELECT` at `appointments.ts:216-217`, with a hand-written row interface and a snake→camel mapper that **drops (with `console.warn`) rather than throws** on a null join
- `workshop-setup.ts` — the closest analog to customer CRUD — **has no unit test at all**; its DB behavior is covered by pgTAP

#### Auth guard — `src/lib/auth-guard.ts:10-21`

```ts
const ROUTE_ACCESS: readonly [prefix: string, access: AccessLevel][] = [
  ["/dashboard", "any"],
  ["/ustawienia", "owner"],
  ["/wizyty", "any"],
  ["/wizyty/nowa", "owner"],
  ["/api/workshop", "owner"],
  ["/api/bays", "owner"],
  ["/api/services", "owner"],
  ["/api/working-hours", "owner"],
  ["/api/appointments", "owner"],
  ["/api/appointment-status", "any"],
];
```

- `AccessLevel = "any" | "owner" | "worker"`. Unlisted paths are implicitly public.
- Longest-prefix wins, computed by `reduce` — array order is irrelevant
- Matching is **segment-aware**: `pathname === prefix || pathname.startsWith(\`${prefix}/\`)`, so `/klienci/<uuid>` is covered by a `/klienci` entry automatically, and a stricter child (`/klienci/nowy`, owner-only) is added as its own longer entry — exactly the `/wizyty` + `/wizyty/nowa` pair
- `/api/*` guard failures answer `401 Unauthorized` / `403 Forbidden` JSON, never a redirect (`src/middleware.ts:52-62`)
- `locals.profile` is camelCase and hand-mapped: `{ workshopId, workshopName, role }` (`src/middleware.ts:44-48`, typed at `src/env.d.ts:1-7`)

### 5. Search — practical survey

**Precedent in this repo: none.** Confirmed by exhaustive grep across `src/`:

| Capability | Occurrences |
|---|---|
| `.ilike()` | 0 |
| `.textSearch()` | 0 |
| `.or()` | 0 |
| `.range()` / `.limit()` | 0 |
| `.order()` | 4, all plain single-column |
| Search input in any screen | 0 |
| Debounce hook | 0 |

Index inventory — **all six indexes in the schema are `workshop_id` B-trees** (or `(workshop_id, starts_at)`). No `pg_trgm`, no `gin`, no `tsvector`, no functional index. The only non-B-tree machinery is `btree_gist` (`20260821090000:13`) for the appointments exclusion constraint, pulled in with the established `create extension if not exists` form.

The two idioms the repo *does* have, either of which S-05 can extend:

1. **Server-side list param via plain links + a zod resolver.** The date stepper: `<a href={\`/dashboard?data=${prevDate}\`}>` → `resolveDayParam(Astro.url.searchParams.get("data"))` in the page frontmatter (`src/lib/schemas/day-plan.ts`, `src/pages/dashboard.astro:11`). A `?q=` search would be the direct analog — no new endpoint, no fetch, no debounce, works without JS.
2. **Client-side filtering of an already-loaded array.** `countByStatus` / `filterByStatus` as pure functions in `src/lib/services/day-plan.ts:44-59`, applied inside the island, tested in `day-plan.test.ts`.

**Practical read for the plan:** at a per-workshop scale of hundreds of customers (the brochure mock says "428 klientów"), option 2 — load the workshop's customers server-side and filter client-side with a pure, unit-tested `filterCustomers()` — is the cheapest approach that gives real signal, needs no new index, no new extension, no debounce hook, and matches both the existing filter-pill pattern and the "no GET endpoints" architecture. Option 1 layered on top (`?q=` in the URL for shareable/back-button state) costs one zod resolver. `ilike` + `pg_trgm` only becomes necessary at a scale this product explicitly does not target (PRD: workshops with 1–5 bays).

Two normalization problems that are real regardless of approach, and that belong in a pure tested function:
- **Phone**: stored as free text, entered with spaces. Searching `"500600700"` must match `"500 600 700"`. Strip non-digits on both sides.
- **Plate**: the roadmap specifies plate as a car field; case and spacing vary (`WA 1234A` vs `wa1234a`). Same treatment.

### 6. UI — what exists, what's missing

#### shadcn/ui is effectively absent

`src/components/ui/` contains **exactly two files**: `button.tsx` (standard shadcn) and `LibBadge.astro` (a starter-template leftover, unrelated to the app's design language).

**ABSENT:** input, card, dialog, sheet, table, form, label, select, command/combobox, popover, badge, skeleton, alert, tabs, separator, dropdown-menu, toast/sonner — all of them.

The only Radix package installed is `@radix-ui/react-slot` (for Button's `asChild`). So `command`, `popover`, `dialog`, `select` would each pull **new dependencies**, not just files.

More important: **the app's visual language diverges from shadcn defaults.** shadcn renders against `oklch` neutral CSS variables in `src/styles/global.css:6-39` (`--primary: oklch(0.205 0 0)`, near-black), while every real screen uses hardcoded `slate`/`orange` + `font-black`. The one shadcn component in use is immediately overridden at its call site (`src/components/auth/SubmitButton.tsx:15-19`); the `variant` prop is never used anywhere in the app. **Adding shadcn components for a typeahead picker would be swimming against the codebase, not with it.** The in-repo precedent for a popover/menu without Radix is the hand-rolled `src/components/UserMenu.tsx` (useState + useRef + mousedown-outside + Escape).

Also: `global.css` defines a `.dark` block, but **no dark mode is implemented** — no toggle, no `.dark` class applied.

#### Forms: plain `useState`, no react-hook-form, no client-side zod, no toasts

Zero hits across `src/` and `package.json` for `react-hook-form`, `sonner`, `Toaster`, `toast`, `debounce`. Zod is **server-only**; the client consumes flattened server errors keyed by field name (`src/components/hooks/useJsonMutation.ts:10-13`).

- Submit: `<form onSubmit>` with `preventDefault()`, or `<button type="button" onClick={() => void handleSubmit()}>`
- Pending: a boolean + `disabled:opacity-50`, from `useJsonMutation().isPending` or `useFormStatus()`
- Errors, three tiers: field-level (`text-xs font-semibold text-rose-600` + `border-rose-400` on the input), form-level (`<p className="mt-4 text-xs font-semibold text-rose-600">`), row-level (keyed `rowErrors[id]` with `role="status" aria-live="polite"`)
- **Success replaces the form with a success card**, it does not toast (`NewAppointmentForm.tsx:144-163`)
- **There is no modal/dialog anywhere in the app.** The add-new pattern is an inline expanding form (`ServiceDurations.tsx`, `showAddForm` state) behind a dashed-border button: `mt-4 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 py-3 text-xs font-black text-slate-600`

#### `useRowMutation` is the pattern for editable list rows

`src/components/hooks/useJsonMutation.ts` exports `requestJson`, `firstFieldError`, `useJsonMutation`, and `useRowMutation`. The last one exists **because S-01 shipped the naive version and it broke** — see Historical Context below. For editing cars on a customer card, `useRowMutation` is the exact precedent (keyed pending/error state, functional per-row rollback, `onFailure` returning `true` to suppress rollback on a 409 carrying true server state).

#### The nav entry already exists

`src/layouts/AppShell.astro:22`:

```ts
{ icon: Users, label: "Klienci" },
```

No `href`, so it renders through the disabled-`<button>` branch (`:81-90`). Adding `href: "/klienci"` enables it; `"Klienci"` is already in the `NavKey` union (`:8`), so no type change. Active state is an **explicit prop**, not URL matching (`active === label`), and sub-pages inherit their section's key — a customer detail page passes `active="Klienci"`.

Two things to wire outside the layout: a `["/klienci", <access>]` entry in `ROUTE_ACCESS`, and optionally `ctaLabel`/`ctaHref` for a header "Dodaj klienta" button (role-gated at the call site, as `dashboard.astro:19` does).

**Mobile nav: there is none.** The rail is `hidden … md:flex`. Below `md` there is no navigation beyond the header lockup and account menu.

#### Styling idioms actually in use

- Cards: `rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100` (rows/small), `rounded-[24px] … p-5` (page-level). Never `border` on a card — always `ring-1`. Clickable rows hover `hover:ring-orange-200`.
- Inner surfaces: `rounded-xl bg-slate-50 p-3`
- Buttons: primary `rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-black text-white`; dark `bg-slate-900`; tertiary `border border-slate-200 bg-white hover:bg-slate-50`; disabled `disabled:opacity-50`
- Inputs (repeated inline, no component): `w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400`
- Typography: `font-black` for anything structural; sizes almost entirely `text-xs`/`text-sm`
- Icons: `lucide-react`, sized numerically (`size={16}`), not via Tailwind classes
- **Enum badges follow the `StatusPill` pattern**: a `Record<EnumType, {label, pillClasses}>` in `src/lib/` (`src/lib/appointment-status.ts:9-26`) consumed by a dumb component (`src/components/appointments/StatusPill.tsx`) — exhaustive so a new enum member breaks the build
- Empty state: a centered card with a **context-aware explanation of why it's empty**, never an illustration (`DayPlanBoard.tsx:196-200`)
- Loading: no skeletons exist. Data arrives server-rendered; in-flight is a text line or `aria-busy` + opacity.
- **100% of user-facing strings are Polish; 100% of identifiers/comments are English.** Routes are Polish nouns (`/ustawienia`, `/wizyty/nowa`), so **`/klienci`** is the consistent choice.
- The **stretched-link pattern** is documented at `DayPlanBoard.tsx:213-215` — an absolutely-positioned `<a className="absolute inset-0 z-0">` with action buttons at `z-10`, because a `<button>` inside an `<a>` is invalid HTML. **A customer row that is both clickable and carries "Zadzwoń" / "Otwórz kartę" buttons must copy this.**

#### Island boundary

Only `client:load` is used anywhere — no `client:visible`, `client:idle`, or `client:only`. Server data is passed as props named `initial*` and seeded into `useState`. One documented gotcha (`AppointmentStatusPanel.tsx:23-29`): `astro-island` renders with `display: contents`, so an island's top-level blocks become direct grid items — explicit `xl:col-start`/`xl:row-start` are needed rather than relying on DOM order.

### 7. Brochure reference (the near-1:1 UI authority)

Per `context/foundation/lessons.md:26-31`, the actual brochure screens — not the token summary — are the authority. Fetched from the private repo at `tomskoczewski/wulkanizator-go-brochure`; **line numbers had not drifted** from what `design-system.md` records.

#### `ClientsScreen` (`App.jsx:537-576`)

Structure: `AppShell active="Klienci" title="Baza klientów" cta ctaLabel="Dodaj klienta"` — **the shell CTA is the only add-customer affordance**, no in-content button, no FAB. Below it a header row (`h2` "Klienci" + subtitle *"Telefon, auto, opony i historia bez CRM-owego chaosu."*) with a count chip "428 klientów" on the right.

The search control is a **static mock, not an `<input>`** — a white pill with a `Search` icon and a grey `<span>`: *"Szukaj po nazwisku, telefonie, aucie…"*. Note it says **car** (`aucie`), not plate. There is no focus/typing/clear styling to copy — only the container:

```
mb-3 flex items-center gap-3 rounded-xl bg-white px-4 py-2.5 shadow-sm ring-1 ring-slate-100
```

List is a card grid `grid gap-3 xl:grid-cols-2`. Row hierarchy: name (`text-sm font-black text-slate-900`) → meta line of two icon+text pairs (`Phone` + phone, `Car` + car) → top-right grey pill carrying **tire-storage status** → muted last-visit line → two buttons ("Zadzwoń" outlined, "Otwórz kartę" dark). No filter/sort/tabs. No empty state.

Mock data (`App.jsx:106-111`) is a positional tuple array `[name, phone, car, storage, last]`:

```jsx
const clients = [
  ['Jan Kowalski',    '500 600 700',  'Skoda Octavia', 'Opony u nas',        'Ostatnia wizyta: 12.11.2025'],
  ['Anna Nowak',      '601 222 333',  'Toyota Yaris',  'Brak przechowalni',  'Ostatnia wizyta: dziś'],
  ['Firma XYZ',       '22 123 45 67', 'BMW 3',         '3 auta w bazie',     'Ostatnia wizyta: dziś'],
  ['Marek Wiśniewski','730 111 222',  'Audi A4',       'Opony u nas',        'Ostatnia wizyta: 18.10.2025'],
]
```

Three signals from this shape:
- **One full-name string, not first/last split** — and `'Firma XYZ'` shows a company can be a customer, so a *mandatory* surname field is wrong. This collides with the roadmap's "search by last name" and with the existing `first_name` column.
- List view shows **one** car per row while the profile shows **two** — so the row displays a primary/only car and the card shows the full set.
- The storage chip is really a free-text highlight slot the designer overloaded (`'3 auta w bazie'` in row 3).

#### `CustomerProfileScreen` (`App.jsx:578-626`)

`AppShell active="Klienci" title="Karta klienta" cta ctaLabel="Umów wizytę"`. Layout `grid gap-4 xl:grid-cols-[300px_1fr]`.

**Left rail, card 1 (identity):** a 56×56 orange rounded-square avatar (`UserRound` icon), name as `h2`, phone as a bold grey line. No email, address, or tags. Two full-width stacked buttons: dark "Zadzwoń", orange "Dodaj wizytę".

**Left rail, card 2 (cars):** heading "Auta klienta" (plural — multiple cars confirmed), then grey pills, one per car. Each car string is **`make model · tire size`** — `'Skoda Octavia · 205/55 R16'`. **No registration plate anywhere in the mock.** No add-car affordance.

**Right column:** "Opony w przechowalni" (emerald callout, single tire set) and "Historia usług" (three `[date, service, status]` rows with `StatusPill`, including a *future* visit — so it's upcoming + past, not just past).

**There is no back navigation** — no `ChevronLeft`, no breadcrumb; the brochure relies on the sidebar. A "← Wróć do listy" link must be invented, and `src/pages/wizyty/[id].astro:60-64` is the in-repo precedent (`text-xs font-black text-orange-600`).

#### What the brochure shows that S-05 must NOT build

Measured against the roadmap risk line (`roadmap.md:163`) — *"a customer card easily grows into visit history, notes, tags. Hold the minimum: customer + cars + simple search by last name / phone / plate"*:

| Brochure element | Verdict | Why |
|---|---|---|
| "Opony w przechowalni" card | **Out** | S-06 tire-storage, **parked** 2026-08-21. No table backs it. Building it re-opens a deliberately parked slice. |
| Storage chip on every list row | **Out** | Same S-06 dependency. No data source in S-05. |
| "Historia usług" card | **Out** | Named verbatim in the S-05 risk line as scope creep. Cheaper than the others (appointments already exist — it's a query, not a new table), but explicitly excluded. |
| "Ostatnia wizyta: …" on list rows | **Out** | Lighter form of the same creep; mock value is prose with relative dates ("dziś"), implying a formatter. |
| "428 klientów" count chip | **Out** | A stat block. Also interacts badly with search — count of what, all or filtered? |
| "Dodaj wizytę"/"Umów wizytę" | **Optional** | Cross-slice nav into S-02. S-05's outcome names the *list→booking* direction (pick a customer while booking), not card→booking. Polish, not a requirement. |
| "Zadzwoń" | **Optional, near-free** | A `tel:` link. Precedent exists at `AppointmentStatusPanel.tsx:107`. |

**In scope and safe to copy:** page header + subtitle, search pill, card-grid list with name/phone/car hierarchy, "Otwórz kartę" action, shell-level "Dodaj klienta" CTA, and the profile's identity card + "Auta klienta" list.

**Two gaps the brochure does not cover, which S-05 must invent:**
- **Registration plate.** The roadmap specifies make/model/**plate**; the brochure renders make/model + **tire size** (S-06 vocabulary). The `·` separator transfers; the second segment becomes the plate.
- **Add/edit affordances.** The brochure has no edit button, no add-car button, no customer form screen, and no empty state.

### 8. Testing expectations

`vitest.config.ts` is minimal (alias only, node environment, no setup files, no jsdom, no `@testing-library/react`).

Conventions: `import { describe, expect, it, vi } from "vitest";` (no globals, `it` never `test`), `describe` is the bare function name, `it` strings are **English, behavioral, no "should"**, fixture *data* is Polish domain data. Fixtures are small local overrides-factories at the top of the file, not shared files. DB access is mocked in exactly one place — `appointments.test.ts` hand-stubs the query builder, with a doc comment (`:5-13`) explaining when that's acceptable.

pgTAP: a single file, `supabase/tests/rls_workshop_scope.test.sql` (649 lines), `select plan(54)` at `:11` — **must be incremented for every assertion S-05 adds**. Key patterns to copy:
- `pg_temp.authenticate_as(uuid)` (`:15-22`) for role switching
- A denied UPDATE is a *zero-row* result, not an exception → needs `GET DIAGNOSTICS` (`:60-71`); a denied INSERT *does* throw → `throws_ok` with `42501`
- Because `seed.sql` creates no customers, counts are asserted as **baseline + 1** via a `pg_temp.baseline` temp table (`:308-330`)
- Typical budget: ~5-7 assertions per table. `customers` has 4 today; gaining UPDATE plus a `cars` table plausibly adds 10-14.

**`npm run db:test` is local-only** — it is not in `.husky/pre-push` and not in CI (which runs lint + test + typecheck + build). A broken RLS assertion will not be caught by a push or a PR.

`supabase/seed.sql` creates **zero customers and zero appointments**. On a fresh `db:reset`, a customer directory renders empty until someone books through the app. If S-05 wants a demoable directory, seed rows are new work — and note the pgTAP suite hard-asserts the seeded shape (`:181-197`, `:247-263`), so seed changes and `plan(N)` move together.

### 9. Migration workflow

```
db:reset  → supabase db reset
db:test   → supabase test db
db:types  → truncate header + supabase gen types typescript --local >> src/db/database.types.ts
```

`.husky/pre-push` regenerates and diffs `src/db/database.types.ts`, failing the push on drift — but **skips silently (exit 0) if the local stack is down**, so the guarantee is best-effort. It also leaves the regenerated file in the working tree on success.

---

## Code References

**Schema / DB**
- `supabase/migrations/20260821090000_appointments_and_customers.sql:25-33` — the existing `customers` table
- `supabase/migrations/20260821090000_appointments_and_customers.sql:36-48` — `appointments`, with `customer_id` FK
- `supabase/migrations/20260821090000_appointments_and_customers.sql:65-82` — `customers` grants/policies, and the comment deferring UPDATE to S-05
- `supabase/migrations/20260821150000_book_appointment_ownership_check.sql:13-59` — the RPC S-05 must change
- `supabase/migrations/20260821151500_appointments_update_status_only.sql:10-11` — column-level grant precedent
- `supabase/migrations/20260815183000_workshop_configuration.sql:32-56` — the workshop-scoped table template
- `supabase/migrations/20260814235519_role_and_workshop_scope.sql:41-65` — `current_workshop_id()` / `current_user_role()`
- `supabase/migrations/20260815183100_seed_workshop_defaults.sql:13-84` — `seed_workshop_defaults()` + `handle_new_user()`
- `supabase/tests/rls_workshop_scope.test.sql:11` — `plan(54)`; `:15-22` auth helper; `:308-330` baseline pattern; `:497-527` orphan-rollback assertion

**App layer**
- `src/lib/auth-guard.ts:10-21` — the route table
- `src/middleware.ts:44-62` — `locals.profile` shape and the `/api/*` 401/403 branch
- `src/env.d.ts:1-7` — `App.Locals` declaration
- `src/types.ts:25` — `Customer`, already exported and unused
- `src/pages/api/appointments/index.ts:1-40` — API route reference implementation
- `src/lib/services/workshop-setup.ts:1-114` — the CRUD service reference
- `src/lib/services/appointments.ts:197-198` — the booking RPC call site
- `src/lib/services/appointments.ts:216-246` — join select const + snake→camel mapper
- `src/lib/services/day-plan.ts:44-59` — pure filter/count functions (the search-filter precedent)
- `src/lib/schemas/workshop-setup.ts:1-57` — zod conventions
- `src/lib/schemas/day-plan.ts` — `resolveDayParam`, the URL-param resolver precedent

**UI**
- `src/layouts/AppShell.astro:22` — the inert "Klienci" nav item
- `src/pages/dashboard.astro` — the list-screen template
- `src/pages/wizyty/[id].astro` — the detail-screen template (uuid guard, `Astro.rewrite("/404")`, back-link)
- `src/components/appointments/DayPlanBoard.tsx:165-193` — filter pills; `:213-215` stretched-link pattern
- `src/components/appointments/NewAppointmentForm.tsx:70-71, 105-107, 232-264` — the walk-in fields S-05 must extend with a customer picker
- `src/components/hooks/useJsonMutation.ts` — `requestJson` / `useJsonMutation` / `useRowMutation`
- `src/components/UserMenu.tsx` — hand-rolled dropdown, the no-Radix popover precedent
- `src/lib/appointment-status.ts:9-26` + `src/components/appointments/StatusPill.tsx` — the enum-badge pattern
- `src/components/settings/ServiceDurations.tsx:60` — the dashed "add new" button + inline expanding form

## Architecture Insights

1. **RLS is the scoping mechanism, not application code.** No service takes a `workshop_id`; no route reads `locals.profile`. The only place `workshop_id` is written is a `security definer` RPC or an insert resolving it via `rpc("current_workshop_id")`. Any new S-05 code that passes a workshop id around is drifting.

2. **`security definer` functions bypass RLS, so they re-implement their own guards.** `book_appointment()` checks workshop, role, and every FK's ownership — because the impl-review caught it not doing so. A `p_customer_id` parameter inherits that obligation.

3. **Grants are the primary deny mechanism; policies are the refinement.** "No grant" is how DELETE is denied schema-wide. S-05 adding UPDATE means adding *both* a grant and a matching policy, and nothing more.

4. **The app is server-rendered-first with narrow interaction islands.** No GET endpoints, no client-side initial fetch, no query library. A "search endpoint" would be the first of its kind — the grain of the codebase is a page-level server query plus either a URL param or client-side filtering of the loaded array.

5. **Error handling is a two-layer contract**: services classify (throw for unexpected, discriminated union for expected), routes map to HTTP shapes (`{errors}` vs `{error}`), and the client's `useJsonMutation` keys off exactly that distinction. Breaking either half breaks inline field errors.

6. **The design system is hand-rolled Tailwind, not shadcn.** Reaching for `command`/`popover`/`dialog` adds dependencies *and* a visual language the app then has to override at every call site. The customer picker is likely better built as a filtered list of the existing chip/card selection idioms (`NewAppointmentForm.tsx:198-221` slot chips, `:268-289` service grid) than as a Radix combobox.

7. **Business logic gets extracted to a pure module with a colocated test.** `slot-suggestions.ts`, `day-plan.ts`, `appointment-transitions.ts` — all pure, all tested, all with the I/O living in a sibling. Search normalization and matching belong in exactly that shape.

## Historical Context (from prior changes)

- **`context/archive/2026-08-21-add-appointment-with-slots/plan.md:776-777`** — the customers table exists *specifically* so S-05 extends additively rather than migrating. `plan-brief.md:36` records the same as a Key Decision.
- **`.../plan.md:108-110`** — "No customer directory, search, or cars. S-05 owns them." This also dropped the brochure's **"Auto"** cell from the booking form (`App.jsx:437-440`) — S-05 is where it comes back.
- **`.../plan.md:210-212`** — grants deliberately withheld: "`customers` update lands with S-05's edit UI."
- **`.../reviews/plan-review.md:68-79`** (F2) — the 409-retry loop leaks a customer row per attempt, and the no-DELETE decision forecloses cleanup. `:94`: *"Blind spot: A delete policy on `customers` is a surface S-05 inherits."*
- **`.../reviews/impl-review.md:24-36`** (F1, CRITICAL, fixed) — `book_appointment()` must verify FK ownership; the pattern any new `security definer` work must copy.
- **`context/archive/2026-08-15-workshop-setup/plan.md`** — the CRUD-slice template, five phases: schema+RLS+types+pgTAP → service+zod+routes+guard → shell → screen → ship. Types are regenerated *inside* the schema phase; pgTAP is written in the same phase as the migration; each phase ends with automated + manual criteria and a pause-for-confirmation note.
- **`.../reviews/impl-review.md`** — 7 warnings, all fixed, and they read as a checklist of what a CRUD list screen gets wrong: unguarded field-error indexing (F1), whole-list snapshot rollback corrupting concurrent row edits (F2 — this is why `useRowMutation` exists), child state seeded from props never re-syncing after rollback (F3), an invariant living only in zod and not the schema (F4), unvalidated text format producing a 500 instead of a 400 (F5), `.single()` on an RLS-filtered row producing a 500 where 404 was correct (F8).
- **Ship sequence** (`context/archive/2026-08-21-add-appointment-with-slots/plan.md:677-698`) — the 7-step numbered order for a slice carrying a migration: clean tree on a feature branch → full from-scratch verification → `npx supabase db push` → verify in the production dashboard → hand-test the constraint → merge and let the auto-deploy run → verify on production. **S-05 ships a migration, so this applies.** Note `context/deployment/deploy-plan.md:156`: `wrangler rollback` reverts the Worker only, never the DB.
- **`context/foundation/prd.md:89-90`** (FR-009 Socratic resolution) — *"wizyta musi być możliwa BEZ karty klienta (walk-in). Karta klienta to opcja, nie wymóg."* **Hard constraint: S-05 must not make the customer card mandatory in the booking flow.**
- **`context/foundation/prd.md:100`** — GDPR baseline explicitly names *"telefony, numery rejestracyjne, dane aut"* as protected, accessible only when logged in and within the workshop.
- **Tracker**: GitHub **#6** `[S-05] Customer directory with cars` is **open**, labels `type:slice` + `stream:c-customer`, milestone MVP, body carries `- [ ] Depends on #3 (S-02)`. Linear mirror **TOM-10**. ⚠️ **Drift**: #2 (S-01), #3 (S-02), #4 (S-03), #5 (S-04) are all still open despite being archived — contradicting `context/foundation/lessons.md:19-24`. S-05's ship phase should close #6/TOM-10 and is a good moment to reconcile the stale ones.

## Related Research

- `context/archive/2026-08-21-add-appointment-with-slots/research.md` — the only prior `research.md` in the archive. Covers slot-suggestion libraries and timezone handling; **contains no customer-data findings**, so this document is the first research pass on the directory.

## Open Questions

1. **Who can read and write the customer directory?** `context/foundation/prd.md:114` lists "baza klientów" under **owner** permissions only. But S-02 already granted `customers` SELECT to *both* roles, role-blind, because the day plan renders customer names (`supabase/migrations/20260821090000:71-74`). So the read side is already open to workers and cannot be narrowed without breaking the day plan. The live decision is narrower: **does a worker get the `/klienci` route** (`"any"` vs `"owner"` in `ROUTE_ACCESS`)? Writes are unambiguously owner-only per the established `_insert_owner` / `_update_owner` pattern. *Owner: user. Blocks: the route-table entry and the nav item's visibility filter — small, but it must be decided before Phase 2.*

2. **What is the customer's name shape?** The column today is `first_name text not null`. The roadmap says search "by last name". The brochure mock uses **one full-name string**, and one of its four rows is a company (`'Firma XYZ'`) — so a mandatory `last_name` is wrong. Three options: keep `first_name` and add nullable `last_name`; rename to a single `name`/`display_name` (a migration touching S-02's RPC, the day-plan select, and three components); or add nullable `last_name` and treat the pair as a display name. *Owner: user. Blocks: the migration, so it must be decided in Phase 1.*

3. **What happens to the duplicate and orphan customer rows already in production?** Every booking since S-02 minted a new row, and every 409 retry leaked one. The directory will surface them. Options: ship as-is and let the owner live with duplicates; add a `(workshop_id, phone)` unique constraint (which requires deduping existing rows first *and* changes `book_appointment` failure modes — note the "never forward raw constraint DETAIL" rule at `src/pages/api/appointments/index.ts:23-24`); or add dedupe-by-phone inside the RPC (an upsert-shaped lookup before insert). *Owner: user. Blocks: Phase 1 schema and the RPC change. This is the single highest-risk decision in the slice.*

4. **Does linking an existing customer change `book_appointment()`'s signature, or add a second function?** Amending in place (`create or replace` with `p_customer_id uuid default null`) keeps one code path and one invariant — consistent with S-02's own resolved Unknown ("every appointment goes through a suggested slot, keeping one code path"). A second function duplicates the ownership guards, which is where S-02's CRITICAL finding came from. *Recommendation: amend in place. Owner: plan.*

5. **Is a car required to create a customer?** The roadmap says "each customer has a phone number + one or more cars", but FR-009's resolution insists the card must never slow the walk-in path — and `book_appointment` creates customers with no car at all, so **zero-car customers already exist by construction**. The schema almost certainly wants `cars` to be optional (no minimum), with "one or more" as a UI expectation rather than a constraint. *Owner: plan, but worth confirming with the user.*

6. **Does OQ-2 block this slice?** `context/foundation/roadmap.md:200` and `context/foundation/tasks-github.md:51` record that open question #9 ("Are revenue and forecast reports part of the MVP?") **blocks S-05 if answered yes**. It is still open. The roadmap's own recommendation given `main_goal: speed` is to park it. *Owner: user. Non-blocking in practice — parking it is a one-line roadmap edit — but it should be closed rather than left ambiguous.*

7. **Does the customer directory need seed data?** `supabase/seed.sql` creates zero customers, so `/klienci` renders its empty state on every fresh `db:reset`. Demoing the search requires either seed rows (which interact with the pgTAP `plan(N)` and the seeded-shape assertions) or booking several appointments by hand. *Owner: plan.*
