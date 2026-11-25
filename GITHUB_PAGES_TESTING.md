# Infinity Orbs: GitHub Pages testing build

This branch contains a standalone browser build of Infinity Orbs for testing before changes are uploaded to Reddit.

## What it runs

The Pages build reuses the current client UI and the same game, progression, guild, and combat modules from the Reddit version. It replaces the Devvit runtime with browser adapters and a local Redis-compatible store. Saves persist in the browser's local storage.

Each tester profile is selected by the `player` query parameter. For example:

- `https://awesome118.github.io/infinity-orbs-v2/?player=TesterOne`
- `https://awesome118.github.io/infinity-orbs-v2/?player=TesterTwo`

Those profiles use separate player saves in the same browser. They are not separate online users and cannot interact across browsers.

## Limits of the Pages version

The Admin Console is enabled for local testing and its changes are confined to the browser's local test storage. All visitors can access the local test tools; they do not grant access to Reddit or another user's browser data.

GitHub Pages is static hosting. This build does not provide a shared backend, server-side authority, or real Reddit services. Reddit identity, post publishing, comments, Modmail, notification delivery, payments, and cross-player features are mocked or unavailable. The browser-side RNG and save storage are for development and balance testing only. Do not use Pages test saves as production data.

Combat and other server logic are executed in the browser against the local mock store. This keeps the gameplay rules close to the Reddit build, but it is not a security or concurrency test of the Devvit server.

Test saves are stored in this browser. To start fresh, clear site data for `awesome118.github.io` in your browser's site settings. This removes all local tester profiles for this site.

## Build locally

Use Node.js 24 or newer:

```bash
npm ci
npm run build:pages
```

The output is written to `dist-pages/`. To preview it locally, run:

```bash
npx vite preview --config vite.pages.config.ts
```

## Publish the test site

1. Update the dedicated `.github/pages-deploy-trigger` file in the final commit for a prompt-level deployment, or manually run **Deploy Infinity Orbs Pages test build** from the Actions tab.
2. The workflow asks GitHub to enable Pages automatically, then builds `dist-pages/` and deploys that folder.
3. If repository policy blocks automatic Pages enablement, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**, then rerun the workflow.

The Pages workflow runs when manually dispatched or when the dedicated `.github/pages-deploy-trigger` file changes on `github-pages-test`. Ordinary code pushes do not start GitHub Actions. Updating the trigger file once in the final commit gives one deployment per prompt, rather than one deployment for every intermediate push. It does not run the Devvit upload or publish commands. The normal Reddit build and deployment path remains separate.
