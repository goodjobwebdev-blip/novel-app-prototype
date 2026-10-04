# Novel App Prototype

A browser-first, local-first novel-writing prototype inspired by NovelCrafter. The app is focused on a single writer working with books, outlines, scenes, notes, Codex entries, summaries, and book-aware AI assistance from desktop or mobile browsers.

For the product direction and implementation boundary, see [docs/PRODUCT_SPEC.md](docs/PRODUCT_SPEC.md). The confirmed settings/profile contract and remaining integration checks are in [docs/SETTINGS_PROFILES_REDESIGN.md](docs/SETTINGS_PROFILES_REDESIGN.md). Codex generation/context behavior is documented separately in [docs/CODEX_GENERATION_SPEC.md](docs/CODEX_GENERATION_SPEC.md).

## Current prototype

Current implementation includes the following. Settings/profile entries were reconciled by reading the working tree on 2026-10-04; this documentation-only review ran no tests, builds, or browser checks and does not mark the full redesign complete or validated:

- local books, shared series, Acts, Chapters, Scenes, Notes, Codex entries, summaries, Chats, and Chat messages persisted in IndexedDB;
- Markdown editing with autosave, local document snapshots, and editor undo/redo integration;
- book **Profiles + Context** settings: books select shared Text, TTS, STT, Image, Video, and UI profiles plus live Story/Codex/Summary prompt presets; detailed editors and credentials live in global Settings;
- global **AI > Connections** for OpenRouter, nano-gpt.com, OpenAI, LiteLLM, OpenAI-compatible endpoints, and Fake (testing): **one active text connection serves every text profile and role**; speech/media can use global credential overrides, never book-local keys;
- one Text profile containing **Main, Support, Codex, Chat, and Character chat**, with per-role thinking and Main/Codex context caps in their model cards; Codex/Chat/Character model selection can fall back to Main;
- shared profile/preset drafts with explicit **Save**, linked-book warnings and confirmation, Duplicate, and protected defaults; Story/Codex/Summary response length belongs to the preset, while text reveal speed belongs to the UI profile;
- Scene continuation, summary generation, and whole-body Codex generation;
- generation-type-specific Context Management with automatic context, explicit additional context, model-budget checks, and a rendered request preview for Story, Codex, and Chat;
- per-role thinking-effort defaults (Provider default, Minimal, Low, Medium, High, Extra high) and per-chat overrides under Generation settings; higher effort may take longer and use more tokens, and supported levels depend on the model;
- persisted book Chat with streaming responses, Stop, edit, Save & regenerate, assistant regenerate/delete/fork/read-aloud actions, per-chat model/system prompt/context settings, and approval-based workspace edit proposals;
- Chat request composition with per-Chat System and ordered Predefined messages, explicit context variables, exact normalized request previews, and structured workspace-tool rounds. The prototype database v3 migration removes legacy Chat and ChatMessage entities together; books, manuscript, notes, Codex, summaries, and Book settings are preserved;
- a standalone Images workspace opened from the Library, editor, or Chat, with text-to-image, image-to-image, text-to-video, and image-to-video generation, a mixed-media Gallery, a durable device-wide queue, activity badges, and book-aware gallery actions;
- separate global Image and Video profile editors under **Settings > AI > Models**, using credentials from Connections; Images settings links open the relevant profile, while Workspace retains the Images tab, generation draft, and gallery filters;
- responsive Outline, Notes, Codex, Chat, Images, Book, Profiles, Context, and global settings surfaces;
- book-selected UI profiles for typography, themes/custom themes, editor flags, and reveal speed; Home and global surfaces use the default UI profile;
- global default selections for new books and work outside a book: new books save profile IDs, and changing a default assignment does not reassign existing books;
- global Settings access from Home and book settings, per-selection **Edit**, **Back to Profiles**, source-aware Close, and **Back to last book** with device-local book/document/chat location persistence;
- opt-in, per-book roaming through the self-hosted Go/PostgreSQL archive-sync backend, with manual sync, remote-change checks, optional idle uploads, and explicit conflict recovery;
- an installable PWA shell and GitHub Pages deployment workflow.

The writing client remains local-first: IndexedDB is used while writing, and cloud sync is optional per book. Sync transfers complete versioned `.arcbook` archives rather than merging individual records. AI requests require network access and a provider API key. See [docs/SYNC_BACKEND.md](docs/SYNC_BACKEND.md) for browser setup, sync behavior, the backend API, and VPS deployment.

### Known gaps

- Open issue [#29](https://github.com/goodjobwebdev-blip/novel-app-prototype/issues/29) is mostly implemented, but Chat still needs graceful trimming of older history when a request exceeds the model context window and persistence of partial assistant output after non-cancellation provider/network failures.
- Dedicated Note generation is not implemented; Note work can currently be done through Chat.
- Visual generation supports NanoGPT, current OpenAI GPT Image models, and curated Pruna image/video models. Source images are snapshotted into durable jobs, videos use resumable provider IDs where available, and kept outputs share the device gallery. Server-side background completion is not implemented. Codex illustrations remain still-image-only and support uploads, mobile cropping, zoom, captions, recovery, and undo.
- Book backup export/import uses `.arcbook` **version 4** for books with profile selections, including sanitized selected profile/preset/theme definitions, chat snapshots, history, illustrations, and kept generated media. The decoder accepts versions 1–4; legacy payloads without profiles use v2, or v3 with video. No connection configurations, endpoints, accounts, credentials, local connection IDs, or credential/connection fingerprints are portable. Ordinary import creates a new book and independent profile IDs and never resumes paid jobs; sync profile-ID conflicts create local clones rather than overwrite shared profiles. Complete-archive sync can consume substantial time, bandwidth, browser memory, and server storage.
- The settings/profile redesign is still being integrated. Legacy book AI settings are preserved locally for recovery, but different legacy credentials are not reconciled into Connections and there is no recovery/mapping UI yet. Profile installation in `localStorage` is not part of the IndexedDB book transaction, so an import failure can leave unused profiles. Persisted last-book state restores entity/surface selection, not cursor/scroll/focus; end-to-end migration, sync, navigation, and mobile acceptance remain to be validated.
- Offline behavior is prototype-grade: local manuscript data is device-local, while provider calls and uncached external runtime resources still require network access.

For illustration storage, supported image sizes, and the backup format, see [docs/CODEX_ILLUSTRATIONS.md](docs/CODEX_ILLUSTRATIONS.md). For AI providers, the queue, gallery, and setup, see [docs/IMAGE_GENERATION.md](docs/IMAGE_GENERATION.md).

## Data model

Structured content is stored in IndexedDB through Dexie. The entity model includes books, series, Acts, Chapters, Scenes, Notes, Codex entries, summaries, Chats, Chat messages, book profile-selection records, and book-local Context settings. Document snapshots are stored separately for local recovery/history. Codex image Blobs and thumbnails are stored in a separate illustrations table, linked to their entries. Legacy book AI configuration is retained as device-local recovery data, not exported as a connection.

The shared profile/preset library, default selections, global Connections, model favorites, and last-book location use device-local `localStorage`. UI profiles contain theme/typography/editor settings and custom themes. Shared profile edits are live after Save; the library is not automatically synchronized as a whole. A book archive carries only its selected definitions and dependencies.

### Thinking effort

In **Global Settings > AI > Models > Text models**, choose a role and its **Thinking effort**, then Save the shared profile. Books select the Text profile under **Profiles**; new books receive the global default profile IDs. New Chat/Character chat snapshots come from the **book-selected Text profile (option A)**: role model (or Main fallback), thinking, role-linked prompt preset content, context-window parameters, and max model rounds. The role's effort stays independent of model fallback. Existing chats and forks retain their saved settings and manual overrides; credentials are not snapshotted, so text requests still use the globally active connection.

In a chat's **Generation settings**, enable **Customize thinking** and choose an effort. It applies to the next Send, regeneration, or Continue and stays fixed across that response's tool rounds. Disabling customization preserves the selected effort for later and sends no reasoning override; the provider may still reason by default. Legacy chats retain their previous Thinking toggle and use Provider default until an effort is selected.

Text generation uses the Main effort for writing and quick tools, Codex effort for worldbuilding, and Support effort for summaries and titles. NanoGPT and OpenRouter receive `reasoning.effort`; OpenAI, LiteLLM, and custom OpenAI-compatible chat endpoints receive `reasoning_effort`. Provider default omits an explicit effort. Not every model supports every level, and unsupported settings may be rejected by the provider. Fake (testing) records the selected effort in its session trace without making a network request.

Provider references: [NanoGPT reasoning](https://docs.nano-gpt.com/api-reference/miscellaneous/extended-thinking), [OpenRouter reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens), [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create).

### Sensory detail

Select prose in the editor and choose **Sensory detail** from its context menu. Suggestions start automatically using the book's Main model and effort, with two ideas requested for each of seven senses: sight, sound, smell, taste, touch/temperature, balance/movement, and internal bodily sensation. Chips appear as complete ideas arrive. Each chip replaces the entire selected passage with that variant; its pencil opens the full replacement for review and editing. **Save edit** updates the chip without changing the document, while **Use this variant** applies the edited text. **Stop** retains the ideas already shown, and **More ideas** requests additional alternatives. If the selected passage has changed, applying is refused so it can be selected again. Other rewrite tools retain their Generate/preview/Apply flow.

## Local development

Requirements: Node.js 24 is used by CI.

```bash
npm install --no-package-lock
npm run dev
```

## Frontend tests: mandatory resource limits

```bash
npm test -- tests/sensory-detail-ui.test.mjs
npm test -- tests/test-runner.test.mjs tests/sensory-detail-ui.test.mjs
npm test
```

`npm test` is the only supported test entrypoint. It requires Linux, cgroup v2, Python 3 and systemd (`systemd-run`); locally it uses your user systemd manager. GitHub Actions uses an isolated system service with the same limits.

The runner enforces:

- **2 GiB total RAM for the whole process tree**, including child Node processes and native allocations; **no swap**;
- a **1 GiB Node heap**, test-file concurrency **1**, and a shared repository lock that prevents concurrent runs, including in Git worktrees;
- a 30-second Node test timeout and a 20-minute whole-run deadline;
- bounded output (512 KiB in the console, 4 MiB in `node_modules/.test-runner-output.log`).

Every test file checks the real kernel memory limits before setup. The runner checks that every `tests/*.test.mjs` includes the guard described in [AGENTS.md](AGENTS.md). Accidental direct execution is rejected. Unsupported platforms or unavailable memory isolation fail closed: there is no unrestricted fallback. Never bypass these checks or raise limits to pass a test; fix the failing test instead.

Agents may implement independent code changes concurrently, but only the parent coordinates test runs. This is recorded in `AGENTS.md` for all agents/subagents. CI also runs `npm test`.

For React tests, register cleanup immediately with `t.after()` after `createRoot()`, before rendering or awaiting setup. Do not compare DOM/React objects with equality assertions that may print their browser/fiber graphs: use scalar comparisons or `assert.ok(actual === expected, 'description')`.

These safeguards govern repository tests; they cannot prevent someone with shell access from deliberately changing the runner or removing the guards.

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
