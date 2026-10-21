# Star-Soccer

## Website optimization — 21 October 2026

- Maintained pages load one generated `site.min.css` instead of three stylesheets. Editable sources remain in `styles.css`, `audit-fixes.css`, and `restoration.css`; the build removes unused selectors and minifies without changing source order. Runtime menu, error, receipt, focus and disclosure styles are preserved.
- Homepage hero spacing and cards adapt to narrow screens; full-width sections no longer overflow the scrollbar. The existing hero photo is preloaded and mobile uses an 800px image instead of 1600px. Informational pages no longer download the booking catalog.
- Session filters update the URL, survive reloads and show the next eligible Vancouver training date. Mobile menu links keep keyboard focus visible when navigating to a section.
- Deployment waits for regression checks and publishes an explicit `_site` artifact, excluding development files and old reference screenshots.

Install Node 22 and pnpm 11.25.0, then run:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
python3 tests/check_site.py
pnpm exec playwright install chromium
node tests/browser.cjs
```

For manual browser checks, serve the repository with `python3 -m http.server 8765` and open `http://localhost:8765/tests/browser.html`. It checks ten pages at 375, 900, 1024 and 1440px, filters, keyboard navigation and mocked form responses. No test sends a real registration. The CI runner blocks external network calls. Inbox delivery and live Core Web Vitals are not measured by these checks.

After editing HTML, JS or source CSS, run `pnpm build` and commit `site.min.css` with the source change. Update the stylesheet query version in maintained pages when releasing a new stylesheet so returning visitors receive it. CI rejects stale generated output and CSS exceeding 60 KB raw / 14 KB gzip. To prepare a public artifact locally, run `node scripts/stage-site.cjs` from a clean checkout. Add new public asset types to its allowlist when needed.

See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for booking rules and the boundaries of static registration.
