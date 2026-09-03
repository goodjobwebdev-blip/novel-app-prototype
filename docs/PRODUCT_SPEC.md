# Product specification

> Status: product direction for the prototype. Keep this document short and update it when a product decision changes.

## What this app is

A personal, local-first novel-writing application inspired by NovelCrafter. It is intended for one writer to plan books, draft and organize manuscripts, keep story knowledge, and use AI writing assistance from phone or desktop browsers.

The application should feel like a writing workspace, not a general-purpose chat client or publishing platform.

## Core product direction

- The home screen is a book library with a **Create new book** action.
- Creating a book immediately creates an untitled book.
- A book can contain acts (optional), chapters, scenes, notes, and a searchable story codex.
- Scenes and notes open in the main editor workspace.
- Chat can replace the editor workspace and use selected book context.
- AI settings have global defaults. A new book copies those defaults and then keeps independent settings.
- If text-model settings are incomplete, the app should show a clear warning that opens AI settings.
- AI generation uses a provider selected and configured by the user. The first provider is NanoGPT.

Detailed layouts and the complete feature set are intentionally not fixed by this document.

## Technical constraints

- **Browser-first:** it must run in current phone and desktop browsers.
- **Installable:** it should behave as a Progressive Web App and remain usable after installation.
- **No local build required for use:** Node.js is a development and CI dependency only. The user opens the deployed browser application.
- **Static deployment:** GitHub Actions builds the app and GitHub Pages hosts the generated files.
- **Current stack:** React, TypeScript, and Vite. CI uses Node.js 24 LTS.
- **Local-first:** ordinary writing and organization must not require a server or account.
- **Offline-capable:** installed application code and local writing should work offline. Network features such as model refresh and AI generation do not.
- **Single-user:** collaboration, permissions, and multi-user accounts are out of scope.
- **No automatic cross-device sync initially:** each browser/device has an independent database.
- **Responsive:** essential writing and settings flows must work on both narrow phone screens and desktop screens.

## Data and recovery

- Manuscripts and structured book data should use IndexedDB; Dexie is the preferred wrapper when the data layer is implemented.
- Small interface preferences may use localStorage.
- Editing should autosave locally.
- Local snapshots provide version history for accidental edits, but they are not backups because they live on the same device.
- The app must provide manual export and import so work can be backed up and moved between devices.
- Destructive or bulk operations should create a recovery point when practical.
- Large binary libraries such as extensive images, audio, or PDFs are not an initial storage goal.

## AI constraints

- NanoGPT is the first API provider.
- The user chooses the model from the provider's model list.
- The user's API key must never be committed to the repository or embedded in the deployed build.
- In the current prototype, the API key is held in memory only and is lost on reload.
- A future decision is required before persisting API credentials locally; the security tradeoff must be explicit.
- Because the app is a static frontend, requests are sent from the browser. The provider must permit browser requests, and the key is visible to the user/browser runtime.
- AI features must fail clearly without damaging or replacing manuscript text.
- AI generation is optional. The non-AI writing experience must remain usable without a configured provider.

## Current prototype scope

The prototype exists to validate the delivery pipeline and direct NanoGPT integration. It is not an MVP and does not yet promise the full book data model, editor, backups, snapshots, or polished product design.

## Not decided yet

- Final visual design and detailed navigation
- Exact book/codex data schema
- API-key persistence
- Snapshot retention rules
- Export file format
- Cloud synchronization or a backend
- Advanced generation controls and prompt architecture

These items should not be treated as requirements until a later decision updates this document.
