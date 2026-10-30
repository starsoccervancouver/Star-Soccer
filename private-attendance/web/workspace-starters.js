/* Original starter ideas for the unified library. No persistence or network operations. */
(() => {
  'use strict';
  if (!window.CoachLibrary) return;
  const rows=[
    ['Island parking','Ball control',5,8,'4–12',8,'warmup','One ball each; flat cones.','Scatter large cone islands inside a roomy square. Players dribble between islands and stop their ball beside a free island on a signal. Restart with a different route.','Keep the ball near your feet and look for free space. Leave room around each island.','Use fewer islands with space for two players; ask each pair to choose different exits.'],
    ['Mirror the leader','Coordination',5,8,'4–12',8,'warmup','One ball per pair; cones.','Give each pair a wide lane. A leader moves slowly with a ball while a partner mirrors the route from a safe distance. Swap after 30 seconds.','Change direction gradually. The follower watches the leader without crowding.','Give both partners a ball, or try the movement without balls first.'],
    ['Roll, stop, return','Receiving',5,8,'4–10',10,'technical','One ball per pair; flat markers.','Partners face each other a few metres apart. One rolls the ball along the ground; the other stops it with a foot and passes it back. Swap the rolling role frequently.','Meet the ball softly. Check the partner is ready before returning it.','Replace the roll with a gentle pass and alternate the receiving foot.'],
    ['Two-target finish','Finishing',7,11,'4–10',10,'technical','Balls; cones; two small goals.','Set two small goals well apart and a starting spot between them. A player dribbles forward, chooses one goal and passes the ball into it. The next player starts only when the lane is clear.','Look at the target before striking. Aim for accuracy with a balanced standing foot.','Let a partner point to the target before the first touch; shorten the distance when needed.'],
    ['Triangle relay without racing','Passing',7,11,'6–12',10,'technical','One ball and three cones per group of three.','Place three cones in a triangle. Each player starts at a cone. Pass around the triangle, then follow the pass at walking pace, with the receiver moving out to make room. Pause and reset whenever spacing is lost.','Call a name, pass to the available foot and check the path before moving.','Reverse direction or enlarge the triangle. Keep clean passes as the aim.'],
    ['Shadow the dribbler','Defending',8,12,'4–12',10,'technical','One ball per pair; channel cones.','In wide lanes, an attacker dribbles slowly toward an end line. A defender moves backwards to stay between the ball and the line, without tackling. Swap roles each turn.','Stay balanced with small steps. Watch the ball and give the attacker room.','Allow the attacker to vary speed slightly; begin with shorter lanes if needed.'],
    ['Keep the corner free','Support',9,14,'4–12',12,'game','One ball per group of four; four corner markers.','Put three attackers on three corners of a square with one free corner. A passive defender watches from the middle. After a pass, an attacker moves to the free corner to offer a new option. Rotate the defender often.','Look before moving and show a clear passing option. Reset if two players choose the same space.','Let the defender intercept passes once the group can keep its spacing.'],
    ['End-zone partners','Combination play',9,14,'6–12',12,'game','Ball; bibs; cones for two end zones.','Play three versus three or four versus four. A team scores by completing a controlled pass to a teammate arriving in the far end zone. Players leave the zone after each attempt.','Time the arrival so the passer has a clear option. Leave space for the receiver to stop.','Add a neutral helper or widen the pitch to make successful combinations easier.'],
    ['Switch the point','Width',10,14,'8–14',12,'game','Balls; bibs; four cone targets.','Play a small-sided game with two wide cone targets at each end. Score by passing through either attacking target. Restart from the defending end after a score.','Look across the pitch when one side becomes crowded. Support behind the ball as well as ahead.','Add a neutral player, or require the team to try a different target after each score.'],
    ['Recover and reconnect','Transition',11,14,'6–12',12,'game','Balls; two colours of bibs; boundary cones.','Play a possession game in a generous rectangle. After losing the ball, the nearest player slows the new ball carrier while teammates recover into useful supporting positions. Pause briefly to show a clear example, then restart.','Communicate early and recover under control. Keep contact appropriate to the group.','Give the new team a short unopposed restart if immediate pressure makes the game too difficult.'],
  ];
  // Original schematic positions; adapt spacing to the players present.
  const positions = [
    [['cone',25,25],['cone',70,30],['cone',50,75],['home',20,50],['home',65,65],['ball',25,50],['ball',70,65]],
    [['home',40,30],['home',25,30],['ball',45,30],['cone',15,15],['cone',85,45]],
    [['home',25,50],['home',75,50],['ball',40,50],['cone',15,25],['cone',85,75]],
    [['home',25,50],['ball',32,50],['goal',85,25],['goal',85,75],['cone',15,50]],
    [['home',25,25],['home',75,25],['home',50,75],['cone',20,20],['cone',80,20],['cone',50,83],['ball',33,25]],
    [['home',30,50],['away',55,50],['ball',38,50],['cone',15,25],['cone',85,25],['cone',15,75],['cone',85,75]],
    [['home',25,25],['home',75,25],['home',75,75],['away',50,50],['cone',25,75],['ball',33,25]],
    [['home',25,35],['home',45,70],['home',80,40],['away',60,30],['away',65,70],['away',35,55],['ball',30,35],['cone',85,12],['cone',85,88],['cone',15,12],['cone',15,88]],
    [['home',25,50],['home',55,25],['home',65,75],['away',50,50],['away',70,35],['ball',30,50],['goal',90,20],['goal',90,80],['goal',10,20],['goal',10,80]],
    [['home',30,35],['home',65,30],['home',50,75],['away',40,40],['away',70,70],['away',30,70],['ball',45,40]],
  ];
  window.CoachLibrary.registerCatalog('starter', rows.map(([title,skill,minAge,maxAge,players,minutes,target,equipment,setup,coaching,progression],index) => ({
    id:'original-' + (index + 1), title, skill, minutes, target, equipment, coaching, progression,
    band:maxAge <= 9 ? 'young' : maxAge <= 12 ? 'middle' : 'older', ages:minAge + '–' + maxAge, players:players + ' players',
    setup:'Ages ' + minAge + '–' + maxAge + '; ' + players + ' players.\n' + setup,
    diagram:window.CoachLibrary.createDiagram(title, positions[index]),
  })));
})();
