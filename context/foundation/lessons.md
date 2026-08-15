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

