# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Merging is deploying — push the schema before the merge

- **Context**: Any change whose phases include both a Supabase migration and app code that reads the new tables, in a repo where Cloudflare Git integration auto-deploys `main` (`context/deployment/deploy-plan.md:160-173` — ~93s from push to live).
- **Problem**: The F-01 plan asserted "`db push` runs before the app change is live on production" but nothing enforced the ordering, and no phase named the deploy trigger at all. Merging ahead of `supabase db push` deploys middleware that queries tables production doesn't have yet; because the guard fails closed, every authenticated user is redirected to sign-in. The failure is silent, total, and `wrangler rollback` only reverts half of it.
- **Rule**: When a change ships a migration alongside code that reads it, treat merge-to-`main` as the deploy. Work on a feature branch, run `npx supabase db push` before merging, and write the ship order into the plan's final phase as an explicit numbered sequence.
- **Applies to**: plan, plan-review, implement

## Deleting a symbol means grepping the docs that name it

- **Context**: Any phase that removes or renames a load-bearing symbol — an exported constant, a config key, a route table, an env var.
- **Problem**: F-01 Phase 4 deleted `PROTECTED_ROUTES` while `README.md:149`, `AGENTS.md:16`, and `AGENTS.md:39` still instructed readers to add routes to it. `AGENTS.md` is the first thing a future agent reads, so a stale instruction there propagates into every downstream slice — the exact drift the change existed to prevent.
- **Rule**: Before a phase deletes or renames a symbol, `grep -rn` its name across `README.md`, `AGENTS.md`, `CLAUDE.md`, and `context/`, and add every hit to that phase's file contract. The symbol is not removed until the docs that name it stop naming it.
- **Applies to**: plan, plan-review, impl-review

## Sync Linear/GitHub status automatically on implementation completion

- **Context**: When a change/plan whose tasks are linked to a Linear issue and/or GitHub issue reaches completion (e.g. /10x-implement finishing a phase, or all plan phases done)
- **Problem**: Linear/GitHub status is updated manually and gets skipped, so the tracker silently drifts out of sync with the actual state of the code — issues sit "In Progress" long after merge, with no record of what shipped.
- **Rule**: When implementation tasks tied to a Linear/GH issue are completed, automatically post a status comment summarizing what was done and transition the issue status (e.g. In Review / Done); keep GitHub linked to Linear for continuous bidirectional follow-through.
- **Applies to**: implement, impl-review

## UI-touching work replicates the brochure, not a token summary

- **Context**: Any change that adds or restyles a UI screen (S-01 through S-06 and beyond).
- **Problem**: Without a direct pointer, a future slice would work from a lossy token summary or its own judgment, drifting from the actual look the user built and validated in the private `wulkanizator-go-brochure` mockup — the opposite of the "near-1:1 reference" intent behind `context/foundation/design-system.md`.
- **Rule**: Before planning or implementing any UI-touching phase, read `context/foundation/design-system.md`'s screen-mapping table, then open the exact corresponding screen(s) in the brochure repo (`tomskoczewski/wulkanizator-go-brochure`, private — clone via `gh repo clone` if not already local) and use them as the near-1:1 reference for layout, structure, and visual treatment. The token summary in `design-system.md` is a quick cross-check, not a substitute for looking at the actual screen.
- **Applies to**: plan, plan-review, implement

## A `security definer` RPC that unconditionally inserts leaves orphan rows on every failed retry

- **Context**: Any `security definer` function that inserts a row as a side effect of its main operation, called from a client that retries on failure (e.g. a 409 conflict) — `public.book_appointment()` (`supabase/migrations/20260821090000_appointments_and_customers.sql:130-148`) is the current example: it inserts a `customers` row unconditionally, then an `appointments` row, and returns the combined result.
- **Problem**: `book_appointment()` has no way to attach an appointment to an existing customer — every call mints a fresh `customers` row, with no unique constraint on `(workshop_id, phone)` and no dedupe. `NewAppointmentForm.tsx`'s slot-conflict handling (`context/archive/2026-08-21-add-appointment-with-slots/`) retries the same booking on a 409 without any customer-side cleanup, so a lost slot-race leaks a customer row per attempt — and because no table in the schema has a DELETE grant (`context/archive/2026-08-15-workshop-setup/plan.md:77`'s grant-mirrors-policy convention was applied schema-wide), there is no path to clean it up after the fact. This was caught in S-02's own plan-review (`context/archive/2026-08-21-add-appointment-with-slots/reviews/plan-review.md:68-79, 94`) and explicitly named as inherited by S-05 — but S-05 was parked 2026-08-25 before it built the directory screen that would have surfaced the accumulation (`context/archive/2026-08-25-customer-directory/change.md`, `context/foundation/roadmap.md` §S-05 Park decision). The rows keep accumulating in production regardless of whether S-05 ever ships — this is a live, silent, unbounded-growth issue independent of the parked UI work.
- **Rule**: When a `security definer` function inserts a row as a side effect and the caller can retry on failure, either (a) make the insert idempotent/conditional (e.g. accept an existing-row id and skip the insert when present, or dedupe-by-natural-key before inserting), or (b) grant a narrow, ownership-checked DELETE/compensating path so a failed attempt can clean up after itself. Do not assume "S-0N will add the UI to deal with this later" is a fix — the underlying accumulation happens regardless of whether that UI ever ships, and parking the UI slice does not park the data problem. If parking a slice that was slated to address a known-accumulating issue, say so explicitly in the park decision (as done for S-05) rather than letting the issue go unmentioned.
- **Applies to**: research, plan, plan-review, implement

