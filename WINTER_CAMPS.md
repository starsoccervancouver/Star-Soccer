# Winter camps 2026/27

Owner confirmed Kitsilano Turf, ages 5–14 and supervised noon–12:30 lunch for players attending both sessions on October 26, 2026.

- December 21–25: $200 per morning or afternoon package. Monday–Thursday allocate $50 per date and slot; December 25 is free. Both daily blocks total $400.
- December 28–January 1: $185 per morning or afternoon package, 15 training hours. Both daily blocks total $370. Per-date package allocation is $37 per slot.
- Drop-ins: $60 per three-hour slot, except December 25 which is free. Both slots are $120 per paid drop-in day.
- Morning 9 AM–noon; afternoon 12:30–3:30 PM. Capacity 20 per dated slot. Lunch supervision is included for both-slot bookings; bring a packed lunch.

`winter-camps.js` calculates dates, eligibility and price. `camp-booking.js` submits weekly package registrations from separate Christmas Week and Boxing Week registration pages through the existing form provider. Drop-ins do not require advance registration; record their actual attendance and e-transfer payments in the ledger. Provider acceptance does not verify inbox delivery, reserve capacity or prove payment. No live form test was sent. Prices and capacity must be confirmed operationally before accepting a booking; public client-side validation is not server-side enforcement.

Twenty `Planned` dated session records were created in the existing Airtable Dated Attendance table, with source keys `winter-<week>-<slot>:YYYY-MM-DD`. They are seasonal sessions and deliberately have no recurring Weekly program link. No family/player, attendance or payment records were created.

Accept each player booking once, charge the selected package once, then link dated attendance coverage for each included slot. A full-day player consumes one place in both slots. Absence or unpaid status does not automatically release a place. Free Friday still needs a confirmed roster entry and must remain a zero charge.

The public weekly count feed remains the existing aggregate Google source. Camp requests display approved capacity and coach confirmation rather than inventing live remaining places. The pending Airtable counts bridge needs separate camp mapping; its weekly export must exclude these unlinked seasonal dates. Do not activate an unfiltered weekly-only exporter against mixed dated sessions.

Validation covers Christmas-free pricing, package totals, year-crossing dates, age limits, local session cutoffs, failed service acceptance, duplicate request blocking and mobile receipts. Confirm individual coach assignments, field access and holiday coverage operationally; afternoon camps end at 3:30 while regular Wednesday/Friday groups start at 3:45 if running.
