---
source_repo: tomskoczewski/wulkanizator-go-brochure # private GitHub repo
source_preview: wulkanizator-go-brochure.vercel.app
extracted: 2026-08-15
status: locked
authority: primary UI/UX reference — near-1:1
---

# Design System

## How to use this doc

**The brochure's screens are the near-1:1 reference for layout, structure, and visual treatment — not the token summary below.** Before planning or implementing any UI-touching phase, use the screen-mapping table to find the exact brochure screen for the slice at hand, open it, and replicate it closely: layout, copy tone, component shape, spacing feel. The palette/typography/component-convention summary further down is a quick cross-check for details (an exact color name, a radius class) — it is lossy by nature and must never be treated as a substitute for looking at the real screen.

**Access note**: `tomskoczewski/wulkanizator-go-brochure` is a **private** repo. Plain `WebFetch` on its GitHub URL or the Vercel preview will 404 / return nothing useful (the preview is a client-rendered SPA shell). Use `gh repo clone tomskoczewski/wulkanizator-go-brochure` (or `gh api repos/tomskoczewski/wulkanizator-go-brochure/contents/<path>` for a single file) to read it directly — this requires the same `gh` CLI auth already used elsewhere in this project's workflow.

The brochure itself is a small Vite + React 19 + Tailwind 4 SPA — a single `src/App.jsx` (~1350 lines) containing every screen as its own component, plus marketing sections. All line numbers below refer to that file as of `extracted: 2026-08-15`.

## Screen-mapping table

One row per roadmap slice. See `context/foundation/roadmap.md` for each slice's own `- **Brochure reference:**` line (kept in sync with this table).

| Roadmap slice                   | Brochure screen(s)                        | `App.jsx` location               | What to replicate                                                                                                                           |
| ------------------------------- | ----------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| S-01 workshop-setup             | `SettingsScreen`                          | `App.jsx:715`                    | "Czasy usług" (service durations), "Stanowiska" (bays), "Godziny pracy" (working hours) sections — maps directly to FR-001–003              |
| S-02 add-appointment-with-slots | `AddVisitScreen` + `MobilePreview`        | `App.jsx:402`, `App.jsx:876`     | Slot-suggestion chips, service picker grid, minimal walk-in fields; `MobilePreview` shows the compact mobile variant                        |
| S-03 day-plan-view (north star) | `TodayScreen`                             | `App.jsx:293`                    | Stat tiles, status filter pills, the appointment list itself with `StatusPill` (`App.jsx:169`) — this is the north star's direct 1:1 mockup |
| S-04 worker-status-changes      | `VisitDetailScreen` (status-step block)   | `App.jsx:478`, buttons ~L503-513 | The 3-button "Szybka zmiana statusu" tap-to-advance control; `StatusPill` (`App.jsx:169`) for the resulting badge                           |
| S-05 customer-directory         | `ClientsScreen` + `CustomerProfileScreen` | `App.jsx:539`, `App.jsx:580`     | List/search view, then the full customer card with cars + history                                                                           |
| S-06 tire-storage               | `StorageScreen` + `StorageIntakeScreen`   | `App.jsx:630`, `App.jsx:676`     | Search/list view of stored tire sets, then the intake form                                                                                  |

**Not mapped to a current MVP slice** (present in the brochure, available if these get unparked — see `roadmap.md`'s Open Roadmap Questions / Parked sections):

- `WeekScreen` (`App.jsx:359`) — weekly occupancy view, related to the parked "per-bay/weekly view" item.
- `PricingScreen` (`App.jsx:764`) — pricing + revenue forecast, maps to Open Roadmap Question #2 ("are revenue and forecast part of the MVP?").

## Brand identity

Name lockup: **"wulkanizator"** in white/dark neutral + **"go"** in brand orange, set tight (`font-black`, no space before "go").

Logo mark (`Logo3D`, `App.jsx:59-78`) — a flat, orange, face-on tire-tread ring:

```jsx
function Logo3D({ size = 60, className = "" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="#f97316"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <defs>
        <clipPath id="lg-clip">
          <circle cx="12" cy="12" r="9.5" />
        </clipPath>
      </defs>
      {/* Tire ring */}
      <circle cx="12" cy="12" r="11" strokeWidth="2.2" />
      {/* Directional V-tread — 3 chevrons */}
      <g clipPath="url(#lg-clip)" strokeWidth="1.8">
        <polyline points="2,11 12,7 22,11" />
        <polyline points="2,15 12,11 22,15" />
        <polyline points="2,19 12,15 22,19" />
      </g>
    </svg>
  );
}
```

Reference only — no component exists in this repo yet. A slice that needs the logo builds it against this markup (adapted to Astro/this repo's conventions) when it's actually needed.

## Color palette (summary)

- **Primary**: Tailwind `orange-500` (`#f97316`) / `orange-600` for hover states.
- **Neutral**: Tailwind `slate` scale — `slate-50`/`slate-100` for light surfaces, `slate-900`/`slate-950` for dark surfaces and chrome (nav rails, headers).
- **Status colors** — the brochure's `StatusPill` (`App.jsx:169-184`), mapped exactly onto the PRD's FR-007 status enum:

  | Status (PRD FR-007) | Brochure label | Tailwind classes                                     |
  | ------------------- | -------------- | ---------------------------------------------------- |
  | waiting             | Oczekuje       | `bg-amber-100 text-amber-800 border-amber-200`       |
  | in progress         | W trakcie      | `bg-blue-100 text-blue-800 border-blue-200`          |
  | done                | Gotowe         | `bg-emerald-100 text-emerald-800 border-emerald-200` |
  | no-show             | Nie przyjechał | `bg-rose-100 text-rose-800 border-rose-200`          |
  | cancelled           | Anulowane      | `bg-slate-100 text-slate-700 border-slate-200`       |

## Typography (summary)

`font-black` (weight 900) dominates: headings, labels, and numeric/KPI values all use it — a deliberately high-contrast system that matches the PRD's NFR "czytelne w 2 sekundy" (readable in 2 seconds). In-app screens stay dense: `text-xs`/`text-sm` are the dominant body sizes throughout the actual app screens (as opposed to the marketing sections, which use `text-4xl`–`text-6xl` — not relevant to any current slice, since no landing page is in scope yet).

## Component conventions (summary)

- **Cards**: `rounded-2xl` (or `rounded-[24px]` for larger containers) + `shadow-sm ring-1 ring-slate-100`.
- **Buttons / inputs**: `rounded-xl`.
- **Pills / badges**: `rounded-full`.
- **Stat tiles**: gradient-text KPI numbers (`bg-gradient-to-r ... bg-clip-text text-transparent`).
- **App-shell chrome** (header bar, outer container in the mockup): `rounded-[28px]` — likely not directly applicable outside the brochure's own "phone/app frame" presentation, but worth knowing it's the outlier radius value if it turns up in a screen being replicated.

## Non-goals

The brochure's marketing sections (Hero, Problem, Features, Scenarios, "Dla kogo", Wdrożenie, FAQ, CTA, Footer) are **not** covered by this doc's authority. `src/pages/index.astro` stays as the stock starter placeholder until a public landing page is separately prioritized — none of the roadmap slices above require it.
