# Infinity Orbs v1.2.53 — release candidate

## Combat
- Player Speed is now an equipment-driven flat stat and no longer automatically grows with dungeon depth.
- Boots always roll a Speed affix; selected lightweight gear slots can roll Speed too.
- Enemy Speed continues to scale with depth.
- Player health bars distinguish normal HP (green), overhealth (yellow), and shields (blue); defense labels appear when present.

## Main roll screen
- Restored Latest Discovery and Next Horizon to the right-hand desktop sidebar.
- Centered the left-side roll controls and panels around the orb.

## Reliability and test coverage
- Chrono Flow reduces active cooldown as well as its minimum floor.
- Admin mechanic fixtures can clear premium booster timers so earlier Full Test steps don't contaminate later ones.
- Full Test assertions now account for account-derived roll counts, multi-roll activations, and the actual seeded values.
- Added regression tests for gear Speed, depth-independent player Speed, colored health segments, and the desktop discovery sidebar.

Prepared as a release candidate. This commit is not deployed to Devvit.
