# Star Soccer Coach Desk and attendance service

This folder contains editable application source. Private player records, parent contacts, coach notes, authentication sessions, tokens and credentials live in the protected services, not in this repository.

The public Star Soccer website links to `https://attendance.starsoccer.ca/workspace`. Google sign-in checks approved staff accounts. Coaches see their assigned sessions and their own notes; owner-approved full-access accounts can see all coaching records. Public GitHub source does not grant access to those records.

## Where to make changes

- `web/workspace.html`: dashboard structure and form controls.
- `web/workspace.css`: layout, branding and responsive styles.
- `web/workspace.js`: attendance views, notes, planning and staff actions.
- Other `web/workspace-*.js` files: optional coaching or dictation features added alongside the core workspace.
- `coach-http.mjs`: authenticated routes, browser security headers and request validation.
- `coach-store.mjs`: staff roles, private notes, tasks and session plans.
- `coach-auth.mjs` and `coach-google-auth.mjs`: staff authentication.
- `coach-attendance.mjs`: validated physical attendance commands.
- `cloudflare/production-worker.mjs`: protected Worker and Durable Object integration.
- `cloudflare/build-assets.mjs`: generates the reviewed browser and font bundle.
- `club-config.json`: public club name, main-site link, timezone, weekday display and accent.

## Reuse for another club

Coach Desk now has a validated public brand configuration and a source-only export tool. Read [REUSE.md](REUSE.md) to create a disabled starter with a generic logo, fresh identity requirements and a distinct Worker name. Every club needs its own private database, roster connection, approved owner and Google sign-in client. The export excludes operating data, credentials and live configuration; it does not deploy anything. Custom deployments expose only the coach workspace, not Star Soccer’s parent emails, payment or registration workflows.

## Coaching tools

The overview highlights unfinished attendance in the last 28 days, due note reviews and open follow-ups from the signed-in coach's authorized records. Note categories and review-date filters make the next action easier to find. Tasks have separate open/completed views. Expected participation never counts as coach-marked attendance.

In Session planner, open **Run this session** for a saved-plan field view, an optional three-stage timer and a printable plan with the full named roster. Unsaved edits are not included. Private coaching notes, parent contacts and after-session reflections are excluded from the print sheet. The timer pauses when you leave the view or switch apps; it does not write records.

The coaching-week agenda opens a dated roster or plan directly. Player development views bring together authorized coaching observations, review dates and recorded physical attendance. Unmarked attendance stays separate from an absence, and no performance rating is inferred.

The preparation, scheduling and review patterns draw on official product documentation from [PlayMetrics](https://home.playmetrics.com/clubs/coaching-and-player-development), [TeamSnap](https://teams-help.teamsnap.com/article/2970-teamsnap-one-mobile-guide-staff-parents-and-players), [Spond](https://help.spond.com/app/en/articles/129730-features-in-events) and [Hudl](https://www.hudl.com/sports/soccer). Coach Desk uses its own implementation, wording and original practice activities.

The practice toolbox offers original starter activities filtered by age group and skill. Adding an activity changes the editable draft only. A coach can also start from another authorized session's saved plan; this leaves the source unchanged and does not copy its reflection. The coach must review the draft and choose Save shared plan.

Notes and each planning field support browser-native dictation when the browser exposes SpeechRecognition. This API has limited browser availability, so the app provides device voice-typing guidance when unavailable. Recognition begins only after the coach presses a Dictate button and grants the browser's microphone permission. The browser's speech provider may process audio; the app does not claim that transcription stays on the device. Coach Desk does not upload or store audio, and it does not automatically save dictated text. The coach can edit the transcript before saving. Switching sessions, editing the target or signing out stops the active dictation context.

## Install and validate

Use Node.js 22.13 or later and the project's pnpm lockfile. From the repository root:

```sh
pnpm install --frozen-lockfile
node --test tests/*.test.cjs
node tests/coach-workspace-ui.cjs
node tests/coach-google-ui.cjs
node tests/coach-attendance-week-ui.cjs
node tests/coach-qol-ui.cjs
node tests/coach-responsive-ui.cjs
node tests/coach-dictation-ui.cjs
node tests/coach-coaching-ui.cjs
node tests/coach-workbench-integration.cjs
node private-attendance/cloudflare/build-assets.mjs
```

Browser tests use fictional fixtures and mocked requests. They do not require operating Airtable credentials and must not send messages or write real attendance. The older loopback-only attendance demonstration can be started with `node private-attendance/demo.mjs`; it is a fictional parent-response demonstration, not a bypass into Coach Desk.

## Source edits and deployment

Editing or merging this source in GitHub does not automatically update the live Coach Desk. GitHub Pages deploys the public marketing site only and must exclude this entire folder from its staged artifact.

Coach Desk is a separate Cloudflare Worker with its existing Durable Object. Its tracked example configuration remains disabled. Deployment requires the approved private configuration and the existing securely stored service credentials. Validate changes, review the source diff, and deploy through the separate Cloudflare process. Do not replace or recreate the production Durable Object, publish a private configuration, or place credentials in GitHub source.

The existing service uses the named secrets `AIRTABLE_TOKEN`, `AIRTABLE_CONFIG`, `ADMIN_KEY`, `COOKIE_KEY`, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Only their names belong in source. Real values, database exports and staff sessions must stay outside the repository. Never upload `data/`, `.state/`, `.wrangler/`, `.dev.vars`, live configuration files or generated private drafts.

Operating base/table/field mappings belong in the protected configuration. Physical-attendance fields default to descriptive column names and may be supplied as one complete field-ID map; mixed name/ID maps are rejected. Legacy coaching notes default to the descriptive table name or a configured table mapping. The source contains no operating record export.

## Data and communication rules

Airtable remains authoritative for dated rosters and coach-marked physical attendance. A parent's response is separate from the coach observing a player at training. Four-session passes and camps are confirmed by registration. Capacity checks stay at 20 for each dated session; no browser view may expand capacity or create bookings.

Session plans are shared with the coaches assigned to a session and approved full-access staff. Individual coach notes remain restricted by author and role. No public-page code should contain operating roster records or parent contact information.

Parent communication and invitation preparation remain manual/draft-only. This source publication does not enable scheduled email routing, send invitations, accept payments or change live attendance.
