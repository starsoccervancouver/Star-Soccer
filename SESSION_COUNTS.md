# Session counts

Every weekly group has a 20-player capacity, approved by the owner on October 21, 2026.

The private operating ledger calculates counts for each dated session. Only accepted bookings with active, valid coverage for an active player are counted. A player counts once per session even if duplicate coverage exists. Payment and attendance do not change a registered place. Cancelling coverage or a booking removes that place.

The separate **Star Soccer | Public Session Counts** workbook imports only the six-column aggregate `SESSION COUNTS` view. It is shared as a viewer link; the owner is the only editor. Keep the operating ledger private. Do not replace the website feed URL with the operating ledger URL, or add personal information to the public workbook.

`session-counts.js` reads the public workbook as data, validates its six columns, and refreshes every minute while the page is visible. Google spreadsheet imports and caching can delay changes. The checked time means the website fetched the feed, not that Google recalculated the source at that moment. Failed reads discard displayed counts. Missing dates are unavailable, never assumed empty, and show a **Contact us for availability** email link with the public session date. Full and cancelled sessions also link to the coaching team. The status below the list distinguishes a failed feed from missing dated rows.

The schedule shows each group's next date. Registration shows counts for each selected date, including every date in a four-session pass. Full, over-capacity and cancelled sessions have explicit labels. Counts do not provide an atomic reservation mechanism; the team must confirm a place before payment and enter accepted registrations in the ledger. FormSubmit does not write bookings to the ledger.

## Maintaining dates and formulas

- Enter dated sessions in `Sessions`, accepted registrations in `Bookings`, and each covered date in `Coverage`.
- The current ledger formulas cover Sessions rows 6–155 and Coverage rows 6–405. Extend all related formulas and tables together before exceeding those ranges.
- The public import covers the aggregate view through row 155. If that date window is extended, also extend the import formula and `session-counts.js` range. A date outside the window shows count unavailable.
- Add counts only through the private ledger; do not overwrite the public `IMPORTRANGE` formula.
- If ownership or sharing changes, verify the import permission and the public feed again.

Read-only verification on October 29, 2026 returned HTTP 200 with the expected six columns, 33 valid dated rows, and a CORS response permitting `https://starsoccer.ca`. The four next youth sessions all had a record. The feed's last date at that check was December 13, 2026; later dates must continue to show unknown availability until the public export includes them. This observation does not establish a refresh guarantee or prove that every operating booking has been reconciled.

## Verification

Run `npm run build`, `npm test`, `python tests/check_site.py`, and `node tests/browser.cjs`. Browser tests mock all external requests, including the count feed and forms. Check the real public feed and registration preview separately without submitting a form.

`tests/registration-attendance-journey.test.cjs` connects a fictional accepted sibling roster to a personalized confirmation draft, scoped attendance buttons, the hosted response handler and an injected Airtable readback. It checks that a preview cannot save attendance, one sibling's response cannot change the other, and a retry cannot duplicate the write. The test makes no real external requests or sends.

The tracked source does not contain a FormSubmit-to-roster intake worker or an email sender. Form-service acceptance, staff acceptance into the roster, delivery of a confirmation email, and the saved parent response are separate stages. The isolated test begins at an already accepted roster; it cannot prove live inbox delivery or the external/manual reconciliation stage. Keep those stages separate when reporting completed bookings.
