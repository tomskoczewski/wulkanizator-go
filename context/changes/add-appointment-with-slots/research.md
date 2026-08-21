---
date: 2026-08-21T08:59:05+02:00
researcher: tomaszskoczewski
git_commit: 9dc8c83789197a49d5859ee8e844fed1f767527d
branch: main
repository: wulkanizator-go
topic: "Library options for S-02 slot suggestions, and whether a library is needed at all"
tags: [research, external, scheduling, slot-suggestions, postgres, timezone, S-02]
status: complete
last_updated: 2026-08-21
last_updated_by: tomaszskoczewski
---

# Research: Library options for S-02 slot suggestions, and whether a library is needed at all

**Date**: 2026-08-21T08:59:05+02:00
**Researcher**: tomaszskoczewski
**Git Commit**: 9dc8c83789197a49d5859ee8e844fed1f767527d
**Branch**: main
**Repository**: wulkanizator-go

## Research Question

Which libraries could implement S-02 (`add-appointment-with-slots` — free-slot suggestions) compatibly with `context/foundation/tech-stack.md`, and do we actually need a library, or is a hand-written algorithm simpler?

**Method**: external research via `web_search_exa` (library discovery, Postgres exclusion-constraint patterns, Workers `Intl` support), plus npm registry + GitHub API for maintenance signals, plus light codebase grounding on the S-01 schema and `src/lib/` layout. This is **not** a full `/10x-research` parallel-sub-agent sweep of the codebase — it is a build-vs-buy decision record.

## Summary

**Recommendation: do not add a slot-suggestion library.** Write ~80 lines in `src/lib/services/`, and put the real correctness guarantee in Postgres.

Three findings drive this:

1. **No candidate library clears the tech-stack quality gates.** `tech-stack.md` selected this stack partly on "popular in training data, well-documented". The two best functional matches sit at 124 and 51 weekly downloads. The only candidate with real usage (`slot-calculator`, 12.8k/week) has been unmaintained since 2024-04 and drags in Luxon — a real bundle cost on Cloudflare Workers.
2. **A library only covers one of the four steps in S-02.** Every candidate models a **single** resource's busy list. Wulkanizator GO schedules across 1–5 bays (`bays` table), so the fan-out, merge, and ranking — plus resolving `working_hours` and the wall-clock→UTC conversion — are ours either way.
3. **The roadmap's stated risk (`roadmap.md:121`) is not solvable in application code at all.** Only a Postgres `EXCLUDE USING gist` constraint closes the concurrent-double-booking window. That is where the effort belongs.

| Decision | Verdict |
| --- | --- |
| Slot-suggestion library | **No** — ~80 lines of our own, zero deps, Workers-friendly, unit-testable |
| `tstzrange` + `EXCLUDE USING gist` on `appointments` | **Yes, mandatory** — the actual correctness guarantee |
| `@date-fns/tz` for wall-clock → UTC | **Yes, recommended** — one small, well-known dep; removes a bug class |
| Luxon / dayjs / `temporal-polyfill` | **No** — bundle cost we don't need at the edge |

## Detailed Findings

### Candidate libraries (external, via exa)

| Package | Weekly DL | Stars | Last publish | Runtime deps | Assessment |
| --- | --- | --- | --- | --- | --- |
| `scheduling-sdk` | 124 | 57 | 2025-11-19 | none | Best fit on paper: busy-times → free slots, timezone-aware daily windows (`timezone`, `earliestTime`, `latestTime`), weekly availability patterns. MIT, zero-dep, ESM+CJS. But single-author, near-zero adoption; README credits Claude for the docs. |
| `timeslottr` | 51 | 1 | 2026-08-05 | none | Closest API match: `subtract(availability, busy)`, `intersect`, per-weekday `Map`, `slotIntervalMinutes`, `maxSlots`, half-open `[start, end)` semantics, DST-aware. MIT, zero-dep. 1 GitHub star — effectively unproven. |
| `slot-calculator` | 12,823 | 15 | 2024-04-18 | `luxon`, `fast-deep-equal` | Only candidate with real adoption, but 2+ years unmaintained and pulls Luxon (~70 kB) into a Workers bundle. |
| `time-slots-finder` | 200 | — | 2022-04-14 | `dayjs`, `ical2json` | Abandoned. Ships an iCal parser we would never use. |
| `@verevoir/bookings` | 13 | — | 2026-08-05 | `rrule` | Recurrence-focused — solves a problem S-02 does not have. |
| `intervals-fn` / `interval-operations` / `time-range-utils` / `ts-date-range` | low | — | 2017–2025 | none | Generic interval set-ops only (`union`/`intersect`/`subtract`/`merge`). They provide the *smallest* part of the job and none of the domain shape. |

All are JS/TS and therefore stack-compatible in principle (`language_family: js`, npm, Workers). Compatibility was never the blocker — **maintenance risk and poor problem fit are**.

### Why the fit is poor: S-02 decomposes into four steps, a library covers one

1. **Resolve the day's window** — read the `working_hours` row for the weekday; `opens_at`/`closes_at` are Postgres `time` (local wall-clock), `is_closed` short-circuits. *No library does this — it's our schema.*
2. **Convert local wall-clock → UTC instants** — Workers runs UTC; the workshop is Europe/Warsaw with DST. *Only the Luxon-backed candidates help, at bundle cost.*
3. **Per bay: subtract busy appointments from the window, slide a `duration_min` cursor.** *← the only step a library covers; ~25 lines.*
4. **Fan out across N bays (1–5), merge, sort by start, cap at K, tag each slot with `bay_id`.** *No candidate models multiple resources — every one takes a single busy list.*

### The algorithm (proposed, ~80 lines)

Target: `src/lib/services/slot-suggestions.ts` — pure, synchronous, zero-dep, unit-testable in isolation from Supabase.

```ts
type Interval = { start: Date; end: Date }; // half-open [start, end)

export function suggestSlots(input: {
  bays: { id: string; name: string }[];        // is_active only
  busyByBay: Map<string, Interval[]>;          // appointments, status not in (cancelled, no_show)
  window: Interval;                            // today's opens_at..closes_at, already in UTC
  durationMin: number;                         // services.duration_min
  earliest: Date;                              // now()
  stepMin?: number;                            // 15 — grid granularity
  limit?: number;                              // 10 — see Open Questions
}): { bayId: string; bayName: string; start: Date; end: Date }[] {
  const step = (input.stepMin ?? 15) * 60_000;
  const dur = input.durationMin * 60_000;
  const out = [];

  for (const bay of input.bays) {
    const busy = [...(input.busyByBay.get(bay.id) ?? [])].sort((a, b) => +a.start - +b.start);
    // cursor walks the window, jumping past each busy block it collides with
    let t = Math.max(+input.window.start, +input.earliest);
    t = Math.ceil(t / step) * step;                                   // snap to the grid
    while (t + dur <= +input.window.end) {
      const hit = busy.find((b) => t < +b.end && t + dur > +b.start); // overlap test
      if (hit) { t = Math.ceil(+hit.end / step) * step; continue; }   // jump, don't scan
      out.push({ bayId: bay.id, bayName: bay.name, start: new Date(t), end: new Date(t + dur) });
      t += step;
    }
  }
  return out.sort((a, b) => +a.start - +b.start || a.bayName.localeCompare(b.bayName))
            .slice(0, input.limit ?? 10);
}
```

Half-open `[start, end)` throughout, matching the DB constraint below: a 10:00–11:00 job sits directly against an 11:00–12:00 job with no false conflict.

### The DB-level guarantee (mandatory)

`roadmap.md:121` names this the slice's core risk: "two appointments at the same bay at the same time = a regression worse than paper", and calls for validation at both the zod boundary and the DB. Research confirms only the DB closes the concurrency window — a check-then-insert in the API route loses to two simultaneous requests.

```sql
create extension if not exists btree_gist;

alter table public.appointments
  add constraint appointments_no_overlap_per_bay
  exclude using gist (
    bay_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status not in ('cancelled', 'no_show'));
```

- `btree_gist` is what allows mixing the `=` equality co-key (`bay_id`) with the `&&` range-overlap operator in one GiST index. Without it, only the range column may participate.
- The `'[)'` bound is what makes back-to-back appointments legal.
- The partial `where` clause implements S-04's "`no-show` releases the slot" (`roadmap.md:140`) for free, while keeping the row in history.
- **Error handling**: catch SQLSTATE `23P01` in the API route and translate to a generic user-facing message (e.g. "Ten termin jest już zajęty"). The raw constraint-violation `DETAIL` includes the conflicting row's key and is produced **before** RLS filtering — passing it through leaks another row's data. Never forward the raw `DETAIL` to the client.

### Timezone handling

`src/` currently has **no** timezone handling at all — no `Intl.*`, no `timeZone`, no `Europe/Warsaw` anywhere, and no date library in `package.json`. S-02 introduces the need: `working_hours.opens_at` is wall-clock local, appointments will be `timestamptz`, and Workers runs UTC.

- `Intl.DateTimeFormat` **is** available on Workers with IANA time-zone names (confirmed: Cloudflare "JavaScript and web standards" docs list `Intl`). But it only goes instant → local parts. The inverse — "09:00 on 2026-10-25 in Europe/Warsaw" → instant — needs the two-pass offset trick, which is a classic bug source.
- **`@date-fns/tz`** (31M weekly downloads, zero deps, tiny): `new TZDate(2026, 7, 21, 9, 0, "Europe/Warsaw")` and done. ← recommended
- `temporal-polyfill` (2.8M/week) is more principled with explicit DST disambiguation, but a bigger bundle for a problem we barely have.
- **Mitigating fact**: Poland's DST switches at 02:00–03:00 on a Sunday, outside every plausible working window (S-01 default 7:00–18:00). No slot this algorithm generates is ever DST-ambiguous. So `@date-fns/tz` is a cheap correctness insurance policy, **not** a blocker — the slice could ship without it.

## Code References

- `supabase/migrations/20260815183000_workshop_configuration.sql:21-57` — `bays`, `services`, `working_hours`; the header comment already anticipates "S-02's slot-suggestion algorithm reads" these.
- `supabase/migrations/20260815183000_workshop_configuration.sql:26` — `bays.is_active` (soft delete): the slot search must filter on it.
- `supabase/migrations/20260815183000_workshop_configuration.sql:35` — `services.duration_min int not null` with a `> 0` check — the algorithm's duration input.
- `supabase/migrations/20260815183000_workshop_configuration.sql:44-46` — `working_hours.opens_at`/`closes_at` as nullable `time`, plus `is_closed` — the window source; nullable when closed.
- `supabase/migrations/20260815183000_workshop_configuration.sql:49` — `working_hours_weekday_range check (weekday between 0 and 6)` — weekday convention to match when resolving "today".
- `supabase/migrations/20260814235519_role_and_workshop_scope.sql` — the RLS pattern `appointments` must follow verbatim (`workshop_id` + `current_workshop_id()` + `current_user_role()`).
- `src/lib/schemas/workshop-setup.ts:43-50` — existing zod pattern for `HH:MM` time strings (`TIME_HH_MM` regex, cross-field `.refine`); the S-02 schema should mirror it.
- `src/lib/services/workshop-setup.ts` — the service-layer shape to follow for `slot-suggestions.ts`.
- `package.json` — no date/time dependency present today; `zod ^4.4.3` available for the API boundary.

## Architecture Insights

- **The AGENTS.md service/schema split fits this cleanly**: pure slot math in `src/lib/services/slot-suggestions.ts` (no Supabase import, fully unit-testable), Supabase reads in a thin caller, zod validation in `src/lib/schemas/`.
- **Defence in depth matches the roadmap's stated design**: zod at the API boundary rejects malformed input; the suggestion algorithm avoids proposing conflicts; the exclusion constraint is the only thing that *guarantees* it. Treat the first two as UX and the third as correctness.
- **Zero runtime dependencies is a Workers-specific virtue.** Bundle size is a live constraint at the edge, which is what makes the Luxon-backed candidates a bad trade for ~25 lines of saved interval arithmetic.
- **Half-open intervals must be consistent** across the TS algorithm, the zod schema, and the SQL constraint. Mixing inclusive and half-open bounds between layers is the likeliest source of an off-by-one that shows up as a phantom conflict at exactly the back-to-back boundary — the most common case in a tire workshop.
- **New dependency added late.** `exa-js ^2.18.1` is in `dependencies` (commit `e57f8eb`) though it is a tooling concern, not app runtime — unrelated to S-02 but worth noticing if bundle size is audited.

## Historical Context (from prior changes)

- `context/archive/2026-08-15-workshop-setup/plan.md` — S-01 established the three configuration tables this slice reads, and the owner-only write / workshop-scoped read RLS split that `appointments` should inherit.
- `context/archive/2026-08-15-workshop-setup/plan.md:33,40` — **useful precondition**: `handle_new_user()` (`security definer`) seeds every new workshop with six services, one bay, and Pon–Sob working hours. So the slot search will never meet a workshop with zero bays or no `working_hours` rows — but it *can* meet a day with `is_closed = true`, which must return an empty suggestion list with a clear message rather than an error.
- `context/archive/2026-08-15-role-and-workshop-scope/plan.md` — the `current_workshop_id()` / `current_user_role()` scope-helper contract; `roadmap.md:135` warns that S-03 is where a drifting `workshop_id` derivation would surface, so `appointments.workshop_id` must be derived the same way.
- `context/archive/2026-08-15-design-system-foundation/plan.md` — F-02 screen mapping; S-02's UI reference is `AddVisitScreen` (brochure `src/App.jsx:402`) for the slot-suggestion chips, plus `MobilePreview` (`src/App.jsx:876`).

## Related Research

None — this is the first `research.md` in the repo (`find context -name research.md` returns nothing).

## Open Questions

1. **Slot cap** — `roadmap.md:120` leaves "is the number of suggested slots capped (nearest 5? 10?)" open. This research resolves it mechanically: it is the `limit` parameter. **Recommendation: default 10.** Owner: user. Block: no.
2. **"Add now" for walk-ins** — `roadmap.md:119` leaves this open. Falls out cheaply: insert with `starts_at = now()` and let the exclusion constraint arbitrate. Owner: user. Block: no.
3. **Adopt `@date-fns/tz` or hand-roll the wall-clock conversion?** Recommendation: adopt (one small dep, removes a bug class). Not a blocker either way — see Timezone handling. Owner: user. Block: no.
4. **Grid granularity (`stepMin`)** — the algorithm assumes a 15-minute grid for slot starts. Not specified in the PRD or roadmap. Owner: user. Block: no.
5. **Bay eligibility per service** — `bays.vehicle_type` exists (`20260815183000_workshop_configuration.sql:25`) but nothing maps services to compatible bays. MVP assumption: **every active bay can perform every service**. If wrong, the algorithm needs a filter and the schema needs a mapping. Owner: user. Block: **yes for the plan's data model** — decide before `/10x-plan`.
6. **Change-id mismatch** — this folder is `add-appointment-with-slot` (singular) but `roadmap.md:35` and the Backlog Handoff table use `add-appointment-with-slots` (plural). `/10x-archive` matches on Change ID, so the roadmap row will not flip to `done` unless one side is renamed. Owner: user. Block: no (but cheap to fix now).
