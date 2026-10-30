# Star-Soccer

See [BOOKING_AUDIT.md](BOOKING_AUDIT.md) for the October 29 booking, sibling-registration, privacy and measurement changes, including the boundaries of live confirmation verification.

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

For manual browser checks, serve the repository with `python3 -m http.server 8765` and open `http://localhost:8765/tests/browser.html`. It checks ten pages at 320, 375, 430, 900, 1024 and 1440px, readable mobile controls and touch targets, filters, keyboard navigation and mocked form responses. No test sends a real registration. The CI runner blocks external network calls. Inbox delivery and live Core Web Vitals are not measured by these checks.

Mobile refinements put the main session button on the homepage's first screen, reduce nested coaching-card padding, make footer links easier to tap, use 16px form controls, and provide a direct jump from the booking summary to player details.

After editing HTML, JS or source CSS, run `pnpm build` and commit `site.min.css` with the source change. Update the stylesheet query version in maintained pages when releasing a new stylesheet so returning visitors receive it. CI rejects stale generated output and CSS exceeding 60 KB raw / 14 KB gzip. To prepare a public artifact locally, run `node scripts/stage-site.cjs` from a clean checkout. Add new public asset types to its allowlist when needed.

After changing page titles/descriptions or the public training catalogs, also run `pnpm build:search`. It refreshes the existing JSON-LD graphs from those sources: shared organization and public venue identities, plus the weekly/private/winter services on their corresponding landing pages. `node scripts/build-search-data.cjs --check` rejects drift in CI. Parks remain public training venues, never a company headquarters; coaching history does not establish an organization founding date. Visible parent FAQs remain useful content without deprecated FAQ rich-result markup. No analytics or registration behavior is changed by this build.

See [RELEASE_CHECKLIST.md](RELEASE_CHECKLIST.md) for booking rules and the boundaries of static registration.

Payment communication: the booking summary shows the destination and cash option before submission. After acceptance, the receipt offers a text download with the booking reference, dates, location, total and payment instructions. It contains no child name, guardian name or contact email. A receipt confirms form-service acceptance and does not verify payment; staff must reconcile actual payments in the private operating ledger.

## Weekly-group growth workflow — 21 October 2026

Each session now has a Copy session link action. Links contain only an approved weekday; inbound age filters and other query values are never copied. A day-specific link opens the matching booking options. Clipboard denial exposes a selectable URL instead.

Registration, contact and private-inquiry forms include an optional parent-reported referral source. The submitted value is restricted to the displayed choices; no analytics provider, tracking cookie or extra browser storage was added. Record this source alongside the booking in the private operating ledger after receiving the submission; no automatic website-to-ledger sync is implied. Source capture in a mocked payload does not prove live inbox delivery.

Unconfirmed registrations offer an email recovery draft containing only the booking reference and public session details. Personal form entries stay on the form and are not inserted into that URL. A retry uses the same reference so staff can check for duplicate attempts. Existing acceptance and payment-verification boundaries remain in force.

Measure the next two weeks by received inquiries with a source, first attendance, and subsequent paid/repeat attendance. Establish an actual baseline before claiming improvement. Existing public rates and all household agreements are unchanged. Form regression tests are mocked; this workflow does not authorize another live FormSubmit test.
