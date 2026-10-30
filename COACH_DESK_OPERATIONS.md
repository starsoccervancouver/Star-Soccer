# Coach Desk release operations

The guarded local release entry is `node scripts/release-coach-desk.mjs --check` (also the default). It requires committed source with no untracked files, fetches `origin/main`, verifies exact source-tree parity, validates the existing ignored live configuration without printing it, and rebuilds current assets. It does not deploy.

After review, use explicit `--deploy` to run the pinned Wrangler command with existing credentials. A lock in Git's shared directory excludes cooperating releases from other worktrees. An existing lock is never automatically removed: establish whether its owner is still running before manual recovery. Verify both coach entry points after deployment. Keep email sending disabled.

This is a local guard, not centralized release enforcement. Direct Wrangler commands and separate repository clones can bypass its lock. Central CI with protected approval, credential isolation and release history remains future work. Run the automated tests and browser checks before release. No tested production backup/restore or rollback procedure is supplied here; establish one for durable coach state before changes that risk stored data, and rehearse recovery using isolated copies. Never copy production credentials or private records into release artifacts or logs.

Provider backup availability, retention and restoration are not verified by this script. Account recovery also needs an independently verified owner recovery procedure for the hosting provider, Google sign-in and the existing credential store. Keep those recovery records private and separate from this repository.
