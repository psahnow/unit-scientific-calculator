# Dimensional

*Every number knows its units.* Dimensional is a unit-aware engineering calculator in the browser, laid out like an engineering notebook: an expression list with folders, variables, functions, sliders, tables and notes (no graphing). Planned home: `calculator.perrysahnow.com`. The design spec is in [DESIGN.md](DESIGN.md).

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine unit tests (Vitest)
npm run build      # type-check + production build into dist/
```

## Deploy to Cloudflare Pages

It's a static site with no backend. Worksheets are saved in the browser's localStorage and can be exported or imported as `.usc.json` files.

**Git integration (dashboard):** Workers & Pages → Create → Pages → connect the repository. Use these settings:

- Framework preset: *None* (or Vite)
- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable (recommended): `NODE_VERSION=22`

**Direct upload (CLI):**

```bash
npm run build
npx wrangler pages deploy dist --project-name dimensional
```

`wrangler.toml` already sets `pages_build_output_dir = "dist"`. `public/_headers` sets long-term caching for the hashed assets.

## Layout

- `src/engine/` — pure TypeScript math and unit engine (exact rationals, dimensions, unit catalogue, smart simplify, LaTeX parser, evaluator, worksheet dependency resolution)
- `src/state/` — Zustand store: undo/redo and localStorage persistence
- `src/ui/` — React components (MathLive inputs, unit chips, unit dropdowns, rows, tables, sliders)
- `public/mathlive-fonts/` — MathLive math fonts, served locally
