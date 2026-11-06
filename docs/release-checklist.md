# Ready-to-release checklist

Status as of 6 November 2026. ✅ = done and verified · ⬜ = your action · ❓ = decision for you (at the end).

## Correctness
- ✅ 476 engine tests pass (`npm test`), including the independent-oracle correctness suite (D43): every unit, prefix and constant against NIST SP 811 / CODATA 2022, plus thousands of random conversions, unit arithmetic, functions, calculus and formatting cases. Deeper runs at 3,000 cases × 4 seeds pass.
- ✅ The suite catches planted bugs: a wrong unit factor, an extra displayed digit, a wrong trig identity, a perturbed Γ coefficient, an over-eager snap.
- ✅ Bugs it found are fixed: d/dx far from 0, second derivatives, and limits picking their noisiest estimate. Numeric results show only digits they can vouch for.
- ✅ Impossible displays are refused with a message, never shown wrongly (e.g. 300 K in °C; see decision 1).

## App
- ✅ 12 browser tests pass against the production build (`npm run test:e2e`). They cover typing, dropdowns, toolbox, drag, undo, export/import, phone keyboard ↵ and ÷, no sideways scroll, no layout shift, and no console errors on load.
- ✅ The design study fixes are in (D42), for desktop and phone in light and dark.
- ✅ Error boundaries per row and for the app; a storage failure warns the user to Export.
- ✅ The welcome card says worksheets live in this browser only and to Export a copy.
- ✅ Offline: the service worker precaches a build-stamped file list; each deploy replaces the old cache.
- ✅ No analytics, cookies or network calls; fonts are served locally.

## Hosting (Cloudflare Pages)
- ✅ `wrangler.toml` (`pages_build_output_dir = "dist"`).
- ✅ `public/_headers`:
  - Immutable caching for `/assets/*`; `no-cache` for `sw.js` and `precache.json`.
  - Security headers: nosniff, Referrer-Policy, X-Frame-Options DENY, Permissions-Policy.
- ✅ `robots.txt`, manifest, icons (192/512/maskable/apple), OG image, and a canonical URL for dimensional.perrysahnow.com.
- ⬜ Push `main` to GitHub. It is 10+ commits ahead of `origin/main`, and nothing has been pushed by me.
- ⬜ Create the Pages project:
  - Connect the repo.
  - Build command `npm run build`, output `dist`.
  - Env `NODE_VERSION=22`.
- ⬜ Custom domain: Pages project → Custom domains → `dimensional.perrysahnow.com`. Cloudflare adds the CNAME if the zone is on Cloudflare.
- ⬜ After the first deploy, check these:
  - The site loads over HTTPS.
  - `/sw.js` returns `Cache-Control: no-cache`.
  - Response headers include `X-Content-Type-Options`.
  - Install the app on a phone (Add to Home Screen), go offline, and reload.
  - Paste the URL into a chat app to see the OG card.

## Decisions for you
1. **Kelvin to °C/°F.** A typed `300 K` counts as a temperature *difference*, so its dropdown refuses °C/°F with a message. Typing `27 °C` converts to K and °F fine. Should a bare K value be treated as absolute when shown in °C/°F? This is common in thermo work, but it changes the rule that kept differences safe.
2. **Licence.** There is no LICENSE file. Choose one of:
   - All rights reserved (the default with no file).
   - MIT/Apache to open-source it.
   - Keep the repository private.
3. **Repository name.** The repo is still `unit-scientific-calculator`. Rename it to `dimensional`? GitHub redirects the old URL; update `origin` afterwards.
4. **Version.** `package.json` says `0.1.0`. Call the launch `1.0.0`?
5. **Analytics.** None today. Cloudflare Web Analytics is cookieless and can be switched on in the dashboard with no code change, if you want visitor counts.
6. **Content-Security-Policy.** Not set, because MathLive injects inline styles and a wrong policy would break the page in production only. It could be added and tested on a preview deploy before launch.
