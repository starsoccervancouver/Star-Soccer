---
name: check-registration-relay
description: Verify Star Soccer's Gmail intake, Airtable registration, and Coach Desk family view when an owner asks whether a registration arrived, whether its tracking fields survived, or whether it was duplicated.
---

# Check the registration relay

For a code check, run `node --test tests/gmail-sync.test.cjs` in the repository root. The relay test sends an authenticated sample registration through the parser and ledger writer twice and reads it through the Coach Desk family ledger. It runs in memory.

For a live check, use the owner's connected Star Soccer sources. Read **Coach Desk → Settings & profile → Gmail and Airtable** for the connection state, last check and any retry error. Use the existing connection. Google Cloud manages Gmail API authorization. The Cloudflare Worker polls Gmail history and Coach Desk reads the resulting Airtable links.

1. Start with the exact Gmail message ID or the registration reference supplied by the owner. If asked for the latest, read the most recent **Website Registrations** row by **Received at** and follow its **Source Gmail ID**. When checking for a missing registration, start from the incoming Gmail message.
2. In **Star Soccer | Operations Ledger**, match **Email Intake → Message ID** and **Website Registrations → Source Gmail ID**. Compare the submitted player reference, visit ID, landing path and campaign source with the registration row. Preserve missing fields. For sibling submissions, check each reference and allow a shared visit ID.
3. Follow the registration's **Family** link by Airtable record ID, then locate the same registration reference under **Coach Desk → Families → Registrations**. If the family link is missing or ambiguous, report the row for owner review. Keep inquiries and unresolved payment notices in their own intake categories.
4. If the question concerns automatic creation, read the original Airtable revision separately from later edits. The Worker records successful processing through the ledger rows. An API token and matching creation time alone cannot distinguish an alarm from a replay using the same credentials.

Report which steps were verified, the two source links available to the owner, and any discrepancy. Omit guardian contact details and child names. Live verification uses reads only. Surface an unavailable source as a verification gap. Keep parent messages and credentials out of model prompts and logs whenever a field comparison can run locally.
