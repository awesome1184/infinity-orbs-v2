# Infinity Orbs v1.2.54 — release candidate

## Combat
- Resolve Delver and enemy strikes on a shared Speed-based timeline instead of batching all player attacks before enemy attacks.
- Faster enemies can hit between Delver strikes or get the opening attack when their Speed threshold comes first.

## Social
- Added a **Highest Depth Reached** leaderboard based on saved best depth across Undercrypt, Cinder Vault, and Glass Labyrinth.

## Reliability and test coverage
- Added regressions for Speed-ordered action interleaving, fast-enemy initiative, and all-dungeon peak-depth aggregation.

Prepared as a release candidate. This commit is not deployed to Devvit.
