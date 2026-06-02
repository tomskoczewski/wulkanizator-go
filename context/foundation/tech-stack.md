---
starter_id: 10x-astro-starter
package_manager: npm
project_name: wulkanizator-go
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

Solo developer building a tire workshop day-planner (Wulkanizator GO) as a web app with a 3-week after-hours timeline. Auth (email + password login with owner/worker roles) is the only technology-forcing feature from the PRD. The 10x Astro Starter is the recommended default for (web-app, js) and ships auth + PostgreSQL database + edge deploy via Supabase and Cloudflare Pages out of the box, eliminating the need to wire those pieces manually under a tight timeline. All four agent-friendly gates pass (typed TypeScript with Zod schemas, convention-based file routing, popular in training data, well-documented). CI runs on GitHub Actions with auto-deploy on merge to Cloudflare Pages.
