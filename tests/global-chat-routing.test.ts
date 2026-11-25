import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configureDevvitRuntime,
  context as originalContext,
  redis as originalRedis,
  reddit as originalReddit,
} from '../src/server/devvit-mock.js';
import { getGlobalChatStatus, postGlobalChatMessage, recordGlobalChatComment, registerCurrentPostAsGlobalChatDestination, resolveGlobalChatCommentAuthor } from '../src/server/social.js';

test('no unregistered ordinary post can become Global Chat destination via launcher=main', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const postId = 't3_spoof-routing-test-' + Date.now().toString(36);
  const gamePostKey = 'io:global-game-post-id';
  const previousGamePost = await baseRedis.get(gamePostKey);

  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, postId, userId: 'chat-routing-test', username: 'ChatRoutingTest' },
    reddit: baseReddit,
  });
  try {
    await baseRedis.del(gamePostKey);
    const result = await getGlobalChatStatus();
    assert.equal(result.enabled, false);
    assert.match(result.reason ?? '', /not registered by the official post-creation flow/);
    assert.equal(await baseRedis.get(gamePostKey), null, 'client-controlled launcher flags must not register arbitrary posts');
  } finally {
    await baseRedis.del(gamePostKey);
    if (previousGamePost != null) await baseRedis.set(gamePostKey, previousGamePost);
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});


test('moderator repair helper registers an existing main post and rejects a registered Frenzy', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const mainPostId = 't3_existing-main-repair-' + suffix;
  const frenzyPostId = 't3_frenzy-repair-' + suffix;
  const gamePostKey = 'io:global-game-post-id';
  const frenzyKey = 'io:frenzy:post:' + frenzyPostId;
  const previousGamePost = await baseRedis.get(gamePostKey);
  const previousFrenzy = await baseRedis.get(frenzyKey);
  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, postId: mainPostId, userId: 'chat-repair-test', username: 'shadow_fen' },
    reddit: baseReddit,
  });
  try {
    await baseRedis.del(gamePostKey);
    const result = await registerCurrentPostAsGlobalChatDestination();
    assert.equal(result.postId, mainPostId);
    assert.equal(await baseRedis.get(gamePostKey), mainPostId);

    const unrelatedPostId = 't3_unrelated-post-repair-' + suffix;
    configureDevvitRuntime({
      redis: baseRedis,
      context: { ...baseContext, postId: unrelatedPostId, userId: 'chat-repair-test', username: 'shadow_fen' },
      reddit: baseReddit,
    });
    await assert.rejects(
      () => registerCurrentPostAsGlobalChatDestination(),
      /A valid main Game post is already registered/,
    );
    assert.equal(await baseRedis.get(gamePostKey), mainPostId, 'an unrelated post must not overwrite a valid main destination');

    await baseRedis.set(frenzyKey, JSON.stringify({ ownerId: 'test-owner', createdAt: Date.now() }));
    configureDevvitRuntime({
      redis: baseRedis,
      context: { ...baseContext, postId: frenzyPostId, userId: 'chat-repair-test', username: 'shadow_fen' },
      reddit: baseReddit,
    });
    await assert.rejects(
      () => registerCurrentPostAsGlobalChatDestination(),
      /A Frenzy post cannot be registered/,
    );
    assert.equal(await baseRedis.get(gamePostKey), mainPostId, 'a Frenzy attempt must not overwrite the canonical target');

    const sharePostId = 't3_shared-orb-repair-' + suffix;
    const shareKey = 'io:shared-orb:post:' + sharePostId;
    const previousShare = await baseRedis.get(shareKey);
    try {
      await baseRedis.set(shareKey, '1');
      configureDevvitRuntime({
        redis: baseRedis,
        context: { ...baseContext, postId: sharePostId, userId: 'chat-repair-test', username: 'shadow_fen' },
        reddit: baseReddit,
      });
      await assert.rejects(
        () => registerCurrentPostAsGlobalChatDestination(),
        /A shared-Orb post cannot be registered/,
      );
      assert.equal(await baseRedis.get(gamePostKey), mainPostId, 'a shared-Orb attempt must not overwrite the canonical target');
    } finally {
      await baseRedis.del(shareKey);
      if (previousShare != null) await baseRedis.set(shareKey, previousShare);
    }
  } finally {
    await baseRedis.del(gamePostKey);
    await baseRedis.del(frenzyKey);
    if (previousGamePost != null) await baseRedis.set(gamePostKey, previousGamePost);
    if (previousFrenzy != null) await baseRedis.set(frenzyKey, previousFrenzy);
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('registered Frenzy Global Chat routes public comments to the canonical main Game post', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const mainPostId = 't3_main-chat-target-' + suffix;
  const frenzyPostId = 't3_frenzy-chat-source-' + suffix;
  const userId = 'chat-frenzy-routing-' + suffix;
  const gamePostKey = 'io:global-game-post-id';
  const frenzyKey = 'io:frenzy:post:' + frenzyPostId;
  const chatKey = 'io:global-chat:v1';
  const cooldownKey = 'io:chat-cooldown:v1:global:' + userId;
  const previousGamePost = await baseRedis.get(gamePostKey);
  const previousFrenzy = await baseRedis.get(frenzyKey);
  const previousChat = await baseRedis.get(chatKey);
  const previousCooldown = await baseRedis.get(cooldownKey);
  let submittedTo = '';
  const commentId = 'route' + suffix.replace(/[^a-z0-9]/gi, '');
  const reddit = {
    ...baseReddit,
    submitComment: async (options: { id: string; text: string; runAs?: string }) => {
      submittedTo = options.id;
      return { id: commentId };
    },
  };
  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, postId: frenzyPostId, userId, username: 'ChatFrenzyTest' },
    reddit,
  });
  try {
    await baseRedis.set(gamePostKey, mainPostId);
    await baseRedis.set(frenzyKey, JSON.stringify({ ownerId: 'frenzy-owner', createdAt: Date.now() }));
    assert.deepEqual(await getGlobalChatStatus(), { enabled: true });
    const message = await postGlobalChatMessage('This should appear on the main Game post.');
    assert.equal(submittedTo, mainPostId);
    assert.equal(message.id, 't1_' + commentId);
  } finally {
    await baseRedis.del(frenzyKey);
    await baseRedis.del(cooldownKey);
    await baseRedis.del(chatKey);
    await baseRedis.del(gamePostKey);
    if (previousFrenzy != null) await baseRedis.set(frenzyKey, previousFrenzy);
    if (previousCooldown != null) await baseRedis.set(cooldownKey, previousCooldown);
    if (previousChat != null) await baseRedis.set(chatKey, previousChat);
    if (previousGamePost != null) await baseRedis.set(gamePostKey, previousGamePost);
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('a stale Frenzy destination fails closed until an official post creation registers a new Game post', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const mainPostId = 't3_main-routing-test-' + suffix;
  const stalePostId = 't3_stale-frenzy-routing-test-' + suffix;
  const gamePostKey = 'io:global-game-post-id';
  const staleFrenzyKey = 'io:frenzy:post:' + stalePostId;
  const previousGamePost = await baseRedis.get(gamePostKey);

  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, postId: mainPostId, userId: 'chat-routing-test', username: 'ChatRoutingTest' },
    reddit: baseReddit,
  });
  try {
    await baseRedis.set(gamePostKey, stalePostId);
    await baseRedis.set(staleFrenzyKey, JSON.stringify({
      ownerId: 'owner-test',
      ownerUsername: 'Owner',
      subredditName: 'infinity_orbs_dev',
      rarity: 100,
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
      inGame: true,
    }));

    const stale = await getGlobalChatStatus();
    assert.equal(stale.enabled, false);
    assert.match(stale.reason ?? '', /invalid Frenzy post/);
    assert.equal(await baseRedis.get(gamePostKey), stalePostId, 'ordinary preview requests cannot rewrite the canonical ID');

    // Simulate the trusted on-app-install/menu post creation hook updating the
    // canonical value to the newly created main Game post.
    await baseRedis.set(gamePostKey, mainPostId);
    const repaired = await getGlobalChatStatus();
    assert.equal(repaired.enabled, true);
    assert.equal(await baseRedis.get(gamePostKey), mainPostId);
  } finally {
    await baseRedis.del(staleFrenzyKey);
    await baseRedis.del(gamePostKey);
    if (previousGamePost != null) await baseRedis.set(gamePostKey, previousGamePost);
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});


test('Global Chat stays available when embedded launcher context differs, but comments always target the canonical Game post', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const mainPostId = 't3_canonical-main-' + suffix;
  const currentPostId = 't3_embedded-launcher-' + suffix;
  const userId = 'chat-canonical-route-' + suffix;
  const gamePostKey = 'io:global-game-post-id';
  const chatKey = 'io:global-chat:v1';
  const cooldownKey = 'io:chat-cooldown:v1:global:' + userId;
  const previousGamePost = await baseRedis.get(gamePostKey);
  const previousChat = await baseRedis.get(chatKey);
  const previousCooldown = await baseRedis.get(cooldownKey);
  let submittedTo = '';
  const reddit = {
    ...baseReddit,
    submitComment: async (options: { id: string; text: string; runAs?: string }) => {
      submittedTo = options.id;
      return { id: 'canonical' + suffix.replace(/[^a-z0-9]/gi, '') };
    },
  };
  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, postId: currentPostId, userId, username: 'ChatCanonicalTest' },
    reddit,
  });
  try {
    await baseRedis.set(gamePostKey, mainPostId);
    assert.deepEqual(await getGlobalChatStatus(), { enabled: true });
    await postGlobalChatMessage('This message must remain on the canonical Game post.');
    assert.equal(submittedTo, mainPostId, 'context.postId must never retarget public chat comments');
  } finally {
    await baseRedis.del(cooldownKey);
    await baseRedis.del(chatKey);
    await baseRedis.del(gamePostKey);
    if (previousCooldown != null) await baseRedis.set(cooldownKey, previousCooldown);
    if (previousChat != null) await baseRedis.set(chatKey, previousChat);
    if (previousGamePost != null) await baseRedis.set(gamePostKey, previousGamePost);
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});


test('trusted admin repairs stale Frenzy destination only from a valid main Game post', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const mainPostId = 't3_admin-chat-repair-' + suffix;
  const stalePostId = 't3_admin-stale-frenzy-' + suffix;
  const gamePostKey = 'io:global-game-post-id';
  const frenzyKey = 'io:frenzy:post:' + stalePostId;
  const previousGamePost = await baseRedis.get(gamePostKey);
  const previousFrenzy = await baseRedis.get(frenzyKey);
  try {
    await baseRedis.set(gamePostKey, stalePostId);
    await baseRedis.set(frenzyKey, JSON.stringify({ ownerId: 'test-owner', createdAt: Date.now() }));
    configureDevvitRuntime({ redis: baseRedis, context: { ...baseContext, postId: mainPostId, userId: 'trusted-chat-admin-' + suffix, username: 'shadow_fen' }, reddit: baseReddit });
    assert.deepEqual(await getGlobalChatStatus(), { enabled: true });
    assert.equal(await baseRedis.get(gamePostKey), mainPostId);
    await baseRedis.set(gamePostKey, stalePostId);
    configureDevvitRuntime({ redis: baseRedis, context: { ...baseContext, postId: 't3_ordinary-chat-view-' + suffix, userId: 'ordinary-user-' + suffix, username: 'OrdinaryViewer' }, reddit: baseReddit });
    assert.equal((await getGlobalChatStatus()).enabled, false);
    assert.equal(await baseRedis.get(gamePostKey), stalePostId);
  } finally {
    await baseRedis.del(frenzyKey);
    await baseRedis.del(gamePostKey);
    if (previousGamePost != null) await baseRedis.set(gamePostKey, previousGamePost);
    if (previousFrenzy != null) await baseRedis.set(frenzyKey, previousFrenzy);
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});



test('Global Chat bounds external Reddit comments before persisting its single-key history', async () => {
  const baseContext = originalContext;
  const baseRedis = originalRedis;
  const baseReddit = originalReddit;
  const suffix = Date.now().toString(36);
  const postId = 't3_chat-size-bound-' + suffix;
  const chatKey = 'io:global-chat:v1';
  const gamePostKey = 'io:global-game-post-id';
  const previousChat = await baseRedis.get(chatKey);
  const previousPost = await baseRedis.get(gamePostKey);

  configureDevvitRuntime({
    redis: baseRedis,
    context: { ...baseContext, postId, userId: 'chat-size-test-' + suffix, username: 'ChatSizeTest' },
    reddit: baseReddit,
  });
  try {
    await baseRedis.set(gamePostKey, postId);
    await baseRedis.set(chatKey, JSON.stringify([]));
    const longComment = String.fromCharCode(1).repeat(10_000);
    const message = await recordGlobalChatComment({
      postId,
      commentId: 'size' + suffix.replace(/[^a-z0-9]/gi, ''),
      text: longComment,
      username: 'LongCommenter',
    });
    assert.ok(message);
    assert.equal(message.text.length, 2_000);
    const stored = await baseRedis.get(chatKey);
    assert.ok(typeof stored === 'string');
    assert.ok(stored.length < 100_000, 'worst-case escaped text must remain bounded');
    const parsed = JSON.parse(String(stored));
    assert.equal(parsed[0].text.length, 2_000);
  } finally {
    await baseRedis.del(chatKey);
    await baseRedis.del(gamePostKey);
    if (previousChat != null) await baseRedis.set(chatKey, previousChat);
    if (previousPost != null) await baseRedis.set(gamePostKey, previousPost);
    configureDevvitRuntime({ redis: baseRedis, context: baseContext, reddit: baseReddit });
  }
});

test('Global Chat comment trigger prefers the actual comment author over mismatched app trigger metadata', () => {
  const resolved = resolveGlobalChatCommentAuthor({
    comment: { author: 'ActualCommenter' },
    author: { id: 't2_infinity_orbs_app', name: 'infinity-orbs', username: 'infinity-orbs' },
  });
  assert.deepEqual(resolved, { username: 'ActualCommenter' });
});

test('Global Chat comment trigger retains user ID when top-level author matches comment author', () => {
  const resolved = resolveGlobalChatCommentAuthor({
    comment: { author: 'u/ActualCommenter' },
    author: { id: 't2_actual_commenter', name: 'ActualCommenter' },
  });
  assert.deepEqual(resolved, { username: 'ActualCommenter', userId: 't2_actual_commenter' });
});
