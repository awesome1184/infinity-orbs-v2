import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { context, redis } from '../src/server/devvit-mock.js';
import { getPopupConfig, getPopupStats, recordPopupEvent, setPopupConfig } from '../src/server/game.js';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

test('Frenzy Shard popup settings default on for older installs and persist admin toggles', async () => {
  const original = await getPopupConfig();
  try {
    await redis.set('io:popup-config:v1', JSON.stringify({
      notification: true,
      frenzy: true,
      joinSubreddit: true,
    }));
    const migrated = await getPopupConfig();
    assert.equal(migrated.frenzyShard, true);

    const disabled = await setPopupConfig({ frenzyShard: false });
    assert.equal(disabled.frenzyShard, false);
    assert.equal((await getPopupConfig()).frenzyShard, false);

    const enabled = await setPopupConfig({ frenzyShard: true });
    assert.equal(enabled.frenzyShard, true);
  } finally {
    await setPopupConfig(original);
  }
});

test('Frenzy and notification popups render with dedicated styling and admin previews', () => {
  const main = read('src/client/main.tsx');
  const styles = read('src/client/styles.css');
  const admin = read('src/client/components/DevDebugModal.tsx');
  const shared = read('src/shared/game.ts');
  const pagesApi = read('src/pages/api.ts');

  assert.match(main, /showFrenzyPrompt && \(/);
  assert.match(main, /className="io-modal-card io-frenzy-prompt/);
  assert.match(main, /Post today’s Frenzy/);
  assert.match(main, /frenzyShardPopupPending/);
  assert.match(pagesApi, /case '\/api\/frenzy\/shard-popup\/ack'/);
  assert.match(main, /className="io-modal-card w-full max-w-md overflow-hidden border border-fuchsia-400\/35/);
  assert.match(admin, /Preview Frenzy Shard Popup/);
  const activeAdminModal = main.slice(main.lastIndexOf('<DevDebugModal'));
  assert.match(activeAdminModal, /onForceFrenzyShardPopup=\{\(\) => \{/);
  assert.match(activeAdminModal, /setFrenzyShardPopup\(\{ amount: FRENZY_OWNER_SHARD_REWARD, eventCount: 1, preview: true \}\)/);
  assert.match(shared, /frenzyShard: true/);
  assert.match(admin, /no Shards and records no metrics/);

  assert.match(main, /showNotificationPrompt && \(notificationPromptPreview \|\| !notificationsEnabled\) && \(/);
  assert.match(main, /className="io-modal-card io-notification-prompt/);
  assert.match(main, /data-testid="notification-prompt"/);
  assert.match(main, /aria-modal="true"/);
  assert.match(main, /Allow push notifications\?/);
  assert.match(main, /notification-prompt-enable/);
  assert.match(main, /notification-prompt-dismiss/);
  assert.match(main, /Admin Preview · Notification settings will not change/);

  assert.match(admin, /Popup Testing/);
  assert.match(admin, /Force Frenzy Popup/);
  assert.match(admin, /Preview Notification Popup/);
  assert.match(admin, /onForceNotificationPopup\?\.\(\)/);

  assert.match(styles, /\.io-frenzy-prompt\s*\{/);
  assert.match(styles, /\.io-notification-prompt\s*\{/);
  assert.match(styles, /\.io-notification-prompt-note\s*\{/);
});

test('notification prompt works for returning players and admin preview does not opt them in', () => {
  const main = read('src/client/main.tsx');
  const server = read('src/server/game.ts');
  const header = read('src/client/components/Header.tsx');

  assert.match(main, /const \[notificationsEnabled, setNotificationsEnabled\] = useState\(false\)/);
  assert.match(main, /We’ll only send the types of alerts you choose: game updates and reminders when your offline Orbs are full\./);
  assert.match(main, /This prompt will only appear once\./);
  assert.match(main, /You can change your choice later with the bell icon\./);

  assert.match(main, /io-notification-prompt-shown-v2/);
  assert.match(main, /const \[notificationSettingsLoaded, setNotificationSettingsLoaded\] = useState\(false\)/);
  assert.match(main, /notificationSettingsLoaded/);
  assert.match(main, /Math\.max\(0, Number\(state\.totalRolls\) \|\| 0\) < 5/);
  assert.match(main, /!splashEntered/);
  assert.match(main, /const dismissNotificationPrompt = \(\) =>/);
  assert.match(main, /if \(notificationPromptPreview\)/);
  assert.match(main, /Preview closed; your notification setting was not changed\./);
  assert.match(main, /setNotificationPromptPreview\(true\)/);
  assert.doesNotMatch(main, /maybePromptForNotifications/);

  assert.match(header, /Push notifications/);
  assert.match(header, /Choose each type independently/);
  assert.match(header, /aria-label="Notification settings"/);
  assert.match(header, /role="switch"/);
  assert.match(header, /Game updates/);
  assert.match(header, /Offline Orbs/);
  assert.match(server, /export async function getNotificationState/);
  assert.match(server, /return \(await getNotificationPreferences\(userId\)\)\.enabled/);
  assert.match(server, /await notifications\.optInCurrentUser\(\)/);
  assert.match(server, /await notifications\.optOutCurrentUser\(\)/);
});


test('popup metrics persist real popup events for shadow_fen while admin previews remain untracked', async () => {
  // The test runtime must not invent Redis methods absent from production Devvit.
  assert.equal(typeof redis.incrBy, 'function');
  assert.equal(typeof redis.incr, 'undefined');
  const previousUsername = context.username;
  try {
    context.username = 'popup-metrics-test-player';
    const before = await getPopupStats();
    const normalResult = await recordPopupEvent('notification', 'shown');
    const afterNormal = await getPopupStats();
    assert.equal(normalResult.recorded, true);
    assert.equal(afterNormal.notification.shown, before.notification.shown + 1);

    // The developer account can validate real events. Only the explicit admin
    // preview path is excluded; this is separate from post-impression analytics.
    context.username = '/u/shadow_fen';
    const developerResult = await recordPopupEvent('notification', 'shown');
    const afterDeveloper = await getPopupStats();
    assert.equal(developerResult.recorded, true);
    assert.equal(developerResult.excluded, undefined);
    assert.equal(afterDeveloper.notification.shown, afterNormal.notification.shown + 1);

    const shardBefore = await getPopupStats();
    const shardShown = await recordPopupEvent('frenzyShard', 'shown');
    const shardAfter = await getPopupStats();
    assert.equal(shardShown.recorded, true);
    assert.equal(shardAfter.frenzyShard.shown, shardBefore.frenzyShard.shown + 1);

    const main = read('src/client/main.tsx');
    assert.match(main, /if \(notificationPromptPreview\)[\s\S]*?return;[\s\S]*?trackPopupEvent\('notification', 'dismissed'\)/);
    assert.match(main, /if \(frenzyPromptPreview\)[\s\S]*?return;[\s\S]*?trackPopupEvent\('frenzy', 'dismissed'\)/);
    assert.match(main, /if \(joinSubredditPreview\)[\s\S]*?return;[\s\S]*?trackPopupEvent\('joinSubreddit', 'dismissed'\)/);
  } finally {
    context.username = previousUsername;
  }
});

test('popup analytics dashboard refreshes live and surfaces tracking failures', () => {
  const admin = read('src/client/components/DevDebugModal.tsx');
  const main = read('src/client/main.tsx');
  const app = read('src/server/app.ts');
  assert.ok(admin.includes('setInterval(() => void loadPopupAnalytics(true), 15_000)'));
  assert.ok(admin.includes('Popup analytics refresh failed:'));
  assert.ok(main.includes('[Popup Analytics] Failed to record event:'));
  assert.ok(app.includes('[Popup Analytics] Failed to persist popup event:'));
});
