import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const helperPath = resolve(process.cwd(), 'scripts/predeploy-check.mjs');
const currentNodeMajor = Number(process.versions.node.split('.')[0]);

function validDevvitConfig(name = 'infinity-orbs') {
  return {
    name,
    post: {
      dir: 'dist/client',
      entrypoints: {
        default: { entry: 'splash.html', height: 'tall' },
        game: { entry: 'game.html' },
        frenzy: { entry: 'frenzy.html', height: 'tall' },
        rift: { entry: 'rift.html', height: 'tall' },
      },
    },
    server: { dir: 'dist/server', entry: 'index.cjs' },
    menu: {
      items: [{
        label: 'Create a new post',
        location: 'subreddit',
        forUserType: 'moderator',
        endpoint: '/internal/menu/post-create',
      }],
    },
    triggers: { onAppInstall: '/internal/on-app-install', onCommentCreate: '/internal/trigger/comment-create' },
    permissions: { redis: true, payments: false, reddit: { enable: true, scope: 'moderator', asUser: ['SUBMIT_POST', 'SUBMIT_COMMENT'] } },
    scheduler: {
      tasks: {
        'offline-orbs-full': { endpoint: '/internal/scheduler/offline-orbs-full' },
      },
    },
  };
}

function createFixture(options: {
  packageVersion?: string;
  lockVersion?: string;
  devvitName?: string;
  devvitConfig?: Record<string, any>;
  sourceText?: string;
  createSourceDir?: boolean;
  inlineCssText?: string;
} = {}) {
  const root = mkdtempSync(join(tmpdir(), 'infinity-orbs-preflight-'));
  const scriptDir = join(root, 'scripts');
  mkdirSync(scriptDir, { recursive: true });
  copyFileSync(helperPath, join(scriptDir, 'predeploy-check.mjs'));

  const packageVersion = options.packageVersion ?? '1.2.2';
  const lockVersion = options.lockVersion ?? packageVersion;
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'infinity-orbs',
    version: packageVersion,
    engines: { node: '>=24.0.0' },
  }));
  writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
    name: 'infinity-orbs',
    version: lockVersion,
    packages: {
      '': { name: 'infinity-orbs', version: lockVersion },
    },
  }));
  writeFileSync(join(root, 'devvit.json'), JSON.stringify(
    options.devvitConfig ?? validDevvitConfig(options.devvitName ?? 'infinity-orbs'),
  ));

  if (options.createSourceDir !== false) {
    const sourceDir = join(root, 'src');
    const clientDir = join(sourceDir, 'client');
    mkdirSync(clientDir, { recursive: true });
    writeFileSync(join(sourceDir, 'entry.ts'), options.sourceText ?? 'export const healthy = true;\n');
    writeFileSync(join(clientDir, 'splash.html'), '<html class="io-inline-post"><body class="io-inline-post"><div id="root" class="io-inline-post"></div></body></html>');
    writeFileSync(join(clientDir, 'frenzy.html'), '<html class="io-inline-post"><body class="io-inline-post"><div id="root" class="io-inline-post"></div></body></html>');
    writeFileSync(join(clientDir, 'rift.html'), '<html class="io-inline-post"><body class="io-inline-post"><div id="root" class="io-inline-post"></div></body></html>');
    writeFileSync(join(clientDir, 'splash.tsx'), 'export const splashInlineSafe = true;\n');
    writeFileSync(join(clientDir, 'frenzy.tsx'), 'export const frenzyInlineSafe = true;\n');
    writeFileSync(join(clientDir, 'rift.tsx'), 'export const riftInlineSafe = true;\n');
    writeFileSync(join(clientDir, 'styles.css'), options.inlineCssText ?? 'html.io-inline-post, body.io-inline-post { height: 100%; overscroll-behavior: auto; touch-action: pan-y pinch-zoom; }\n#root.io-inline-post { overflow: clip; overscroll-behavior: auto; touch-action: pan-y pinch-zoom; }\n.io-public { overflow: clip; overscroll-behavior: auto; touch-action: pan-y pinch-zoom; }\n.io-combat-log{max-height:245px;overflow:auto}\n');
  }

  return {
    root,
    run() {
      return spawnSync(process.execPath, [join(scriptDir, 'predeploy-check.mjs')], {
        cwd: root,
        encoding: 'utf8',
      });
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test('deployment preflight accepts aligned manifests on supported Node.js', {
  skip: currentNodeMajor < 24 ? 'Project release checks require Node.js 24+' : false,
}, () => {
  const fixture = createFixture();
  try {
    const result = fixture.run();
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /manifests\/version aligned/);
  } finally {
    fixture.cleanup();
  }
});

test('deployment preflight rejects a package-lock version mismatch', () => {
  const fixture = createFixture({ packageVersion: '1.2.2', lockVersion: '1.2.1' });
  try {
    const result = fixture.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /versions do not match/);
  } finally {
    fixture.cleanup();
  }
});

test('deployment preflight rejects the forbidden Devvit transaction-read pattern', () => {
  const fixture = createFixture({ sourceText: 'const state = tx.get("player");\n' });
  try {
    const result = fixture.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /forbidden transaction read pattern/);
  } finally {
    fixture.cleanup();
  }
});

test('deployment preflight rejects a missing or empty source tree', () => {
  const fixture = createFixture({ createSourceDir: false });
  try {
    const result = fixture.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not scan required source directory|No supported source files were scanned/);
  } finally {
    fixture.cleanup();
  }
});

test('deployment preflight rejects a Devvit app name that differs from package.json', () => {
  const fixture = createFixture({ devvitName: 'different-app' });
  try {
    const result = fixture.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Devvit app name/);
  } finally {
    fixture.cleanup();
  }
});

const invalidManifestCases: Array<{
  label: string;
  mutate: (manifest: any) => void;
  expected: RegExp;
}> = [
  {
    label: 'client output directory',
    mutate: manifest => { manifest.post.dir = 'dist/other'; },
    expected: /post\.dir must be/,
  },
  {
    label: 'default splash entrypoint',
    mutate: manifest => { delete manifest.post.entrypoints.default; },
    expected: /post\.entrypoints\.default\.entry must be/,
  },
  {
    label: 'game entrypoint',
    mutate: manifest => { manifest.post.entrypoints.game.entry = 'missing.html'; },
    expected: /post\.entrypoints\.game\.entry must be/,
  },
  {
    label: 'default inline splash uses the bounded tall layout',
    mutate: manifest => { manifest.post.entrypoints.default.height = 'regular'; },
    expected: /post\.entrypoints\.default\.height must be/,
  },
  {
    label: 'Frenzy entrypoint and tall layout',
    mutate: manifest => { manifest.post.entrypoints.frenzy.height = 'inline'; },
    expected: /post\.entrypoints\.frenzy\.height must be/,
  },
  {
    label: 'Rift completion entrypoint and tall layout',
    mutate: manifest => { manifest.post.entrypoints.rift.height = 'inline'; },
    expected: /post\.entrypoints\.rift\.height must be/,
  },
  {
    label: 'server output entry',
    mutate: manifest => { manifest.server.entry = 'missing.cjs'; },
    expected: /server\.entry must be/,
  },
  {
    label: 'Redis permission',
    mutate: manifest => { manifest.permissions.redis = false; },
    expected: /permissions\.redis must be/,
  },
  {
    label: 'payments disabled',
    mutate: manifest => { manifest.permissions.payments = true; },
    expected: /permissions\.payments must be/,
  },
  {
    label: 'app install trigger',
    mutate: manifest => { manifest.triggers.onAppInstall = '/wrong'; },
    expected: /triggers\.onAppInstall must be/,
  },
  {
    label: 'comment-create trigger',
    mutate: manifest => { manifest.triggers.onCommentCreate = '/wrong'; },
    expected: /triggers\.onCommentCreate must be/,
  },
  {
    label: 'USER comment permission',
    mutate: manifest => { manifest.permissions.reddit.asUser = ['SUBMIT_POST']; },
    expected: /permissions\.reddit\.asUser must include "SUBMIT_COMMENT"/,
  },
  {
    label: 'offline notification scheduler endpoint',
    mutate: manifest => { delete manifest.scheduler.tasks['offline-orbs-full']; },
    expected: /scheduler\.tasks\.offline-orbs-full\.endpoint must be/,
  },
  {
    label: 'moderator post creation action',
    mutate: manifest => { manifest.menu.items = []; },
    expected: /menu.items must include the moderator Create a new post action/,
  },
];

for (const scenario of invalidManifestCases) {
  test(`deployment preflight rejects an invalid Devvit manifest contract: ${scenario.label}`, () => {
    const manifest = validDevvitConfig();
    scenario.mutate(manifest);
    const fixture = createFixture({ devvitConfig: manifest });
    try {
      const result = fixture.run();
      assert.equal(result.status, 1);
      assert.match(result.stderr, scenario.expected);
    } finally {
      fixture.cleanup();
    }
  });
}


test('deployment preflight rejects root CSS that disables native feed gestures', () => {
  const fixture = createFixture({
    inlineCssText: [
      'html.io-inline-post, body.io-inline-post { height: 100%; overscroll-behavior: none; touch-action: none; }',
      '#root.io-inline-post { overflow: clip; overscroll-behavior: none; touch-action: none; }',
      '.io-public { overflow: clip; overscroll-behavior: auto; touch-action: pan-y pinch-zoom; }',
    ].join('\n'),
  });
  try {
    const result = fixture.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /html\/body must allow native vertical scrolling|html\/body must let overscroll|html\/body must not capture/);
    assert.match(result.stderr, /inline root must allow native vertical scrolling|inline root must let overscroll|inline root must not capture/);
  } finally {
    fixture.cleanup();
  }
});

test('deployment preflight rejects overscroll containment and horizontal-only touch actions', () => {
  const fixture = createFixture({
    inlineCssText: [
      'html.io-inline-post, body.io-inline-post { height: 100%; overscroll-behavior: auto; touch-action: pan-y pinch-zoom; }',
      '#root.io-inline-post { overflow: clip; overscroll-behavior: auto; touch-action: pan-y pinch-zoom; }',
      '.io-public { overflow: clip; overscroll-behavior: auto; touch-action: pan-y pinch-zoom; }',
      '@media (max-width: 600px) { .io-frenzy-card { overscroll-behavior: contain; touch-action: pan-x; } }',
    ].join('\n'),
  });
  try {
    const result = fixture.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Inline public-card selector/);
  } finally {
    fixture.cleanup();
  }
});

test('deployment preflight rejects an internal scroll container on the public inline card', () => {
  const fixture = createFixture({
    inlineCssText: [
      'html.io-inline-post, body.io-inline-post { height: 100%; overscroll-behavior: auto; touch-action: pan-y pinch-zoom; }',
      '#root.io-inline-post { overflow: clip; overscroll-behavior: auto; touch-action: pan-y pinch-zoom; }',
      '.io-public { overflow: auto; overscroll-behavior: auto; touch-action: pan-y pinch-zoom; }',
    ].join('\n'),
  });
  try {
    const result = fixture.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, /public post must not capture or create a scroll trap/);
  } finally {
    fixture.cleanup();
  }
});

test('npm deploy script pins the exact package version instead of implicit patch bumping', () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(
    pkg.scripts.deploy,
    'npm run preflight && devvit upload --version $(node -p \'require("./package.json").version\')',
  );
});

test('deployment workflow is manual, main-only, and installs only to the development subreddit', () => {
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/deploy.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /confirm_install:[\s\S]*?default:\s*false/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(
    workflow,
    /run:\s*timeout --signal=TERM --kill-after=30s 9m npx devvit upload --version "\$REQUESTED_VERSION"/,
    'the exact version-pinned upload must be bounded by a timeout',
  );
  assert.match(
    workflow,
    /npx devvit view "infinity-orbs@\$REQUESTED_VERSION" version/,
    'uploaded-version verification must resolve the exact requested release rather than unqualified latest',
  );
  assert.match(workflow, /paths:\s*\n\s*- \.github\/workflows\/deploy\.yml/);
  assert.match(workflow, /contains\(github\.event\.head_commit\.message, '\[deploy-dev:\d+\.\d+\.\d+\]'\)/);
  assert.ok(workflow.includes('      - name: Detect whether the exact version already exists\n        id: existing-version\n        continue-on-error: true\n        env:\n          DEVVIT_AUTH_TOKEN: ${{ secrets.DEVVIT_TOKEN }}\n          DEVVIT_SESSION_ID: ${{ secrets.DEVVIT_SESSION_ID }}\n          REQUESTED_VERSION: ${{ steps.requested-version.outputs.version }}'));
  assert.ok(workflow.includes('      - name: Upload exact requested version to Devvit\n        if: steps.existing-version.outcome != \'success\'\n        env:\n          DEVVIT_AUTH_TOKEN: ${{ secrets.DEVVIT_TOKEN }}\n          DEVVIT_SESSION_ID: ${{ secrets.DEVVIT_SESSION_ID }}\n          CI: true\n          REQUESTED_VERSION: ${{ steps.requested-version.outputs.version }}'));
  assert.ok(workflow.includes('      - name: Verify uploaded version\n        id: uploaded-version\n        env:\n          DEVVIT_AUTH_TOKEN: ${{ secrets.DEVVIT_TOKEN }}\n          DEVVIT_SESSION_ID: ${{ secrets.DEVVIT_SESSION_ID }}\n          REQUESTED_VERSION: ${{ steps.requested-version.outputs.version }}'));
  assert.ok(workflow.includes('      - name: Install candidate to development subreddit only (r/infinity_orbs_dev)\n        env:\n          DEVVIT_AUTH_TOKEN: ${{ secrets.DEVVIT_TOKEN }}\n          DEVVIT_SESSION_ID: ${{ secrets.DEVVIT_SESSION_ID }}\n          VERSION: ${{ steps.uploaded-version.outputs.version }}'));
  assert.match(workflow, /DEVVIT_SESSION_ID/);
  assert.match(workflow, /npx devvit whoami/);
  assert.match(workflow, /Verify Devvit CLI authentication/);
  assert.match(workflow, /if: steps\.existing-version\.outcome != 'success'/);
  assert.match(workflow, /^\s*npx devvit install r\/infinity_orbs_dev\b/m);
  assert.doesNotMatch(workflow, /^\s*npx devvit install r\/infinityorbs\b/m);
  assert.doesNotMatch(workflow, /^\s*npx devvit publish\b/m);
});


test('review workflow publishes a version before installing only to development', () => {
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/release.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /confirm_publish:[\s\S]*?default:\s*false/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.ok(workflow.includes('npx devvit publish --version'));
  assert.ok(workflow.includes('npx devvit install r/infinity_orbs_dev'));
  assert.equal(workflow.includes('npx devvit install r/infinityorbs'), false);
});

test('production workflow requires explicit post-approval confirmation and only installs production', () => {
  const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/install-production.yml'), 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /confirm_approved:[\s\S]*?default:\s*false/);
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/);
  assert.match(workflow, /already-approved Devvit version/i);
  assert.match(workflow, /^\s*npx devvit install r\/infinityorbs\b/m);
  assert.doesNotMatch(workflow, /^\s*npx devvit install r\/infinity_orbs_dev\b/m);
  assert.doesNotMatch(workflow, /^\s*npx devvit (upload|publish)\b/m);
});
