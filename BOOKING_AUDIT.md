# Booking audit changes — 29 October 2026

The public site keeps its existing design and approved prices. This release clarifies confirmation and attendance, adds multiple players to weekly and camp forms, recommends a cheaper eligible camp package, improves count-feed failures, and makes adult training and privacy information easier to find.

## Registration contracts

- Each child is submitted separately using the existing intake version and a stable client reference. A family reference links sibling requests. The price on each request is that child's price; the visible family total is the sum. This is not an atomic family booking.
- A definitive provider rejection can be retried with the same reference. Partial success or uncertain delivery freezes the form and provides a reference-only email recovery link. Accepted requests are not automatically resent.
- A successful form response means the request was received by the provider. The coaching team must confirm roster space and payment instructions. Attendance is answered using the confirmation's buttons, then saved with Confirm response.
- Drop-ins show the upcoming date beside submission and require review if it rolls over while the page is open. Arbitrary future drop-in selection remains unavailable because the external SS-WEEKLY-V2 intake derives the next eligible date. Four-session passes retain their supported start-date selector.
- The full-week camp suggestion only appears when it is cheaper and every date in that package remains bookable. Switching requires an explicit click. No rate or discount has changed.

## Measurement boundaries

`registration-funnel.js` exposes `starsoccer:funnel` events and a bounded in-memory `StarFunnel.events()` list for an analytics adapter. There are no new network requests, cookies, persistent identifiers or browser storage. Allowed event details contain only the program and booking kind; form values, URL parameters and references are excluded.

- `program_view`: one per relevant page load.
- `registration_start`: the first input, selection or submit on that page.
- `submission_accepted`: once per accepted player request, or per accepted inquiry.

These hooks are ready for a collector, but this release does not install one or claim a measured conversion funnel. `booking_confirmed` must come from the authoritative roster/intake process, never a browser success screen. Reconcile confirmations and actual payments separately. Sibling acceptance counts are player requests, not families.

## Verified and still outstanding

The public count feed returned valid data for all upcoming youth sessions on the audit date. See SESSION_COUNTS.md for its date horizon and fallback behavior. Do not replace a missing count with zero or expose private roster information.

Unit and browser tests use fictional players and mocked external calls. The isolated attendance journey covers accepted roster data, a personalized confirmation draft, a saved response and mock database readback. It does not prove real FormSubmit inbox delivery, live intake processing, outgoing email delivery or live payment reconciliation. Those systems are outside this public-site release.

Real photos, verified coach credentials, genuine testimonials, fixed cancellation/refund/weather/missed-session policies, retention decisions, camp grouping/pickup procedures and Selectivo launch details still require owner-supplied facts. The site links to the team for questions instead of inventing those details.
