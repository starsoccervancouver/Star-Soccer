# Tactics board and animated drills

Open **Coach Desk → Session planner → Tactics board & animated drills** after choosing a dated session.

1. Start a new board or use the passing-triangle starter.
2. Add team markers, cones, balls and goals. Drag a piece, or select it and tap a destination. Arrow keys offer precise positioning.
3. Add a phase, then move the pieces to their next positions. Repeat for the drill's progression.
4. Play the sequence to rehearse the movement. Pause, return to a phase or reset to the beginning to explain it.
5. Save the diagram to the session. The text plan saves separately.

The board supports full-pitch, half-pitch and blank setups, labels, adjustable phase timing and undo/redo. Markers are generic; roster names are never inserted automatically. It animates straight movement between phases, not freehand curved paths, video analysis or an exported movie.

## Sharing and storage

Diagrams are shared with assigned coaches and full-access accounts for their session. Player notes retain their separate privacy rules. The authenticated API checks session access and real session existence before listing, saving or archiving a board. Saves use expected versions, so an older editor cannot overwrite another coach's change.

Data is structured JSON with strict allowed fields, bounded coordinates and stable piece IDs. No uploaded SVG, executable markup, remote image or external media is accepted. Limits are 40 pieces, 12 phases and 20 active diagrams per session. Playback and drafts remain in memory, pause when hidden, and clear at sign-out. Saved diagrams persist in the existing private SQLite store; attendance and Airtable records are untouched.

## Product references

The interaction follows common coaching patterns demonstrated by [TacticalPad's formation tutorial](https://www.tacticalpad.com/edu/formation.php), [TacticalBoards](https://tacticalboards.com/) and [Sport Session Planner](https://www.sportsessionplanner.com/): arrange a clear setup, show movement, and reuse preparation. The design, code and passing-triangle starter are original. No vendor assets, paid drill content or third-party account is required.

## Verification

`node --test tests/coach-tactics.test.cjs` checks data bounds, permissions, version conflicts, archives, session limits and database persistence. The fictional browser suites `tests/coach-tactics-ui.cjs` and `tests/coach-tactics-integration.cjs` exercise the editor, animation, mobile layout, request bridge and draft protection. All browser test traffic is intercepted; tests never use live attendance or parent accounts.
