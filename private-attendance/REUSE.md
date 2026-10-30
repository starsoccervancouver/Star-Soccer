# Reuse Coach Desk for another club

Coach Desk is designed as **one club per isolated deployment**. It is not a shared multi-tenant database, a marketplace, or an automatically activated hosted product. Star Soccer continues to use its existing live service and approved accounts.

## Public brand configuration

`club-config.json` controls the club name, HTTPS public-site link, timezone, visible training weekdays, and a light accent color. Weekdays use JavaScript numbering: Sunday 0 through Saturday 6. This config contains no contacts, record identifiers, credentials, permissions or capacity controls. The build rejects unknown fields, unsafe URLs, invalid timezones, duplicate weekdays and dark accents with poor contrast against dark labels. Use your own local `web/logo.svg`; do not include third-party tracking in the logo.

The same-origin `club-config.js` is generated at build time. Staff information is still available only through authenticated, role-scoped routes. Changing public branding can never approve a coach or increase capacity.

## Prepare a separate source starter

From the original repository, create a public JSON file with the new club’s settings, then run:

```sh
node scripts/export-coach-desk.mjs /absolute/path/new-club /absolute/path/club-config.json
```

The destination must be new, outside the existing source, with an existing real parent directory. The export reads an explicit source allowlist and creates a manifest. It never traverses private folders. It excludes operating records, outputs, Git history, live configs, generated bundles, credentials, `.wrangler`, and installed dependencies. The new starter has a generic logo and placeholder identity defaults. It refuses activation until an explicit new origin and owner identity are configured. Its Worker name is distinct, and all activation/write flags remain disabled.

The reusable package includes coach notes, shared plans, staff roles, dated rosters, manual physical-attendance commands, and UI tools. **Star Soccer’s parent email templates, program prices, payment messages, marketing site and incoming-email workflow are not part of the reusable product.** Parent response and parent-admin routes are disabled for custom origins and permanently disabled in exported starters. A future parent workflow needs its own club-specific review, consent, contact verification and tests.

## Provision a new club

1. Create a separate repository and a distinct Cloudflare Worker with a **new SQLite Durable Object namespace**. The binding must point to the new Worker’s `AttendanceCoordinator`; never use `script_name` to bind to Star Soccer. Do not copy any database, credentials, staff sessions or operational config from another club.
2. Create a separate Airtable base matching the schema expected by `airtable-roster.mjs` and `coach-attendance.mjs`, or deliberately implement and test another roster adapter. The current adapter still requires linked families, players, dated sessions, accepted coverage, verified contacts and the documented field names. This is not an arbitrary spreadsheet importer.
3. Set server-only `COACH_ORIGIN` to the exact HTTPS workspace origin, `COACH_OWNER_EMAIL` to the new owner’s exact approved email, and `COACH_OWNER_NAME` to their chosen display name. Owner configuration must match an existing database owner; changing it does not transfer ownership and instead fails closed. Do not reuse old session cookies or passkeys across domains.
4. Provision fresh `AIRTABLE_TOKEN`, `AIRTABLE_CONFIG`, `ADMIN_KEY`, and `COOKIE_KEY` as private secrets. Keep the roster write-approval evidence scoped to the new base, table, allowed fields, dates and exclusive writer. Capacity remains 20 per dated session. Missing or expired approval must be resolved explicitly, not bypassed.
5. Create the new club’s Google OAuth client with only `openid email`, registering exactly `COACH_ORIGIN/workspace/api/auth/google/callback`. Provision its private `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Approve the owner/test users in Google and in Coach Desk; no unknown email can become an owner by signing in. Retain explicit Google account allowlists and role checks.
6. Install dependencies with the lockfile; run the included tests and build. Run role-isolation, mobile, duplicate-write, timezone and provider-sign-in checks in a non-production environment. Use fictional fixtures only. Confirm the new deployment cannot access any other club’s base or namespace.
7. Review the resulting domain, schema, initial owner, source diff and funding limits with the new owner before setting activation flags. Parent emailing stays disabled. The export does not deploy or create cloud credentials.

## Existing Star Soccer deployment

Do not change its Worker name, Durable Object migration/namespace, Google redirect, approved owner or protected Airtable mapping. Its unset new identity variables deliberately retain the established Star Soccer defaults. Its existing parent routes remain available. No data migration is required for the branding and coaching-tool release.

The new club’s public site can link directly to `/workspace` on its own coach domain. Keep public marketing pages outside this private application’s deployment, just as Star Soccer’s main site links to Coach Desk. Source edits and live deployment remain separate, reviewable steps.


## Tactics and animated drill setups

The session planner includes a private 2D tactics board. Coaches can place generic team markers, cones, balls and goals; duplicate phases; move pieces between phases; and play the movement sequence. Boards belong to a dated session and share its coach assignment permissions. They never use player identities automatically and never update attendance, capacity, parent replies or payment records.

The existing private SQLite store adds the `coach_diagrams` table and session index with `CREATE IF NOT EXISTS` on startup. No existing tables or rows are replaced, no Airtable fields change, and no Cloudflare namespace migration is required. Save/archive operations are audited and use expected versions to reject conflicting edits. Session text plans and diagrams save independently. Unsaved boards and undo history stay in memory and clear on sign-out; nothing is saved to browser storage.

The source-only export includes the board, strict data validator, backend routes and isolated tests. Other clubs receive their own empty store, branding, approved accounts and session assignments. There are no third-party tactics libraries, licensed drill templates, parent messages or additional credentials.

## Day-first session planning

The workspace starts with recurring training groups. A group opens its next scheduled session, with dates selectable only inside that group. The roster exposes a verified existing Weekly program link as programId; recurrence also requires the same weekday, time and venue. Distinct programs or slots are never combined. Unmapped rows are grouped for browsing only and share no cross-date note history. Both group and player note history are scoped to the verified recurring group. New drawer notes use the existing private note endpoint and permissions, with uncertain-save readback before any retry.

Drill ideas, animated tactics and the session run sheet open in drawers. Closing a drawer preserves drafts and pauses playback; changing sessions, refreshing or signing out retains the existing discard checks. All new UI state stays in memory. No schema, credentials, attendance records, capacity rules or email behavior change.

## Profile and workspace preferences

Settings & profile groups account details, Team & access, the activity log and existing coaching records. Owner/admin/coach permissions remain enforced by the same server routes. Only the owner can manage accounts; activity and legacy records remain restricted to full-access users.

The starting view, layout spacing and reduced interface motion are optional browser preferences. Only these three validated presentation choices are saved under `coach-desk-display-v1`; no names, emails, player data or permissions are written to browser storage. Preferences apply to that browser and can be restored to defaults. Profiles show existing account details rather than providing a second permission editor.

## Coach Desk audit improvements

The planner keeps an in-progress session available, clears stale plan content when a load fails, and offers an explicit retry. Notes have search, limited history with a load-more control, and dictation in the planner drawer. Follow-ups support title and due-date edits, session filtering and search; drafts retain their original session, and saves preserve record versions and authors. Draft guards cover navigation, session changes, refresh and sign-out, while uncertain saves are checked against saved records before another attempt.

Coaches can copy an accessible session's tactics setup into a new unsaved setup without changing its source. The run sheet compares activity timers with the recorded session length and warns when unsaved plan edits are missing from field or print views. These changes use existing authenticated routes and records: no database or Airtable migration, new credentials, attendance changes, capacity changes or email activation is required.

The source-only starter includes the four audit browser suites and their shared fixture assets. After installing dependencies and Chromium (`pnpm exec playwright install chromium`), run `pnpm test:audit:browser` alongside the existing unit, planner, settings and tactics checks. All browser scenarios use fictional data and intercepted requests; no production account or connection is needed.

## Focused planning and reusable drills

Training groups are the entry point. Choosing a group opens its next session in a full-screen workspace with Attendance, Session plan and Player & group notes sections; Back to groups and Home are the explicit exits. Recorded dates are selected only inside the group. Draft checks cover session plans, notes, tactics and reusable drill edits. Repeated typing no longer rebuilds supporting panels when their data has not changed. Returning to the same loaded plan reuses the in-memory result; Refresh roster reloads the saved plan and server versions still reject concurrent edits.

The drill archive uses an additive `coach_drills` table and author index in the existing private SQLite store. Startup uses `CREATE TABLE IF NOT EXISTS`; no existing rows, Airtable fields, namespace, credentials, roster or attendance behavior are changed. Coaches see their own drills; owner/admin accounts can access all drills while the original author is retained. Creates use an author-scoped request ID, edits require the expected version, and archive is a soft deletion. Saved session text remains independent of a drill being edited or archived. The library can store validated diagram data, but the current editor creates text drills; dated animated setups remain in the tactics tool.

Suggestions use explicit practice-topic keywords in the already authorized group or selected player's notes. History requires a verified program ID plus matching weekday, time and venue; unmapped sessions use only their own notes. Matching saved drills are offered before original starter ideas. Suggestions explain the topic match and require a coach to add them; they are not assessments or automatic training decisions. No notes go to a third-party AI service or into a shared plan through a suggestion. The archive editor prompts coaches to keep reusable descriptions free of player names or private observations. In-memory drafts, library data and note matching state clear on sign-out or account changes.

The source-only export includes this empty archive schema and its backend, focused-planner and browser privacy tests. Its hosting flags remain disabled for a new club, and no live Star Soccer data or configuration is copied.

## Recurring groups and player folders

The homepage and workspace chooser show groups, never a flat session list. Each selected group has its own date picker, including cancelled dates for read-only history. Player folders show only authorized notes from that verified group, with a separate group-notes folder. A player absent from the selected date can still have their history read, but adding a note requires choosing a date where the player is on the roster. Notes retain their original dated session and author. Main note exports follow the selected folder.

This navigation change needs no Airtable or database migration. Existing notes, plans, attendance IDs, capacity logic and private access rules remain authoritative. All selected-group and folder state is memory-only and cleared on sign-out. The isolated group-workspace, grouping and folder tests cover same-slot program separation, exact write targets, draft guards and privacy. Parent email behavior and scheduled jobs do not change.
