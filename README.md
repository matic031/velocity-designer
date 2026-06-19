# Velocity Social Studio

A standalone, frontend-only design surface for composing X / LinkedIn social
cards with animated backgrounds. Built with Vite + React + Three.js.

Live site: https://matic031.github.io/velocity-designer/

## Access

The deployed site is behind a client-side password gate. This is a light gate
to keep casual visitors out, not real security: GitHub Pages is static hosting
so there is no server-side auth, and this repo is public, so the source can be
read and run locally by anyone. Do not put anything sensitive behind it.

## Local development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build      # tsc -b && vite build
npm run preview    # serve the production build locally
```

## Deploy

Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds the app
and publishes `dist/` to GitHub Pages. The Pages base path is set to
`/velocity-designer/` in `vite.config.ts` and must match the repo name; if you
rename the repo, update it there.
