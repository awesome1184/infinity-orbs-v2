#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { extname, join, resolve } from "node:path";

const failures = [];
const reportFailure = (message) => failures.push(message);

function readJson(file) {
  try {
    return JSON.parse(readFileSync(resolve(file), "utf8"));
  } catch (error) {
    reportFailure(`Could not read valid JSON from ${file}: ${error.message}`);
    return null;
  }
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (!Number.isInteger(nodeMajor) || nodeMajor < 24) {
  reportFailure(`Node.js 24 or newer is required; found ${process.versions.node}.`);
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const devvit = readJson("devvit.json");

if (pkg) {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(pkg.version ?? "")) {
    reportFailure(`package.json version is not a valid release-style version: ${String(pkg.version)}`);
  }
  if (!/^>=\s*24(?:\.|$)/.test(pkg.engines?.node ?? "")) {
    reportFailure("package.json must declare Node.js >=24 in engines.node.");
  }
}
if (pkg && lock) {
  if (pkg.name !== lock.name || pkg.name !== lock.packages?.[""]?.name) {
    reportFailure("package.json and package-lock.json package names do not match.");
  }
  if (pkg.version !== lock.version || pkg.version !== lock.packages?.[""]?.version) {
    reportFailure("package.json and package-lock.json versions do not match; run npm install with the intended version.");
  }
}
if (pkg && devvit && devvit.name !== pkg.name) {
  reportFailure(`Devvit app name (${String(devvit.name)}) does not match package name (${pkg.name}).`);
}

// Treat the Devvit manifest as a release contract, not just valid JSON.
// The build may not fail when an entrypoint/trigger/scheduler/permission is
// accidentally removed, so fail before any upload if a required value drifts.
function requireManifestValue(label, actual, expected) {
  if (actual !== expected) {
    reportFailure(`devvit.json ${label} must be ${JSON.stringify(expected)}; found ${JSON.stringify(actual)}.`);
  }
}

if (devvit) {
  requireManifestValue("post.dir", devvit.post?.dir, "dist/client");
  const entrypoints = devvit.post?.entrypoints;
  if (!entrypoints || typeof entrypoints !== "object" || Array.isArray(entrypoints)) {
    reportFailure("devvit.json post.entrypoints must define default, game, frenzy, and rift entrypoints.");
  } else {
    requireManifestValue("post.entrypoints.default.entry", entrypoints.default?.entry, "splash.html");
    requireManifestValue("post.entrypoints.default.height", entrypoints.default?.height, "tall");
    requireManifestValue("post.entrypoints.game.entry", entrypoints.game?.entry, "game.html");
    requireManifestValue("post.entrypoints.frenzy.entry", entrypoints.frenzy?.entry, "frenzy.html");
    requireManifestValue("post.entrypoints.frenzy.height", entrypoints.frenzy?.height, "tall");
    requireManifestValue("post.entrypoints.rift.entry", entrypoints.rift?.entry, "rift.html");
    requireManifestValue("post.entrypoints.rift.height", entrypoints.rift?.height, "tall");
  }

  requireManifestValue("server.dir", devvit.server?.dir, "dist/server");
  requireManifestValue("server.entry", devvit.server?.entry, "index.cjs");
  requireManifestValue("permissions.redis", devvit.permissions?.redis, true);
  requireManifestValue("permissions.payments", devvit.permissions?.payments, false);
  requireManifestValue("triggers.onAppInstall", devvit.triggers?.onAppInstall, "/internal/on-app-install");
  requireManifestValue("triggers.onCommentCreate", devvit.triggers?.onCommentCreate, "/internal/trigger/comment-create");
  if (!Array.isArray(devvit.permissions?.reddit?.asUser) || !devvit.permissions.reddit.asUser.includes("SUBMIT_COMMENT")) {
    reportFailure('devvit.json permissions.reddit.asUser must include "SUBMIT_COMMENT" for user-authored comments.');
  }
  requireManifestValue(
    "scheduler.tasks.offline-orbs-full.endpoint",
    devvit.scheduler?.tasks?.["offline-orbs-full"]?.endpoint,
    "/internal/scheduler/offline-orbs-full",
  );

  const menuItems = Array.isArray(devvit.menu?.items) ? devvit.menu.items : [];
  const createPostItem = menuItems.find(item =>
    item && typeof item === "object" && item.endpoint === "/internal/menu/post-create"
  );
  if (!createPostItem) {
    reportFailure("devvit.json menu.items must include the moderator Create a new post action at /internal/menu/post-create.");
  } else {
    requireManifestValue("menu.items[/internal/menu/post-create].location", createPostItem.location, "subreddit");
    requireManifestValue("menu.items[/internal/menu/post-create].forUserType", createPostItem.forUserType, "moderator");
  }
}

const sourceRoot = resolve("src");
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const forbidden = /\b(?:txn|tx)\.get\(/;
let sourceFilesScanned = 0;

function scanDirectory(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    reportFailure(`Could not scan required source directory ${dir}: ${error.message}`);
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      scanDirectory(fullPath);
    } else if (entry.isFile() && sourceExtensions.has(extname(entry.name))) {
      sourceFilesScanned += 1;
      let lines;
      try {
        lines = readFileSync(fullPath, "utf8").split(/\r?\n/);
      } catch (error) {
        reportFailure(`Could not read source file ${fullPath}: ${error.message}`);
        continue;
      }
      lines.forEach((line, index) => {
        if (forbidden.test(line)) {
          reportFailure(`${fullPath}:${index + 1}: forbidden transaction read pattern; use redis.get() after WATCH.`);
        }
      });
    }
  }
}

scanDirectory(sourceRoot);
if (sourceFilesScanned === 0) {
  reportFailure("No supported source files were scanned under src/.");
}

// Inline post entries are deliberately bounded previews, not a scrollable game.
// Keep scroll-heavy UI in game.html (Expanded Mode) and fail the release guard if
// a future change mounts a nested scroller or gesture-capturing UI into a post.
function readInlineSource(file) {
  try {
    return readFileSync(resolve(file), "utf8");
  } catch (error) {
    reportFailure(`Could not read inline entry source ${file}: ${error.message}`);
    return "";
  }
}
for (const file of ["src/client/splash.html", "src/client/frenzy.html", "src/client/rift.html"]) {
  const html = readInlineSource(file);
  if (!/class=["']io-inline-post["']/.test(html)) {
    reportFailure(`${file} must mark the page as an inline-safe post surface.`);
  }
  if (!/id=["']root["'][^>]*class=["']io-inline-post["']/.test(html)) {
    reportFailure(`${file} root must use the bounded inline-post layout.`);
  }
}
const splashInline = readInlineSource("src/client/splash.tsx");
const frenzyInline = readInlineSource("src/client/frenzy.tsx");
const riftInline = readInlineSource("src/client/rift.tsx");
if (frenzyInline.includes("GlobalChatWindow")) {
  reportFailure("src/client/frenzy.tsx must not mount GlobalChatWindow: its history list captures inline-post scrolling.");
}
for (const [file, code] of [
  ["src/client/splash.tsx", splashInline],
  ["src/client/frenzy.tsx", frenzyInline],
  ["src/client/rift.tsx", riftInline],
]) {
  if (/onWheel\s*=|onTouchMove\s*=|onPointerMove\s*=|addEventListener\s*\(\s*['"](?:wheel|touchmove|pointermove)['"]|\.preventDefault\s*\(/.test(code)) {
    reportFailure(`${file} must not intercept native inline scroll or gesture events.`);
  }
  if (/overflow-(?:y-)?(?:auto|scroll)|overflow\s*:\s*(?:auto|scroll)/.test(code)) {
    reportFailure(`${file} must not introduce a nested scroll panel into an inline post.`);
  }
}
const stylesheet = readInlineSource("src/client/styles.css");
const documentRule = stylesheet.match(/html\.io-inline-post,\s*body\.io-inline-post\s*\{([^}]+)\}/)?.[1] ?? "";
const rootRule = stylesheet.match(/#root\.io-inline-post\s*\{([^}]+)\}/)?.[1] ?? "";
const publicRule = stylesheet.match(/^\s*\.io-public\s*\{([^}]+)\}/m)?.[1] ?? "";
function hasInlineGestureViolation(rule) {
  const touchActions = Array.from(rule.matchAll(/touch-action\s*:\s*([^;]+)/gi), match => match[1].trim().toLowerCase());
  const badTouchAction = touchActions.some(value => !/^pan-y(?:\s+pinch-zoom)?$/.test(value));
  const blockedOverscroll = /overscroll-behavior(?:-[xy])?\s*:\s*(?:none|contain)\b/i.test(rule);
  const nestedScroller = /overflow(?:-[xy])?\s*:\s*(?:auto|scroll)\b/i.test(rule);
  return badTouchAction || blockedOverscroll || nestedScroller;
}
for (const [label, rule] of [["html/body", documentRule], ["inline root", rootRule], ["public post", publicRule]]) {
  if (!/touch-action\s*:\s*pan-y(?:\s+pinch-zoom)?/.test(rule)) {
    reportFailure(`The ${label} must allow native vertical scrolling with touch-action: pan-y.`);
  }
  if (!/overscroll-behavior\s*:\s*auto/.test(rule)) {
    reportFailure(`The ${label} must let overscroll propagate to Reddit.`);
  }
  if (hasInlineGestureViolation(rule)) {
    reportFailure(`The ${label} must not capture or create a scroll trap.`);
  }
}

// Scan every CSS rule that can be part of an inline public card, not just the
// outer shell. Nested overflow:auto/scroll is a trap even when the outer shell
// itself is correctly bounded.
for (const match of stylesheet.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = match[1];
  const declarations = match[2];
  if (/\.io-public(?:[-\w]*)\b|\.io-share-card\b|\.io-frenzy-card\b/.test(selector) &&
      hasInlineGestureViolation(declarations)) {
    reportFailure(`Inline public-card selector ${selector.trim()} must not block gestures or declare overflow:auto/scroll.`);
  }
}

if (failures.length) {
  console.error("Deployment preflight guard failed:");
  for (const failure of failures) console.error(` - ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`Deployment preflight guard passed: Node ${process.versions.node}; manifests/version aligned; scanned ${sourceFilesScanned} source files; no forbidden transaction-read pattern.`);
}
