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

