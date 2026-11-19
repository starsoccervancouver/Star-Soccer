# Coach Desk release operations

## Gmail intake

The owner connects the Star Soccer account from **Settings → Gmail and Airtable** at the main Coach Desk entry. Enable the Gmail API in the Google Cloud project that owns the existing web OAuth client. Gmail consent uses its registered Coach Desk callback and requests `gmail.readonly` with offline access. Settings shows connection status, the last check and retry errors. Disconnect removes the stored refresh token and cancels the cloud alarm.

An isolated Cloudflare Durable Object checks Gmail history every five minutes while connected. It drains queued changes between checks. On first connection it reads the preceding day and existing Deposited notices. Gmail history expiration triggers catch-up from the last scan. Source lives in `private-attendance/gmail-cloud.mjs`, `gmail-message.mjs` and `gmail-ledger.mjs`. Run `node --test tests/gmail-sync.test.cjs` to verify changes using fictional records.

Inquiries enter **Email Intake**. Structured registrations also enter **Website Registrations** for placement review. An authenticated incoming Interac notice with the owner's **Deposited** label can create a verified family receipt. Applying money to a booking requires an unambiguous match. Airtable calculates the resulting balances. Review unresolved matches in **Email Intake → Needs clarification** and check existing allocations before applying a receipt manually.

The guarded local release entry is `node scripts/release-coach-desk.mjs --check` (also the default). It requires committed source with no untracked files, fetches `origin/main`, verifies exact source-tree parity, validates the existing ignored live configuration without printing it, and rebuilds current assets. It does not deploy.

After review, use explicit `--deploy` to run the pinned Wrangler command with existing credentials. A lock in Git's shared directory excludes cooperating releases from other worktrees. An existing lock is never automatically removed: establish whether its owner is still running before manual recovery. Verify both coach entry points after deployment. Keep email sending disabled.

This is a local guard, not centralized release enforcement. Direct Wrangler commands and separate repository clones can bypass its lock. Central CI with protected approval, credential isolation and release history remains future work. Run the automated tests and browser checks before release. No tested production backup/restore or rollback procedure is supplied here; establish one for durable coach state before changes that risk stored data, and rehearse recovery using isolated copies. Never copy production credentials or private records into release artifacts or logs.

Provider backup availability, retention and restoration are not verified by this script. Account recovery also needs an independently verified owner recovery procedure for the hosting provider, Google sign-in and the existing credential store. Keep those recovery records private and separate from this repository.
