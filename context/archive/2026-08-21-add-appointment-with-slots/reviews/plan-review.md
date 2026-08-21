<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Add Appointment with Free-Slot Suggestions (S-02)

- **Plan**: `context/changes/add-appointment-with-slots/plan.md`
- **Mode**: Deep
- **Date**: 2026-08-21
- **Verdict**: REVISE → **SOUND** after triage (all 6 findings fixed in the plan)
- **Findings**: 1 critical, 4 warnings, 1 observation

## Verdicts

| Dimension | Verdict (at review) | After fixes |
|-----------|---------------------|-------------|
| End-State Alignment | PASS | PASS |
| Lean Execution | WARNING | PASS |
| Architectural Fitness | WARNING | PASS |
| Blind Spots | FAIL | PASS |
| Plan Completeness | WARNING | PASS |

## Grounding

14/14 existing paths ✓, 7/7 symbols ✓ (`ROUTE_ACCESS`, `current_workshop_id` RPC, `useJsonMutation`,
`TIME_HH_MM`, `plan(26)`, `AppShell` `ctaLabel`/`ctaHref`, brochure `App.jsx:402-473`), brief↔plan ✓,
Progress↔Phase 40/40 steps ✓ (43/43 after fixes).

Verified inline rather than by sub-agent: migration references (`20260815183000_workshop_configuration.sql`,
`20260814235519_role_and_workshop_scope.sql`), the RLS grant/policy pattern, `src/middleware.ts`'s
`/api/*` 401/403 JSON branch, `matchRoute`'s longest-prefix semantics, `bayUpdateSchema`, and
`src/components/settings/Bays.tsx`. Blast radius on the plan's edited symbols is minimal —
`ROUTE_ACCESS` has one consumer (`src/middleware.ts:52`) and nothing in `src/`, `README.md` or
`AGENTS.md` references `/wizyty` today. `docs/reference/contract-surfaces.md` does not exist in this
project, so the contract-surface check was skipped.

## Findings

### F1 — Booking trusts client `bay_id`/`starts_at` with no server-side re-check

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Blind Spots
- **Location**: Phase 3 §2 (Appointment service — *Book*)
- **Detail**: The plan's three-layer defence left layer 2 purely advisory. `book` took `bay_id` and
  `starts_at` from the request, derived `ends_at`, and inserted. The exclusion constraint rejects only
  *overlaps* — it knows nothing about `working_hours`, `is_closed`, or `bays.is_active`. Concrete
  failure: chips load on `/wizyty/nowa`; the owner (or a second session) then deactivates a bay or
  shortens closing time on `/ustawienia` — verified reachable, `src/components/settings/Bays.tsx:24`
  PATCHes `{ is_active: false }` with no minimum-one guard. The stale chip still books. The row lands
  on an inactive bay, holds the exclusion constraint, and is invisible on S-03's bays × time grid —
  the "worse than paper" failure this slice exists to prevent, arriving through the one door left
  open. A hand-crafted POST books 03:00 on a closed Sunday just as easily.
- **Fix A ⭐ Recommended**: Re-run the suggest path inside `book`
  - Strength: Before the insert, re-fetch the same inputs and confirm `(bay_id, starts_at)` appears in
    a freshly-computed `suggestSlots` result; if not, return the 409 + fresh slots outcome Phase 3
    already specifies. One code path, one definition of "bookable".
  - Tradeoff: Doubles the suggest read on every booking (4 small queries against a 1–5 bay workshop).
  - Confidence: HIGH — reuses code the same file must contain anyway.
  - Blind spot: `earliest = now` means a slot chosen 40s ago at the window edge could fall out; the
    book path needs a small grace on `earliest`.
- **Fix B**: Narrow `assertBookable()` predicate checking bay `is_active` + window containment
  - Strength: Cheaper, and no "slot vanished because a minute passed" edge.
  - Tradeoff: Two definitions of bookable that can drift apart.
  - Confidence: MEDIUM — doesn't catch off-grid starts, only the window/bay classes.
  - Blind spot: Grid alignment stays unenforced server-side.
- **Decision**: FIXED via Fix A — Phase 3 §2 gains a "Re-validate the slot before inserting"
  paragraph (re-runs fetch + `suggestSlots`, returns the same 409 + fresh-slot outcome, relaxes
  `earliest` by one `stepMin`). New manual criterion + Progress step 3.11.

### F2 — The 409-retry loop leaks a `customers` row per attempt, and Phase 1 forecloses the cleanup

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architectural Fitness
- **Location**: Phase 3 §2 (non-transactional inserts) + Phase 1 §1 (grants)
- **Detail**: `book` inserted `customers` then `appointments`; on `23P01` the customer row survives.
  The plan called this "an orphan customer row (harmless, invisible until S-05)" — but Phase 4
  *designs a retry* on 409 ("keep the typed customer data"), so every lost race leaves a duplicate and
  Manual Testing Step 5's two-tab test leaves two. It is a routine path, not an exceptional one.
  Worse, Phase 1 states "No `delete` grant or policy on either", so the compensating cleanup is ruled
  out by the plan's own schema decision. S-05 builds the customer directory on exactly this table.
- **Fix A ⭐ Recommended**: One `security definer` `book_appointment()` RPC
  - Strength: A single function call runs in one implicit transaction, so a `23P01` inside rolls the
    customer insert back — the atomicity the plan deferred to "later". The repo already ships this
    pattern (`current_workshop_id()`, `seed_workshop_defaults()`), so it is not a new concept.
  - Tradeoff: More SQL in the migration; the "service layer follows `workshop-setup.ts` exactly" shape
    bends for this one call.
  - Confidence: HIGH — established pattern, and it also removes the atomicity caveat from Open Risks.
  - Blind spot: `security definer` bypasses RLS — the owner/workshop check must move into the function
    body, and pgTAP must prove a worker still can't call it.
- **Fix B**: Keep two inserts, add a `delete` grant + owner policy for best-effort cleanup
  - Strength: Smallest diff from the plan as written; no new RPC.
  - Tradeoff: Opens a `delete` surface Phase 1 deliberately closed, and cleanup still fails if the
    request dies between calls.
  - Confidence: MEDIUM — it narrows the leak without closing it.
  - Blind spot: A delete policy on `customers` is a surface S-05 inherits.
- **Decision**: FIXED via Fix A — `public.book_appointment(...)` specified in Phase 1 §1 (in-body
  owner/workshop guard, `search_path = ''`, `23P01` propagated, `execute` to `authenticated` only);
  Phase 3 §2 rewritten to call `supabase.rpc()`; two pgTAP assertions added (worker rejected; no
  orphan customer after a lost race); `plan-brief.md` Open Risks updated to match.

### F3 — "Zero active bays" called unreachable; S-01 shipped the button that reaches it

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State Analysis (`:29-33`), Phase 2 §4 last test case
- **Detail**: The plan said seeding means "the algorithm will therefore never meet a workshop with
  zero bays" and filed the zero-bay test as "defensive; unreachable in practice". True for *rows*,
  false for *active* rows — which is what the algorithm filters on. `src/components/settings/Bays.tsx:24`
  plus `bayUpdateSchema` (`src/lib/schemas/workshop-setup.ts:14-20`) let an owner deactivate every
  bay. The consequence isn't a crash: it's an empty chip list indistinguishable from "fully booked",
  with nothing telling the owner the actual cause.
- **Fix**: Drop the "unreachable in practice" claim. Add a distinct empty reason to Phase 3's *Suggest*
  contract (`no_active_bays` / `closed_all_week` / `no_slots`) that Phase 4 renders as a specific
  Polish message, and add a manual verification row for it.
- **Decision**: FIXED — Current State Analysis corrected; *Suggest* now returns
  `{ slots, emptyReason }`; `slots.ts` response shape updated; Phase 4 renders a per-reason message
  pointing at `/ustawienia` where the fix is the owner's; new criterion + Progress step 3.12.

### F4 — Phase 4 never rules on the brochure's "Auto" field or the header slot badge

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 4 §2, criterion 4.5
- **Detail**: The brochure's `md:grid-cols-2` block holds four cells — Godzina, Telefon, Klient,
  **Auto** (`App.jsx:437-440`) — and the card header carries a `09:30–10:15` slot badge
  (`App.jsx:410`). The plan enumerated what to replicate and explicitly omitted only "Opony"/"Notatka"
  (`:456-467`), while "What We're NOT Doing" bars cars (S-05). So `Auto` was out of scope but unnamed —
  the implementer builds a dead field or drops it silently. Meanwhile criterion 4.5 read "layout,
  spacing and colour match side by side", which has no pass condition once three blocks are removed.
- **Fix**: Name `Auto` alongside Opony/Notatka in "What We're NOT Doing"; state the 2-up grid becomes
  Godzina + Telefon + Klient (imię); decide the header slot badge; reword 4.5 to scope the comparison.
- **Decision**: FIXED — all four edits applied; the field grid is fixed at three cells (Godzina
  read-only, Telefon, Klient as a real input), the header badge renders the selected slot's span and
  is hidden until a chip is chosen, and 4.5 now names the three deliberate omissions.

### F5 — Critical Implementation Details endorses `Date.getDay()`; Phase 2 specifies `getUTCDay()`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: `:137-141` vs Phase 2 §2 (`:305-307`)
- **Detail**: Phase 2 defines the workshop clock as returning "a `Date` whose UTC fields hold local
  wall-clock values, so `getUTCDay()` yields the Postgres `dow` weekday directly". On that
  representation `getDay()` reads the *runtime's* zone — UTC on Workers — and produces exactly the
  00:30-Warsaw-Monday-is-Sunday-in-UTC bug the same paragraph warns about. The section an implementer
  opens for the gotcha named the accessor that causes it.
- **Fix**: Replace "JavaScript's `Date.getDay()` uses the same convention" with `getUTCDay()` on the
  naive `Date` from `workshop-clock.ts`, and state that `getDay()`/`getHours()` are banned on these
  values.
- **Decision**: FIXED — Critical Implementation Details now names `getUTCDay()` explicitly and bans
  the local-field accessors on any naive `Date` in this slice.

### F6 — Phase 5's roadmap-sync step is already done

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 5 §2, criterion 5.8
- **Detail**: `context/foundation/roadmap.md:35` and `:122` already read `planning`, and both S-02
  Unknowns at `:119-120` are already struck through with the resolutions the plan asks for (the file
  is uncommitted in `git status`). The step and its verification row were no-ops as written.
- **Fix**: Reduce Phase 5 §2 to "commit the already-applied roadmap edits and bump frontmatter
  `updated:`", or drop 5.8.
- **Decision**: FIXED — Phase 5 §2 reduced accordingly, noting that the flip to `done` is
  `/10x-archive`'s job; criterion 5.8 and Progress step 5.8 reworded to match.

## Post-fix verification

Progress↔Phase contract re-checked mechanically after the edits: one `## Progress` heading, 5 phase
headings matched 1:1 with the plan body, all 43 Success Criteria bullets mapped to numbered Progress
steps (Phase 1: 5+3, Phase 2: 4+1, Phase 3: 4+8, Phase 4: 4+6, Phase 5: 4+4), zero stray checkboxes
in phase bodies.

## Notes carried forward

- F2's RPC is the largest structural change from the reviewed plan: it moves the booking write out of
  the `workshop-setup.ts` service shape the plan otherwise follows verbatim, and `security definer`
  means the role check becomes code to test rather than a policy Postgres enforces. The two added
  pgTAP assertions exist precisely for that.
- F1's re-check and F2's RPC are complementary: most stale-slot cases now fail before any insert,
  leaving the RPC's rollback to cover only the genuine simultaneous race.
