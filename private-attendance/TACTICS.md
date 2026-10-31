# Tactics board and animated drills

Open **Coach resources → Drills** to create a reusable activity, or open the builder from a dated session.

1. Choose **Drill** for a practice activity or **Team pattern** for positioning, team movements and decisions. Start a new board or use the passing-triangle starter.
2. Add team markers, cones, balls and goals. Drag a piece, or select it and tap a destination. Arrow keys offer precise positioning.
3. Add a phase, then move the pieces to their next positions. Repeat for the drill's progression.
4. Play the sequence to rehearse the movement. Pause, return to a phase or reset to the beginning to explain it.
5. Save the diagram to the session. The text plan saves separately.

The board supports full-field, half-field, facing-goal, away-from-goal and blank setups, labels, zones, adjustable phase timing and undo/redo. Dragged routes preserve curves for players and balls. Markers are generic; roster names are never inserted automatically.

Choose **Draw** and drag on the field to draw a smooth route that ends with an arrowhead. Drawings belong to the selected phase. Select a drawing to move it, drag either endpoint to adjust it, or delete it; undo and redo preserve the curve. Drawings also appear in saved previews, session plans and exported diagrams. Existing straight arrows remain editable. Each arrow can store up to 32 intermediate `points` with bounded `{x,y}` coordinates.

Select a player and open **Body shape & cover shadow** to set their facing direction for that phase. Use the compass, angle slider, **Face the ball**, or the round field handle; arrow keys turn the handle by 15 degrees. Body direction animates through the shortest turn without changing movement routes. Cover shadows extend away from the nearest ball, or behind the body direction when there is no ball. Their length and width can be adjusted per phase. Direction and shadows appear in previews, playback and exported diagrams.

**Body** and **Shadow** in the toolbar add players with these tools already enabled. Drag either tool onto an existing player to attach it for the selected phase. Body direction and shadow follow the player; the shadow also responds to the nearest ball. Attached balls sit close to the player's feet during placement and playback. Using Place pieces or the ball carrier selector does not create movement routes. A drag records movement only in **Record movement**, after the starting phase, once it travels at least three field units (slightly more than one ball-width). Smaller drags adjust the layout across phases, preserving existing routes; meaningful curved drags retain their trajectory.

**Training field** keeps green turf and a boundary without match markings. Camera-view choices are available only on **Full field**; other layouts retain zoom and the thirds guide. **Box** adds a clear rectangular outline instead of four cones. Move the box or drag its corner to resize it; arrow keys also resize the focused corner. Dimensions apply to every phase, and the Outline only checkbox switches between a line box and a shaded zone. Existing zones remain compatible through optional `zone.outline`.

Existing diagrams remain compatible. Optional `purpose` is `drill` or `team-pattern`; absent means Drill. Player positions may include `facing` (0–359 degrees) and `shadow: {length, width}` (each 5–60). These values save with the existing diagram JSON; no database migration is required.

## Sharing and storage

Diagrams are shared with assigned coaches and full-access accounts for their session. Player notes retain their separate privacy rules. The authenticated API checks session access and real session existence before listing, saving or archiving a board. Saves use expected versions, so an older editor cannot overwrite another coach's change.

Data is structured JSON with strict allowed fields, bounded coordinates and stable piece IDs. No uploaded SVG, executable markup, remote image or external media is accepted. Limits are 40 pieces, 12 phases and 20 active diagrams per session. Playback and drafts remain in memory, pause when hidden, and clear at sign-out. Saved diagrams persist in the existing private SQLite store; attendance and Airtable records are untouched.

## Product references

The interaction follows common coaching patterns demonstrated by [TacticalPad's formation tutorial](https://www.tacticalpad.com/edu/formation.php), [TacticalBoards](https://tacticalboards.com/) and [Sport Session Planner](https://www.sportsessionplanner.com/): arrange a clear setup, show movement, and reuse preparation. The design, code and passing-triangle starter are original. No vendor assets, paid drill content or third-party account is required.

## Verification

`node --test tests/coach-tactics.test.cjs tests/tactics-player-tools.test.cjs` checks data bounds, permissions, version conflicts, archives, session limits and database persistence. The fictional browser suites `tests/coach-tactics-ui.cjs`, `tests/coach-tactics-integration.cjs` and `tests/coach-builder-editing-ui.cjs` exercise the editor, player tools, animation, mobile layout, request bridge and draft protection. All browser test traffic is intercepted; tests never use live attendance or parent accounts.
