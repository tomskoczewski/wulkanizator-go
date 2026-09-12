# Artifact 3 · Contributors — who knows what, and who to ask

**Input:** [`artifact-1-territory.md`](./artifact-1-territory.md) · [`artifact-2-structure.md`](./artifact-2-structure.md)
**Method:** `git log` over `main` (full history, `3d11163` 2026-06-03 → `89d43b8` 2026-09-11, 109 commits),
author/committer/trailer aggregation per area, cross-checked against the GitHub PR record (`gh pr list`).

> Scope note: the prompt says "last 12 months". The repo is 3 months old, so the window is the
> **full history** — same window as artifact 1.

---

## 0. The finding that reshapes this artifact

**There is no support line made of people. There is one person and a pile of documents.**

| Signal                         |                Value | Evidence                                                                                                                                                                                     |
| ------------------------------ | -------------------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Human authors on `main`        |                **1** | 103 commits `tomaszskoczewski <tomaszskoczewski@gmail.com>` + 6 `tomskoczewski <62096969+…@users.noreply.github.com>` — same person, two git identities (artifact 1 §6 already flagged this) |
| Human authors on all branches  |                **1** | `git log --all`: 120 + 6, same two identities                                                                                                                                                |
| Human PR reviews               |                **0** | `gh pr list --state all`: PRs #17, #19, #21, #22, #23, #24 — `"reviews":[]` on every one                                                                                                     |
| Bots / automation              | **2, both filtered** | `GitHub <noreply@github.com>` (squash-merge committer, 6 commits) and `cloudflare-workers-and-pages` (deploy-status PR comments, 0 code)                                                     |
| Commits co-authored by a model |   **48 / 109 (44%)** | `Co-Authored-By: Claude …` trailer, 6 distinct model ids                                                                                                                                     |

**On the prompt's agent filter.** The rule is "filter out agent commits _without clear human
authorship_". Here **none qualify for removal**: every one of the 48 model-co-authored commits has
`tomaszskoczewski` as author _and_ committer, with a hand-shaped Conventional Commit subject and a
change-folder scope. The trailer is provenance, not authorship. It is kept in the tables below for
a different reason: it marks **where the reasoning was co-produced with a model you cannot
re-interview**. A model is not a support line — the session is gone, only the artefact it left
behind remains.

Model split across those 48 commits: Opus 5 ×20, Sonnet 5 ×13, Sonnet 4.6 ×6, Haiku 4.5 ×6,
Sonnet 4.6 (1M) ×2, Opus 4.6 (1M) ×1. Per month: 2026-06 4/4, 2026-08 29/81, 2026-09 15/24.

**Consequence for this artifact.** "Who to ask" collapses to one name, which is useless as a map.
So each area below is routed to **the durable record that answers it** — change folder, review
report, pgTAP suite, rules file — and §4 lists what **no record answers**, which is the actual
bus-factor-1 risk register.

---

## 1. Top 5 areas that may need contributor contact

Selected from artifacts 1–2 on three criteria: high blast radius (artifact 1 §3–§4), invariants
that **no tool can verify** (artifact 2 §2, §5), and decisions whose _rationale_ is not derivable
from the code.

| #   | Area                                                                                                                                                                                                                      | Why a human (or a document) is needed                                                                                                                                                                                                                                    | Source                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| 1   | **Booking rule & the no-double-booking invariant** — `src/lib/services/{appointments,slot-suggestions}.ts`, `src/lib/schemas/appointment.ts`, `supabase/migrations/*book_appointment*`, `appointments_no_overlap_per_bay` | **One invariant, two independent implementations** — pure TS slot math and a Postgres constraint/RPC, neither aware of the other, and artifact 1 §3 shows they **never move in the same commit**. Which one is the source of truth is a decision, not a fact in the code | A1 §1b, §3 (#1 code area, 19 touches) · A2 §3 "what to check next" |
| 2   | **Workshop-local wall-clock invariant** — `src/lib/workshop-clock.ts` + the 4 modules doing `Date` arithmetic without importing it                                                                                        | The repo's load-bearing domain rule (naive wall-clock, `timestamp` not `timestamptz`), **enforced by nothing executable**: no ESLint rule, no depcruise rule, and no test on the module itself. It holds on convention and review alone                                  | A2 §2 rows 6, §3 risk #1                                           |
| 3   | **Workshop scope & route access** — `src/middleware.ts`, `src/lib/auth-guard.ts`, RLS policies, `supabase/tests/rls_workshop_scope.test.sql`                                                                              | The repo's highest-blast-radius cluster (A1 §3) _and_ its security boundary. `rls_workshop_scope.test.sql` is the single highest-churn code file (821 lines) and a bottleneck every schema change re-opens                                                               | A1 §1d, §3 · A2 §2                                                 |
| 4   | **`src/types.ts` and the type-only inversion** — 6 cycles, all through this file                                                                                                                                          | Fan-in 25, runtime orphan, and the 4 upward edges are described in artifact 2 as "a deliberate inversion, not an accident" — **but nothing on disk records who decided that or why**. Pure intent question                                                               | A1 §4 · A2 §1, §2 row 3                                            |
| 5   | **The Astro-invisible ring** — 14 `.astro` files (every page + layout), 5 island roots, 12 API routes, `DayPlanBoard.tsx`                                                                                                 | Invisible to dependency-cruiser, fan-in 0, unreachable by unit tests; **every blast-radius number in artifact 2 is a lower bound here**. Covered only by 4 E2E specs and by whatever the author remembers about `client:*` wiring                                        | A2 §3 risks 2/5, §5                                                |

---

## 2. The support line — per area

"Contributor" resolves to the same person everywhere, so the operative columns are **which record
to open first** and **how much of the reasoning is on disk**.

| #   | Area                 | Commits · window                 | Identity split                    | Model co-authorship on those commits               | **Read this first**                                                                                                                                                                                                                                                  | Support confidence                                                                 |
| --- | -------------------- | -------------------------------- | --------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 1   | Booking rule         | **20** · 2026-08-15 → 2026-09-10 | 19 local, 1 via PR #21            | 7 of 20 (Sonnet 5 ×4, Opus 5 ×3)                   | `context/archive/2026-08-21-add-appointment-with-slots/` — the **only** change with `research.md` _and_ a `context/` folder _and_ both reviews; then `…/2026-08-25-customer-dedupe-on-booking/reviews/impl-review.md`                                                | **High** — the richest paper trail in the repo                                     |
| 2   | Wall-clock           | **2** · 2026-08-21 only          | 2 local                           | 1 of 2 (Sonnet 5)                                  | Nothing dedicated. The module arrived _inside_ `517166b` "Slot algorithm & Vitest (p2)"; the rule exists only as prose in `AGENTS.md` and a docblock                                                                                                                 | **Lowest in the repo** — load-bearing rule, 2 commits, no test, no decision record |
| 3   | Scope & access       | **15** · 2026-06-03 → 2026-08-25 | 13 local, 2 via PRs #17, #22      | 5 of 15 (Opus 5 ×3, Sonnet 5 ×1, Opus 4.6 1M ×1)   | `supabase/tests/rls_workshop_scope.test.sql` — **executable documentation**, the most reliable record here; then `context/archive/2026-08-15-role-and-workshop-scope/` (⚠️ `plan-review.md` only — this change has **no `impl-review.md`**, unlike the five that do) | **Medium-high** — the tests carry it, the prose does not                           |
| 4   | `types.ts`           | **8** · 2026-08-15 → 2026-08-24  | 7 local, 1 via PR #17             | 2 of 8 (Sonnet 5, Opus 5)                          | **No record exists.** No change folder names `types.ts`; it was edited as a side effect of 8 feature commits                                                                                                                                                         | **None** — the "why" lives in one head                                             |
| 5   | Astro-invisible ring | **29** · 2026-06-03 → 2026-09-11 | 26 local, 3 via PRs #17, #22, #23 | 16 of 29 (Opus 5 ×10, Sonnet 5 ×5, Opus 4.6 1M ×1) | `e2e/README.md` (hydration, per-spec window, SQL back door) + `context/foundation/test-plan.md` §3/§6.4 + `context/changes/testing-mutation-failure-ui/` (research + both reviews)                                                                                   | **Medium** — conventions are written down; the `client:*` wiring rationale is not  |

Path sets behind each row are in **Reproduce** — the counts are only meaningful with them.

---

## 3. Contributor profiles — activity grouped thematically

### `tomaszskoczewski <tomaszskoczewski@gmail.com>` — 103 commits, 2026-06-03 → 2026-09-11

The whole repo. Grouping by Conventional Commit scope (which in this repo is almost always a
change-id) gives a usable competence map rather than "knows everything":

| Theme                      | Scopes / commits                                                                                              | What it means they can answer                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Booking vertical**       | `add-appointment-with-slots` 10, `worker-status-changes` 8, `customer-dedupe-on-booking` 8, `day-plan-view` 7 | Slot algorithm, status transitions, phone dedupe, the `book_appointment()` RPC — the product's core rules                      |
| **Workshop configuration** | `workshop-setup` 7                                                                                            | Bays, services, working hours, the settings islands, the provisioning trigger                                                  |
| **Schema & RLS**           | 13 commits touching `supabase/` (frozen since 2026-08-25)                                                     | Policies, `current_workshop_id()`/`current_user_role()`, the overlap guard, the pgTAP suite                                    |
| **Testing rollout**        | `testing-mutation-failure-ui` 7, `e2e` 2, `test-plan` 1                                                       | Playwright conventions, `happy-dom` island tests, the failure-decision helper                                                  |
| **Process & foundation**   | `archive` 7, `roadmap` 5, `lessons` 2, `prd` 1, `trackers` 1                                                  | The `/10x-new → research → plan → implement → archive` workflow itself — artifact 1 §1a shows `context/` is 40% of all touches |
| **Tooling, CI, deps**      | `deps` 2, `ci` 1, lefthook/hooks, lockfile                                                                    | The lefthook gates, the `db:types` drift check, the cross-platform lockfile rule                                               |

### `tomskoczewski <62096969+…@users.noreply.github.com>` — 6 commits, 2026-08-15 → 2026-09-10

**Same person.** This identity appears only on GitHub squash-merges, so it is not a second expert —
it is a marker for _the work that went through a branch and a PR_ instead of straight to `main`:
PR #17 (RLS + route guard), #19 (tracker sync), #21 (day-plan view), #22 (auth branding, `/` as
front door), #23 (header account menu), #24 (npm audit fixes, Astro 6 → 7).

Useful property: those six are the only commits with a PR body, and PR bodies survive where commit
messages are terse. Useless property: **none of them was reviewed by anyone** — `"reviews":[]` on
all six. There is no review-comment trail in this repo, from a human or otherwise.

### Filtered out

| Excluded                                             | Why                                                                                                                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GitHub <noreply@github.com>` (committer, 6 commits) | Squash-merge mechanism, not an author                                                                                                                          |
| `cloudflare-workers-and-pages` (PR comments)         | Deployment-status bot; zero code, zero review content                                                                                                          |
| `Co-Authored-By: Claude …` (48 commits, 6 model ids) | Not filtered as _commits_ — every one has a clear human author (see §0) — but never counted as a contributor: a model session is not an available support line |

---

## 4. What no contributor and no document answers

The bus-factor-1 register: questions artifacts 1–2 raised, with where the answer actually is. One
was closed while writing this artifact.

| Question (from A1/A2)                                                                                                                   | Answered on disk?                                                                                                                                                     | Route                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Is `src/lib/schemas/day-plan.ts` dead? (A2 §3 risk 6 — fan-in 0)                                                                        | ✅ **Closed here.** Not dead: `src/pages/dashboard.astro:5` imports `resolveDayParam` from it. It was invisible only because dependency-cruiser cannot parse `.astro` | Nothing to ask. Fold into A2's blind-spot list as a worked example                                   |
| Which implementation of "no two appointments on one bay" is authoritative — `slot-suggestions.ts` or `appointments_no_overlap_per_bay`? | ❌ Both exist, both tested, **neither document says which leads**                                                                                                     | Human only. Highest-value question in the set; A2 flags it for the DDD phase                         |
| Why does `types.ts` import _upward_ from `schemas`/`services`?                                                                          | ❌ No change folder, no lesson, no ADR                                                                                                                                | Human only                                                                                           |
| Is `workshop-clock.ts` meant to be the only clock, or merely the current one?                                                           | ⚠️ Stated as a rule in `AGENTS.md`, enforced by **nothing executable**, and the module has **no test**                                                                | Human for intent; then make it executable (test + lint rule) so the next reader does not have to ask |
| Do the 3 auth routes bypass the service layer on purpose? (A2 §2 row 4)                                                                 | ❌ Not recorded                                                                                                                                                       | Human only                                                                                           |
| Is `context/changes/testing-api-contract-harness/` an opened change or an abandoned stub?                                               | ✅ Answered: **stub.** Empty folder, no `change.md`, **zero commits ever touched it** (`git log -- <path>` is empty); `test-plan.md:106` says so explicitly           | Nothing to ask — but it means Phase 1 of the test rollout has no owner and no artefact               |
| Why is the schema frozen since 2026-08-25?                                                                                              | ⚠️ Inferable (September was hardening, A1 §2) but never stated as a decision                                                                                          | Low risk; worth one line in `roadmap.md`                                                             |

### ⚠️ Two rule-file defects that mislead every future reader (and every agent)

> **Status: both fixed 2026-09-12**, immediately after this artifact was written — `AGENTS.md:3,11,27`
> and `README.md:18,189`. Kept here as the finding of record; the third defect below (the pre-commit
> description) was found while fixing the first two. **Deliberately left alone:**
> `context/foundation/roadmap.md:58` and `infrastructure.md` also say "Astro 6", but both are
> explicitly dated snapshots ("as of `2026-08-14`") — the roadmap line still names
> `src/pages/index.astro`, deleted in `5150f34`, which is what a historical inventory looks like.
> Editing them would rewrite a record, not fix a rule.

Both matter more than usual here: with one human and no reviewers, `AGENTS.md` **is** the onboarding
contract, and it is loaded into every agent session.

1. **`AGENTS.md:3` and `README.md:18` both say "Astro 6".** `package.json:38` pins `^7.3.2`, bumped
   in `8aa0259` (PR #24, 2026-09-10, "fix all npm audit vulnerabilities (astro 6 → 7)"). The
   rules file has been one major version behind for two days.
2. **`AGENTS.md:11` and `README.md:189` still name `.husky/pre-push`** as the types-drift gate —
   deleted in `0f78d6a` (2026-09-10), replaced by `lefthook.yml:21-37`. Already flagged in
   artifact 1 §5; repeated here because it is the _same_ class of defect, in the _same_ file, from
   the _same_ week.
3. **Found while fixing 1–2: `AGENTS.md:27` described a pre-commit hook that no longer exists.** It
   named `lint-staged` — absent from `package.json` entirely — and listed 2 of the 4 jobs
   `lefthook.yml` actually runs (it also runs `npm run typecheck` and `vitest related`). `lefthook`
   is a Homebrew binary, not an npm dependency, so **a fresh clone gets no hooks at all** until
   `lefthook install` is run; that step was missing from the README and is now step 5.

---

## 5. Limitations

- **Bus factor 1.** Every "who to ask" answer is the same person. Nothing in this artifact
  generalises to a team repo; the method (route areas to records, then list what no record covers)
  does.
- **`git blame` ≠ understanding.** 44% of commits were co-produced with a model. Blame identifies
  who _shipped_ a line, not who _reasoned about_ it — and the reasoning partner is unreachable.
  This is why §2 ranks records, not people.
- **No review trail at all.** 6 PRs, 0 human reviews. The usual second-best source of area
  knowledge (review threads) is empty. The `reviews/` folders under `context/archive/` are
  agent-written reports, not conversations — but they _are_ the closest substitute, and 6 of the 9
  archived changes have them.
- **Window is 3 months.** Every count is small-sample; a 20-commit area and a 15-commit one are not
  meaningfully different in rank.
- **17 commits live on unmerged branches** (`chore/audit-fix`, `tracker-status-sync`,
  `backup/main-pre-drop`, `docs/mvp-check-cleanup`, `feat/role-and-workshop-scope`). Work explored
  and abandoned there is invisible to every table above.
- **Merge commits contribute no files**, so area counts exclude them; their content is counted via
  the individual commits.
- **Per-area counts depend entirely on the path sets** in Reproduce. `.astro` pages are included in
  area 5 via git (unlike artifact 2, where they vanish) — the two artifacts count different
  universes on purpose.

---

## Reproduce

```bash
# identities, committers, bots
git log --format='%an <%ae>' | sort | uniq -c | sort -rn
git log --format='%cn <%ce>' | sort | uniq -c | sort -rn
gh pr list --state all --limit 30 --json number,title,author,mergedAt,reviews,comments

# model co-authorship: how many, which models, per month
git log --format='%H%x09%(trailers:key=Co-Authored-By,valueonly)' | awk -F'\t' '$2!=""' | wc -l
git log --format='%(trailers:key=Co-Authored-By,valueonly)' | sed 's/ <.*//' | grep -v '^$' | sort | uniq -c | sort -rn

# thematic grouping (scope == change-id in this repo)
git log --format='%s' | sed -nE 's/^[a-z]+\(([^)]*)\):.*/\1/p' | sort | uniq -c | sort -rn

# per-area: commits, window, identity split, models  (path sets used in §2)
#  1 booking  : src/lib/services src/lib/schemas supabase/migrations
#  2 clock    : src/lib/workshop-clock.ts
#  3 scope    : src/middleware.ts src/lib/auth-guard.ts supabase/tests
#  4 types    : src/types.ts
#  5 astro    : src/components src/pages src/layouts e2e
git log --format='%h|%ad|%an|%(trailers:key=Co-Authored-By,valueonly)' --date=short -- <paths>

# the two closed questions
grep -rn "schemas/day-plan" src --include="*.astro" --include="*.ts" --include="*.tsx"
git log --oneline -- context/changes/testing-api-contract-harness   # empty output = never committed

# the rule-file defects
grep -n '"astro"' package.json; grep -rn "Astro 6\|v6" AGENTS.md README.md
```
