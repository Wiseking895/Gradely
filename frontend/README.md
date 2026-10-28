# Gradely — Frontend

React + TypeScript + Vite + Tailwind CSS for Gradely
("Smarter Reports. Better Learning."), deployed as a static Vercel project.

> **Status:** Phase B (school management). Phase A’s homepage, sign-in,
> self-service school registration (`/register-school`), and email
> verification (`/verify-email`, including expired/used/invalid and resend
> states) remain in place. Signed-in school administrators now get a
> dashboard at `/dashboard` with school profile/logo, classes and sections,
> subjects, and class-subject assignments. Platform administrators get a
> read-only oversight view of a school by ID (no platform-wide school
> directory). Teacher invitations, pupils, assessment entry, report
> generation, and payments belong to later phases.

## Stack

- React 19, TypeScript, Vite
- Tailwind CSS 4 (via `@tailwindcss/vite`)
- React Router 7
- Lucide React icons
- ESLint 10 + typescript-eslint

## Deploying to Vercel (frontend project)

Import the same Git repository as a **first** Vercel project with:

- **Root Directory:** `frontend`
- **Framework Preset:** Vite (auto-detected; also set in `vercel.json`)
- **Node.js version:** 24.x (pinned via `engines` in `package.json`)

Build output is Vite's default `dist/` directory. `vercel.json` adds an SPA
rewrite (`/(.*) -> /`) so client-side routes such as `/dashboard` still work
on a direct page refresh; static assets are still served first.

Set `VITE_API_URL` (see below) in the Vercel project's Environment
Variables. Only variables prefixed with `VITE_` are embedded in the browser
bundle — never put database, R2, or other secrets in frontend env vars.

## Environment variables (frontend Vercel project)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | Yes (prod) | Base URL of the backend Vercel project, e.g. `https://your-backend.vercel.app` (no trailing slash) |

Leave `VITE_API_URL` empty for local development: the API is called
same-origin and the Vite dev server proxies `/api` to
`http://localhost:4000` (`vite.config.ts` — development only, never used in
production builds).

All API calls go through the service layer in `src/lib/api.ts`, which reads
`VITE_API_URL`, parses JSON safely, and raises typed `ApiError`s for network
failures and non-JSON error responses.

## School management routes

| Route | Purpose |
| --- | --- |
| `/dashboard` | Entry point: one school redirects straight through; multiple schools are listed; platform admins can open a school by ID |
| `/dashboard/schools/:schoolId` | Overview, setup checklist, counts, quick actions |
| `/dashboard/schools/:schoolId/profile` | Editable name/contact details, immutable slug, logo lifecycle |
| `/dashboard/schools/:schoolId/classes` | Level-ordered class list, create/archive/reactivate |
| `/dashboard/schools/:schoolId/classes/:classId` | Sections, rename/archive, subject assignments |
| `/dashboard/schools/:schoolId/subjects` | Subject list, create/rename/archive/reactivate |

`RequireAuth` preserves the requested path as `returnTo` and sends anonymous
visitors to `/login`. `safeReturnTo()` accepts only same-origin absolute
paths, so protocol-relative and external URLs cannot be used as open
redirects. Verified sign-in returns to that path or `/dashboard`;
unverified users go to `/verify-email`.

School management writes are hidden entirely for read-only platform-admin
sessions. The backend still enforces every permission; client-side checks are
only for clarity. Archiving is soft, and archived classes/subjects cannot
receive new sections/assignments until reactivated.

## Commands

```bash
npm install        # install dependencies
npm run dev        # start dev server on http://localhost:5173
npm run build      # type-check (tsc -b) and production build to dist/
npm run preview    # preview the production build
npm test           # Vitest + Testing Library component tests (jsdom)
npm run lint       # ESLint
npm run typecheck  # TypeScript project check (no emit)
```

## Brand colours

Defined as Tailwind theme tokens in `src/index.css`:

| Token            | Colour     | Use                        |
| ---------------- | ---------- | -------------------------- |
| `brand-navy`     | `#174A9C`  | Primary navigation/actions |
| `brand-blue`     | `#0785EF`  | Bright accent              |
| `brand-green`    | `#22B83D`  | Successful states          |
| `brand-gold`     | `#F5AA00`  | Selective highlights       |
| `brand-surface`  | `#F7F9FC`  | Light page background      |
| `brand-ink`      | `#172033`  | Main text                  |
| `brand-muted`    | `#64748B`  | Muted text                 |

## Logo

The official Gradely brand asset lives at `src/images/wiseGrade.jpeg` and is
imported through Vite. `src/components/BrandMark.tsx` renders the full lockup
with `object-contain` at a compact header size or a larger auth-page size.
`index.html` uses the same file for the favicon and Apple touch icon.

A school’s own logo is tenant data, not a Gradely brand asset. It is uploaded
from the profile page through a short-lived presigned R2 URL and previewed via
a short-lived download URL. The frontend never receives the storage object
key or credentials. If logo storage is unavailable, the rest of the profile
remains editable.

## Structure

```
frontend/
  vercel.json           # SPA rewrite so refresh works on client routes
  index.html            # document title: Gradely — Smarter Reports. Better Learning.
  src/
    main.tsx            # app entry
    App.tsx             # router setup
    index.css           # Tailwind + brand theme tokens
    lib/api.ts          # API service layer (VITE_API_URL)
    lib/auth.tsx        # AuthProvider (session load/login/logout)
    vite-env.d.ts       # VITE_API_URL type declarations
    components/         # BrandMark, ResendVerificationForm, RequireAuth,
                        # DashboardHeader
    routes/             # HomePage, LoginPage, RegisterSchoolPage,
                        # VerifyEmailPage, DashboardEntryPage, NotFoundPage
    routes/schools/     # SchoolLayout, overview, profile, classes,
                        # class detail, subjects
    lib/navigation.ts   # safe returnTo + UUID validation
    lib/schoolErrors.ts # user-safe API error messages
    test/setup.ts       # Vitest/jsdom + Testing Library setup
  vitest.config.ts      # component test runner (jsdom)
```

## Tests

Component tests use Vitest + jsdom + React Testing Library and mock the API
service layer. They cover registration validation/success/duplicate/delivery
failure, verification success/expired/used/invalid/network retry, resend
success and rate limiting, post-login routing for unverified accounts,
validated `returnTo` handling (including external-URL rejection), and the
public login flow. `npm test` runs them once.

Phase B responsive checks were run against the Vite dev server and a scratch
PostgreSQL database using installed Chrome headless driven by a temporary CDP
script outside the repository (no browser-automation dependency was added).
Home, login, overview, profile, classes, class detail, and subjects were
checked at 320, 375, 390, 768, 1024, and 1440 px for horizontal overflow; the
anonymous guard and post-login `returnTo` path were verified at 390 px. The
script is not committed. There is still no Playwright/Cypress or browser CI
suite.
