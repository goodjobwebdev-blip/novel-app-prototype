# Novel App Prototype

This repository contains a deployment prototype for a local-first novel-writing app. The current working slice is the **AI defaults** screen: provider connection, model loading and selection, favorites, system prompts, and device-local saving.

## How the pipeline works

1. Source changes are reviewed and merged into `main`.
2. GitHub Actions installs the dependencies and runs `npm run build`.
3. Vite writes browser-ready files to `dist`.
4. GitHub Pages publishes `dist`.
5. Phones and desktop browsers load the published app without Node.js.

## Enable GitHub Pages

In the repository, open **Settings → Pages** and select **GitHub Actions** as the source. After this PR is merged, the workflow will deploy the app automatically.

## Local development

```bash
npm install
npm run dev
```

## Production check

```bash
npm ci
npm run build
```

The generated `dist` directory is the deployable application.
