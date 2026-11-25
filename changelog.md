# Infinity Orbs Changelog

### New in 2.2.40

- **Rift First-Clear Posts:** Publishing a challenge's first completion now creates a dedicated Rift achievement post with animated visuals and separate Play and Kudos actions.
- **Kudos Rewards:** Each viewer can Kudos a first-clear post once within 24 hours. The viewer receives 10 Shards, the champion receives 10 Shards, and the champion's Rift Bar receives one minute of progress.
- **Rift Kudos Counters:** The Rift menu tracks Kudos received in the last 24 hours and since the previous game opening.
- **Rift Administration:** The Admin Console now includes searchable Rift controls for inspecting player archives and granting Rift Points or progress time.
- **Frenzy Shard Reward Popup:** Frenzy owner Shard rewards now have a dedicated configurable popup, analytics, and an admin-only preview that grants nothing.


### New in 2.2.39

- **Reddit Review Retry:** Reissues the existing 2.2.38 candidate under a new patch version because Devvit does not allow an already-created AppVersion to be submitted again. No gameplay changes.

### New in 2.2.38

- **Review Release:** Same gameplay and notification code as the dev-tested v2.2.37 build. No gameplay changes in this version bump.

### New in 2.2.37

- **Game Update Preset:** Admins send a fixed Game Update notification rather than composing arbitrary copy. Players receive the title “Infinity Orbs Update” and the message “A new update is live! Jump back in and see what's changed.”
- **Two-Push Daily Budget:** Offline Orbs and Game Update notifications share Reddit's limit of two pushes per player per day. Updates that hit the limit are queued and sent after the next UTC day begins.
- **Quota-Aware Offline Reminders:** Full Offline Orbs reminders are retried after the daily push allowance resets instead of getting stuck after a provider-side quota rejection.
- **Scheduler Client Fix:** Runtime jobs now use the Devvit scheduler client from `@devvit/web/server`, not the unavailable `context.scheduler` property. This fixes campaign scheduling and existing offline reminder scheduling.

### New in 2.2.36

- **Independent Push Notification Types:** Players can separately enable or disable Game Updates and Offline Orbs reminders from the header bell menu. Existing Reddit notification opt-ins retain both alert types until changed.
- **Targeted Update Broadcasts:** Manual admin notifications now go only to players who enabled Game Updates; Offline Orbs-only players are excluded. Offline storage reminders respect the separate Offline Orbs preference.
- **Notification Audience Breakdown:** Admin statistics show separate counts and opt-in rates for Game Updates and Offline Orbs.
- **Admin Broadcast Button Fix:** The Send Notification button remains clickable when the composer needs input and now shows inline validation rather than silently disabling or relying on a native confirmation dialog.

### New in 2.2.35

- **Manual Reddit Push Broadcasts:** Admins can send a short push notification to every Reddit account opted in to Infinity Orbs. The campaign is processed in bounded scheduled batches, with live send status in the admin console.
- **Notification Audience Metrics:** The admin console shows the number of opted-in players and their percentage of all registered accounts.
- **Push-Return Session Tracking:** The player list marks currently active sessions following an offline-full or manual push sent while that account was offline. This is a correlation signal, not a provider-confirmed notification click.
- **Offline Orb Reminder Attribution:** The existing scheduled full-storage reminder records a return-session marker after Reddit accepts the push.

### New in 2.2.32

- **Guild Name Attribution:** Restore direct custom guild names and the original 2–5 character tag field. Each member's Reddit user flair now reads `GuildName - HighestOrbTier`, with the guild name tied to their Reddit account. Existing pending custom-name requests are restored during a one-time migration.
- **Guild Flair Sync:** Create, join, leave, and kick actions update member flair while the existing rarity-based flair color remains intact.

### New in 2.2.31

- **Reddit Review Release:** Reissues the v2.2.30 post-flair reliability fix as a new version for Reddit review. No additional gameplay changes.

### New in 2.2.30

- **Reddit Post Flair Reliability:** Share and Frenzy resolve existing subreddit flair-template IDs before applying labels. If no matching template exists or flair lookup fails, the post is created without flair instead of failing.

### New in 2.2.29

- **Guild Tag Safety:** The name picker hides a letter choice whenever it would complete a blocked or already-used three-letter tag, regardless of which name part is selected last. The server independently rejects blocked or duplicate tags.

### New in 2.2.28

- **Guild Name Approval Reliability:** Correctly normalize and reserve legacy names during migration, recover pending approvals with missing queue records, and skip redundant requests for names identical to the public fallback.
- **Guild Ownership & Identity:** Transfer ownership when the administrator moves between guilds, and use Reddit user IDs consistently when resolving guild perks and combo bonuses.
- **Guild Approval Queue:** Refresh the complete admin queue after a review so duplicate or stale entries do not remain visible.

### New in 2.2.27

- **Guild Name Approval:** Guild creators can privately request a custom name. New guilds use curated three-part public names until the administrator approves custom names. Existing custom guild names are migrated to curated public fallbacks and placed in the private review queue. Only the administrator can approve or reject requests, and pending request text is excluded from public Guild data.

### New in 2.2.26

- **Devvit Review Release:** Reissues the v2.2.25 storage and Codex optimization build as a new patch version for Reddit review. No gameplay changes from v2.2.25.

### New in 2.2.25

- **Redis Storage Reduction:** Player, combat, Guild, and leaderboard JSON now use backward-compatible DEFLATE compression. Redundant player projections are no longer duplicated in durable saves, diagnostic logs have smaller limits and a 14-day expiry, and the legacy leaderboard recovery index stores a compact account-ID projection.
- **Codex Precision:** Rarities at or below 1/10,000 remain exact. Higher rarities share four-significant-digit Codex buckets, and Codex devotion advances through those bucket steps. Existing Codex data migrates to a verified versioned shard namespace before old shards are retired.
- **100 MB Storage Reporting:** Admin storage diagnostics now calculate capacity against the unapproved-app 100 MB allowance. Impression analytics retention is unchanged.

### New in 2.2.24

- **Time Energy HTTP 503 Prevention:** Increased the bounded online roll pass from 10 million to 100 million effective Orbs while keeping the 4,096 representative-sample limit. A 300-million-Orb claim now needs four passes instead of roughly 31, reducing repeated roll setup and progress writes; weighted counts remain exact.

### New in 2.2.23

- **Large Roll Throughput:** Online roll processing now handles up to 10 million effective Orbs per server chunk instead of 500,000. The 4,096 representative-sample budget remains bounded, and a 300-million-Orb Time Energy batch is reduced from roughly 600 chunks to roughly 30.
- **Mobile Combat Navigation:** Combat navigation is pinned to the bottom of mobile screens. Fight, Dungeons, Gear, and Skills remain visible; Runes, Forge, and Arena are in a bottom-dock More menu, with Back to Orbs inside the menu.

### New in 2.2.22

- **Time Energy Live Progress:** Large Time Energy spends now show server-reported Orb counts and a Frenzy-style progress bar. The overlay remains through the durable reward save and reaches 100% only after the save commits.
- **Guild Collection Value Scaling:** Collection Value Guild Tasks now rise much more aggressively, reaching approximately 1.5e85 at Tier 100. Existing tasks migrate to the new target curve without discarding saved progress.
- **Mobile Combat Skill Details:** Tapping a Combat Skill Gacha icon on mobile opens a readable detail sheet with the full effect, rarity, rank, duplicate progress, and equip action.

### New in 2.2.12

- **Redis Storage Protection:** Leaderboard projections now refresh at most once per player per minute, and duplicate or stale callbacks are skipped. Retired shared large-value snapshots expire after 60 seconds instead of 10 minutes.
- **Guild Data Compatibility:** Fixed production Guild validation so current Guild records without the retired level and XP fields load correctly.


### New in 2.2.3

- **Auto Roll Cooldown Reliability:** Fixed Auto Roll occasionally retrying too early at very high speeds. It now waits for the server-reported remaining cooldown before trying again.
- **Sonar Ping Menu:** Removed the duplicate Record alerts summary. Near-best and new-record trigger settings remain in the Sonar Ping options.

### New in 2.2.2

- **Time Energy Generation:** Cooldown Reclaimer now earns 1% of your current roll cooldown per level with each normal manual or Auto Roll activation, including at the 300ms cooldown floor. Free Rolls, Chain Patcher rolls, and Time Energy-powered rolls do not generate more energy.

### New in 2.2.0

- **Celestial Alignments:** Unlock a rare event and choose one of three temporary effects within 60 seconds: Starseeker raises ordinary Luck, Golden Orbit grants +50% Coins, or Clockwork makes Auto Roll 20% faster. Each chosen effect lasts 2 hours and stacks independently with earlier activations, with its own countdown.
- **Time Energy Bank:** Time Energy banks recovered roll cooldown and can fund multiple complete manual or Auto Rolls. Unused partial energy carries forward.
- **Sonar Ping Controls:** Choose whether Sonar pings on non-record Orbs within 10% of your current best or only on a new record. You can also allow Celestial Alignment sounds while Sonar is blocking other sounds.
- **Three New Rune Rarities:** Astral, Celestial, and Transcendent Runes now extend the Rune rarity ladder beyond Cosmic.
- **Rarity-Scaled Rune Abilities:** Higher-rarity Runes now grant stronger Rune Major Abilities, and Rune details show the rarity-scaled effect strength.
- **Guild Task and Combo Progress:** Rare-Orb Guild tasks count every qualifying Orb earned, including rewards from large Multi Rolls. Guild Combos show the time remaining compared with the total time you earned.
- **Rarity Milestone Orbs:** Collection milestones and the rarity table now use recognizable, rarity-colored Orb icons, with a glow for tiers you have discovered.
- **Responsive Orb Results:** Orb results now fit the screen: fullscreen displays use 9 Orbs per row, while mobile displays use 3 across. Game and Combat screens also adapt more cleanly to phones, tablets, and desktop.
- **Faster Mobile Gear Equipping:** Unequipped Gear items on mobile now have an Equip button right on the inventory card, so you do not need to open the item inspector first. Desktop Gear tiles are more compact.
- **Upgraded Main-Game Post:** The in-feed game preview has a larger animated infinity-orb energy field, with Continue playing anchored at the bottom of the card.
- **Frenzy Claim Activity:** Embedded Frenzy posts now show the claim count and the five most recent players who claimed that Frenzy.

### New in 2.0.0

- **Major feature — Combat Mode:** Added Combat as a separate game mode, unlocked at Core Level 8, with a guided introduction and its own progression.
- **Major feature — Three Expeditions:** Added Undercrypt, Cinder Vault, and Glass Labyrinth. Each dungeon tracks its own best depth and has a boss every tenth depth.
- **Major feature — Dungeon Runs:** Added automatic dungeon runs, selectable combat tactics, manual actions, persistent health between encounters, and new-run resets.
- **Major feature — Gear, Forge & Abilities:** Added seven gear slots, randomized gear stats and traits, quality rolls, nonlinear gear power, the Forge, Scrap, and 30 Gear Major Abilities.
- **Major feature — Combat Skill Gacha:** Added 35 active skills. Duplicate skills increase ranks, making repeated pulls useful.
- **Major feature — Arena:** Added asynchronous player-build battles against recently active players, with rating and win/loss records.
- **Major feature — Rune System:** Added seven Rune rarities, from Common through Cosmic. Monsters drop Runes; bosses always drop one and elites have improved drop odds.
- **Major feature — Rune Loadouts:** Rune loadouts improve core-game Orb Luck, Coins, Shard chance, and XP. Unlock more Rune slots through Delver levels and dungeon depth, then strengthen Runes by sacrificing duplicates or enabling Auto Sacrifice.
- **Core game — Push Notification Opt-In:** Added a one-time push notification prompt. Notifications stay off unless enabled, and the prompt explains the limited alerts and the bell control for changing the setting later.
- **Core game — First-Roll Tutorial:** Added a first-roll tutorial that introduces rolling an Orb, the result screen, Upgrades, and the Codex. It can be skipped at any time.
- **Core game — Aftershock:** Added Aftershock, a Mastery skill that provides Critical Luck based on the best dry interval between successive all-time rarity records.
- **Core game — Unbroken Momentum:** Added Unbroken Momentum, a Prestige upgrade that grants permanent roll Speed based on the longest uninterrupted online rolling session.
- **Core game — Codex Devotion:** Updated Codex Devotion to show its current Luck bonus and the bonus from the next level.
- **Core game — Chain Patcher:** Added Chain Patcher to the Codex. It guarantees the cheapest missing rarity adjacent to the longest consecutive Codex chain on the next accepted roll, for a Shard cost and with a 24-hour purchase cooldown.
- **Core game — Shared Orb Frenzies:** Shared Orb Frenzies can be claimed by multiple different players during the post’s lifetime. Each player still has their own claim cooldown.
- **Core game — Rune Inventory Improvements:** Added Rune inventory search, equipped filters, level and XP progress, capacity warnings, and clearer Strengthen and Auto Sacrifice controls.
- **Core game — Global Chat & Player Sessions:** Improved Global Chat status messaging when posting is unavailable and added active-session length to the player list.
- **Core game — Main-Game Visual Feedback:** Made the first dozen rolls easier to spot with a brighter Orb stage, a clear first-roll action, and a restrained pulsing Roll button. Newly discovered Orbs receive a short visual highlight; reduced-motion preferences are respected.
- **Core game — Post Previews & Play CTA:** Revamped main-game, shared-Orb, and Frenzy previews with animated Orb visuals and a glowing, pulsing Play button that makes starting the game unmistakable.
- **Core game — Frenzy Reward Reveal:** Reworked Frenzy rewards into a full animated Orb reveal with orbiting effects, visible personal claim cooldowns, post-expiry timer, and a persistent Play button. Main-game and shared-Orb posts now feature animated Orb energy effects.
- **Core game — Frenzy Roll Payouts:** Frenzies now grant ordinary random Orb rolls instead of guaranteeing the posted Orb rarity. Payouts use the full Multiball multiplier, with Frenzy Volley adding a separate +20% bonus; the post shows your exact personal roll count.
- **Core game — Infinity Overflow:** Rolls whose calculated rarity exceeds JavaScript’s largest finite number now display as 1/Infinity. The finite 1.797693e308 rarity remains a numeric rarity.
- **Balance change — Repeatable Upgrade Costs:** Unlimited repeatable core-game upgrades cost 15% more; capped Roll Speed and Offline Generation Speed keep their existing cost curves.
- **Balance change — Supernova Critical Scaling:** Supernova now multiplies the normal critical multiplier instead of replacing it, so it remains powerful as Critical upgrades grow.
- **Balance change — Mastery Engine Removed:** Mastery Engine has been removed for balancing purposes.
- **Bug fix — Notification Prompt:** Fixed the one-time push notification prompt for returning players.
- **Bug fix — Silent Alert Mode:** Fixed Silent Alert Mode’s toggle becoming out of sync with the active sound mode.
- **Bug fix — Combat Encounter Effects:** Fixed encounter effects carrying into a new run.
- **Bug fix — Shared Orb Previews:** Fixed shared Orb previews rejecting valid large rarity values.
- **Bug fix — Leaderboard Recovery:** Kept older shared-Orb leaderboard entries visible when legacy records are missing account IDs.
- **Bug fix — Frenzy Claims & Post Performance:** Fixed Frenzy claims so the main game consumes the armed handoff and plays the reward-batch reveal; centered orbit rings, smoothed their rotation, reduced shared-Orb glow, and kept skill details open long enough to equip abilities.
- **Bug fix — Rune Controls:** Fixed Rune controls so Equip, Strengthen, and Auto Sacrifice actions no longer conflict when used in quick succession.
