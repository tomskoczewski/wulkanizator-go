# 10x Astro Starter

![](./public/template.png)

A modern, opinionated starter template for building fast, accessible web applications.

## Tech Stack

- [Astro](https://astro.build/) v6 - Modern web framework with server-first rendering
- [React](https://react.dev/) v19 - UI library for interactive components
- [TypeScript](https://www.typescriptlang.org/) v5 - Type-safe JavaScript
- [Tailwind CSS](https://tailwindcss.com/) v4 - Utility-first CSS framework
- [Supabase](https://supabase.com/) - Authentication and backend-as-a-service
- [Cloudflare Workers](https://workers.cloudflare.com/) - Edge deployment runtime

## Prerequisites

- Node.js v22.14.0 (as specified in `.nvmrc`)
- npm (comes with Node.js)

## Getting Started

1. Clone the repository:

```bash
git clone https://github.com/przeprogramowani/10x-astro-starter.git
cd 10x-astro-starter
```

2. Install dependencies:

```bash
npm install
```

3. Set up Supabase and configure environment variables — see [Supabase Configuration](#supabase-configuration) below.

4. Create a `.dev.vars` file for local Cloudflare dev secrets:

```bash
cp .env.example .dev.vars
```

5. Run the development server:

```bash
npm run dev
```

## Available Scripts

- `npm run dev` - Start development server (Cloudflare workerd runtime)
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint with type-checked rules
- `npm run lint:fix` - Auto-fix ESLint issues
- `npm run format` - Run Prettier
- `npm run typecheck` - Type-check with `astro check`
- `npm test` / `npm run test:watch` - Run unit tests with Vitest (colocated `*.test.ts` files)
- `npm run db:start` / `db:stop` / `db:reset` / `db:test` / `db:types` - Local Supabase workflow, see [Local database workflow](#local-database-workflow)

## Project Structure

```md
.
├── src/
│ ├── layouts/ # Astro layouts
│ ├── pages/ # Astro pages
│ │ └── api/ # API endpoints
│ ├── components/ # UI components (Astro & React)
│ └── assets/ # Static assets
├── public/ # Public assets
├── wrangler.jsonc # Cloudflare Workers config
```

## Supabase Configuration

This project uses [Supabase](https://supabase.com/) for authentication. Environment variables are declared via Astro's `astro:env` schema and are treated as **server-only secrets** — they are never exposed to the client.

### First-time setup (local, no cloud project needed)

Requires [Docker](https://www.docker.com/) and ~7 GB RAM.

1. Create your `.env` file:

```bash
cp .env.example .env
```

2. Initialize the local Supabase project (creates a `supabase/` config folder):

```bash
npx supabase init
```

3. Start the local stack (downloads Docker images on first run):

```bash
npx supabase start
```

4. Copy the credentials printed by the CLI into your `.env` and `.dev.vars`:

```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<anon key from CLI output>
```

5. To stop the stack when done:

```bash
npx supabase stop
```

The local Studio UI is available at `http://localhost:54323`.

This project now ships application tables and migrations alongside Supabase Auth's built-in `auth.users` table — see [Local database workflow](#local-database-workflow) below to apply them.

### Using a cloud Supabase project instead

If you prefer to use a hosted Supabase project, add these variables to your `.env` and `.dev.vars` files:

| Variable       | Description                                                |
| -------------- | ---------------------------------------------------------- |
| `SUPABASE_URL` | Project URL from Supabase dashboard → Settings → API       |
| `SUPABASE_KEY` | `anon` public key from Supabase dashboard → Settings → API |

```
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_KEY=<anon-key>
```

### Email confirmation in local development

By default Supabase requires email confirmation before a user can sign in. To skip this during local development:

1. Open the Supabase dashboard for your project
2. Go to **Authentication → Email → Confirm email**
3. Toggle it **off**

Users can then sign in immediately after sign-up without clicking a confirmation link.

### Auth routes

| Route                 | Description                                                             |
| --------------------- | ----------------------------------------------------------------------- |
| `/auth/signin`        | Email/password sign-in form                                             |
| `/auth/signup`        | Email/password sign-up form                                             |
| `/auth/confirm-email` | Post-signup "check your inbox" page                                     |
| `/dashboard`          | Day plan — every appointment for a chosen day, with status filters (any authenticated role) |
| `/ustawienia`         | Owner-only workshop configuration (bays, services, working hours)       |
| `/wizyty/nowa`        | Owner-only: book an appointment with free-slot suggestions             |
| `/wizyty/<id>`        | Appointment details (any authenticated role)                            |

Route protection is handled in `src/middleware.ts`, which delegates to the route table in `src/lib/auth-guard.ts`. Add a `[pathPrefix, accessLevel]` entry there to require authentication (`"any"`) or a specific role (`"owner"` / `"worker"`) — longest matching prefix wins.

## Roles and workshops

Every account signs up as the **owner** of their own workshop — a database trigger (`on_auth_user_created`) creates the workshop and the owner `profiles` row atomically, so there is never an authenticated user without one. There is no self-service invite flow yet; **worker** accounts are created by moving an existing account into another workshop.

### Local database workflow

```bash
npm run db:start   # start the local Supabase stack (Docker)
npm run db:reset    # (re)apply migrations + supabase/seed.sql from scratch
npm run db:test     # run the pgTAP RLS isolation suite
npm run db:types    # regenerate src/db/database.types.ts from the local schema
npm run db:stop     # stop the local stack
```

Run `npm run db:types` after every migration and commit the result — `npm run typecheck` checks application code against the *committed* types, not the live database, so a stale file is a silent gap. The pre-push hook (`.husky/pre-push`) regenerates and diffs the file before every push, and skips cleanly if the local stack isn't running.

### Creating a worker account

1. Have the person sign up normally at `/auth/signup` — this makes them the **owner** of a brand-new workshop of their own.
2. In Supabase Studio (`http://localhost:54323` locally, or the project dashboard in production) → SQL Editor, run:

   ```sql
   update public.profiles
   set workshop_id = '<owner-a-workshop-id>', -- the workshop they should join
       role = 'worker'
   where user_id = '<the-new-account-user-id>';
   ```

   Find both ids under **Table Editor → profiles**. The account can sign in immediately after — no re-confirmation needed.

### Trigger kill-switch

`public.handle_new_user()` runs inside every `auth.users` insert, for every Worker version deployed — `wrangler rollback` does **not** undo a failing trigger. If a bad migration makes it break signups in production ("Database error saving new user"), disable it immediately:

```sql
drop trigger if exists on_auth_user_created on auth.users;
```

This restores signup immediately and leaves existing workshops and profiles intact. Re-create the trigger (rerun its migration) once the underlying function is fixed.

While the trigger is dropped, new signups get no `profiles` row **and** no default services/bays/working-hours — `handle_new_user()` also owns default seeding (`public.seed_workshop_defaults()`). Workshops created during the outage need manual provisioning once the trigger is restored.

## Deployment

This project deploys to [Cloudflare Workers](https://workers.cloudflare.com/).

1. Build the project:

```bash
npm run build
```

2. Deploy with Wrangler:

```bash
npx wrangler deploy
```

Set `SUPABASE_URL` and `SUPABASE_KEY` as secrets in your Cloudflare dashboard or via `npx wrangler secret put`.

## CI

GitHub Actions runs lint + test + typecheck + build on every push and PR to `main`. Configure `SUPABASE_URL` and `SUPABASE_KEY` as repository secrets in GitHub for the typecheck and build steps — lint and test need no secrets.

## License

MIT
