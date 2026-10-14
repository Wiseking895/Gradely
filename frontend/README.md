# Gradely — Frontend

React + TypeScript + Vite + Tailwind CSS for Gradely
("Smarter Reports. Better Learning."), deployed as a static Vercel project.

> **Status:** Phase 1.5 (deployment-ready foundation). This is a placeholder
> shell, not the final marketing homepage or school dashboard.

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

## Commands

```bash
npm install        # install dependencies
npm run dev        # start dev server on http://localhost:5173
npm run build      # type-check (tsc -b) and production build to dist/
npm run preview    # preview the production build
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

The official Gradely logo image is not present in this repository yet.
`src/components/BrandMark.tsx` renders a typographic wordmark placeholder.
Drop the official asset into `src/assets/` and update `BrandMark` when it
becomes available.

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
    vite-env.d.ts       # VITE_API_URL type declarations
    components/         # shared UI pieces (BrandMark)
    routes/             # HomePage (placeholder), NotFoundPage
```
