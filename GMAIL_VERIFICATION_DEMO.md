# Coach Desk Gmail verification demo

Use this walkthrough to record the Google OAuth review video in English. Use a separate staging mailbox and ledger containing fictional data. Keep the browser address bar visible on Google’s consent screens so the reviewer can see the OAuth client ID. Use a clean browser profile and pause recording before entering credentials.

Google requires an [unlisted YouTube video showing the actual consent flow and feature](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification). Run the offline rehearsal first. For the recording, use a staging setup with a real Google OAuth flow and identify the setup in the verification form if it uses a separate test project.

## Offline rehearsal

From the repository root, run:

```sh
node --test tests/gmail-sync.test.cjs
```

The test suite uses fictional messages, in-memory storage, and mock Google and Airtable responses. It exercises owner consent, inquiry and registration classification, and deposit reconciliation without connecting to a mailbox, submitting forms, or writing to a live ledger.

## Fictional data for the recording

| Example | What to show |
| --- | --- |
| **Coaching inquiry** | Sender display name **Jordan Example**. Subject **Soccer camp availability — demo**. Body **Is there room for Alex Example in the winter camp?** Send from a controlled test mailbox to the staging mailbox. Show it in **Email Intake** as a question. |
| **Camp registration** | Use a staging form configured to notify the staging mailbox. Enter guardian **Jordan Example**, player **Alex Example**, age **10**, and **Winter Camp — Week 1 morning**. Use a controlled test address for any required email field. Show the generated reference and the resulting **Website Registrations** row awaiting review. |
| **Deposit review** | Rehearse with the fictional payment fixture in `tests/gmail-sync.test.cjs`. It uses a CAD 60 notice and booking `BOOK-100`. For a recorded staging walkthrough, label an explicitly fictional test notice **Deposited** and show that an unauthenticated notice goes to **Needs clarification**. The app verifies a deposit only when the notice passes its sender, authentication, reference, and amount checks. |

For the deposit review example, use a test sender and label the message **Payments - Incoming** as well as **Deposited** in the isolated mailbox. Use the sample text below. No transfer needs to be sent.

```text
Subject: Interac e-Transfer: EXAMPLE PARENT sent you $60.00. Demo notice

Message: for BOOK-100
Transfer Details
Reference Number: DEMO123456
Sent From: EXAMPLE PARENT
Amount: $60.00 (CAD)
```

## Recording order

1. Open [Star Soccer Coach Desk](https://starsoccer.ca/coach-desk.html) and show its privacy link. In staging, choose **Continue with Google** and show the basic staff sign-in. Explain that sign-in verifies the staff account.
2. In the staging owner workspace, open **Settings & profile → Gmail and Airtable**. Choose **Connect Star Soccer Gmail**. Show the app name, the OAuth client ID in the address bar, the read-only Gmail permission, and the full grant flow in English. If Google displays the unverified-app screen for the test account, include it in the recording. Grant access only to the staging mailbox.
3. Return to Coach Desk and show **Connected**. Bring the fictional inquiry and registration into the staging workspace. Show the relevant email fields and their matching **Email Intake** and **Website Registrations** rows. Show the test deposit in **Needs clarification**. Explain that message bodies supply registration details and payment references that headers alone cannot provide.
4. Disconnect the staging mailbox. Show that the connection is off and that the existing ledger records remain. Point viewers to the privacy policy for record requests.
5. Check the recording for credentials, real mail, records, and browser notifications. Upload the English video to YouTube as **Unlisted**, open the link while signed out to verify it plays, then use it in Google Auth Platform’s **YouTube link** field.
