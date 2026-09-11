# Novel App Prototype

A browser-first, local-first novel-writing prototype inspired by NovelCrafter. The app is focused on a single writer working with books, outlines, scenes, notes, Codex entries, summaries, and book-aware AI assistance from desktop or mobile browsers.

For the product direction and implementation boundary, see [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md). Codex generation/context behavior is documented separately in [docs/CODEX_GENERATION_SPEC.md](docs/CODEX_GENERATION_SPEC.md).

## Current prototype

Working behavior on `main` includes:

- local books, shared series, Acts, Chapters, Scenes, Notes, Codex entries, summaries, Chats, and Chat messages persisted in IndexedDB;
- Markdown editing with autosave, local document snapshots, and editor undo/redo integration;
- book-scoped AI settings plus global defaults for OpenRouter, nano-gpt.com, OpenAI, and OpenAI-compatible endpoints;
- Main, Support, optional Codex, and optional Chat model selection (new chats use Chat when selected, otherwise Main), cached provider model lists, favorites, editable prompts, and configurable streamed-writing pace;
- Scene continuation, summary generation, and whole-body Codex generation;
- generation-type-specific Context Management with automatic context, explicit additional context, model-budget checks, and a rendered request preview for Story, Codex, and Chat;
- persisted book Chat with streaming responses, Stop, edit, Save & regenerate, assistant regenerate/delete/fork/read-aloud actions, per-chat model/system prompt/context settings, and approval-based workspace edit proposals;
- Chat request composition with per-Chat System and ordered Predefined messages, explicit context variables, exact normalized request previews, and structured workspace-tool rounds. The prototype database v3 migration removes legacy Chat and ChatMessage entities together; books, manuscript, notes, Codex, summaries, and Book settings are preserved;
- a standalone Images workspace opened from the Library, editor, or Chat, with text-to-image, image-to-image, text-to-video, and image-to-video generation, a mixed-media Gallery, a durable device-wide queue, activity badges, and book-aware gallery actions;
- device-global image provider/model configuration under Settings > Images; opening settings preserves the Images tab, generation draft, and gallery filters in Workspace;
- responsive Outline, Notes, Codex, Chat, Images, Book, AI, Context, and UI surfaces;
- device-local typography/theme settings and custom themes;
- an installable PWA shell and GitHub Pages deployment workflow.

The prototype is still intentionally single-user and local to one browser/device. There is no cloud sync or backend. AI requests require network access and a provider API key.

### Known gaps

- Open issue [#29](https://github.com/goodjobwebdev-blip/novel-app-prototype/issues/29) is mostly implemented, but Chat still needs graceful trimming of older history when a request exceeds the model context window and persistence of partial assistant output after non-cancellation provider/network failures.
- Dedicated Note generation is not implemented; Note work can currently be done through Chat.
- Visual generation supports NanoGPT, current OpenAI GPT Image models, and curated Pruna image/video models. Source images are snapshotted into durable jobs, videos use resumable provider IDs where available, and kept outputs share the device gallery. Server-side background completion is not implemented. Codex illustrations remain still-image-only and support uploads, mobile cropping, zoom, captions, recovery, and undo.
- Book backup export/import is available as `.arcbook` files, including illustrations and kept generated media. Video-containing backups use archive version 3; import creates a new book and never resumes paid jobs. Automatic cross-device sync is not implemented.
- Offline behavior is prototype-grade: local manuscript data is device-local, while provider calls and uncached external runtime resources still require network access.

For illustration storage, supported image sizes, and the backup format, see [docs/CODEX_ILLUSTRATIONS.md](docs/CODEX_ILLUSTRATIONS.md). For AI providers, the queue, gallery, and setup, see [docs/IMAGE_GENERATION.md](docs/IMAGE_GENERATION.md).

## Data model

Structured content is stored in IndexedDB through Dexie. The entity model currently includes books, series, Acts, Chapters, Scenes, Notes, Codex entries, summaries, Chats, Chat messages, and book-scoped settings. Document snapshots are stored separately for local recovery/history. Codex image Blobs and thumbnails are stored in a separate illustrations table, linked to their entries.

Small global preferences such as default AI settings, model favorites, typography, and themes are stored in `localStorage` on the current device.

## Local development

Requirements: Node.js 24 is used by CI.

```bash
npm install --no-package-lock
npm run dev
```

## Production check

The repository intentionally does not currently commit an npm lockfile, so use the same install mode as CI:

```bash
npm install --no-package-lock
npm run build
```

Vite writes the deployable static application to `dist/`.

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`:

1. check out the repository;
2. set up Node.js 24;
3. install dependencies with `npm install --no-package-lock`;
4. run `npm run build`;
5. publish `dist/` to GitHub Pages.

GitHub Pages must be configured once with **GitHub Actions** as the Pages source.
