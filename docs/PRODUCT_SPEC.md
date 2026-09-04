# Product specification

> Status: confirmed product direction and current prototype boundary. Update this document when a product decision changes.

## What this app is

A personal, local-first novel-writing application inspired by NovelCrafter. It is intended for one writer to plan books, draft and organize manuscripts, keep story knowledge, and use AI writing assistance from phone or desktop browsers.

The application should feel like a quiet writing workspace, not a general-purpose chat client or publishing platform.

## Core product direction

- The home screen is a book library with covers, book and optional series titles, last-edited information, and a **New book** action.
- Creating a book immediately creates and opens an untitled book.
- If text-model settings are incomplete, Home shows a warning that opens the default AI settings.
- Global settings are saved as defaults. A new book copies those defaults and then keeps independent settings.
- A book can contain optional acts, chapters, scenes, notes, summaries, a searchable story codex, and book-aware chats.
- Scenes, notes, summaries, and Codex entries open in the main workspace.
- Chat replaces the editor workspace. The right sidebar switches between the chat list and the current chat's settings.
- AI generation uses a provider, models, prompts, and context selected by the user.

## Confirmed interface direction

### Editor

- The editor is the visual center of the app and occupies almost the full screen.
- It is a Markdown editor with an Obsidian-like active-line model: inactive lines render cleanly, while the active line exposes Markdown symbols.
- Floating blurred controls open settings on the left and book navigation on the right without permanently reducing the writing surface.
- The bottom-right **Continue** control starts generation. A long press may expose a small set of secondary actions.
- The bottom-left control opens a compact Arc drawer for generation instructions.
- Arc is a scrollable textarea of roughly one and a half lines when compact. Its internal expand control opens the textarea as a near-full-screen writing surface.

### Left settings

- The left side is for global defaults or AI, Context, UI, Speech, and Image settings belonging to the open book.
- Only AI settings are functionally implemented in the current prototype; other categories establish the intended navigation and visual structure.

### Right book workspace

- The right side contains persistent Book, Outline, Notes, Codex, and Chat tabs.
- Book contains current-book identity and story-profile metadata: title, series and order, overview, genre, writing style, point of view, tense, and language. It also contains the destructive delete action.
- Outline supports optional acts, chapters, and scenes. Selecting a scene opens it in the editor.
- Acts, chapters, and scenes expose distinct current, missing, and outdated summary states.
- Summary icons open persisted Markdown summaries in the shared editor. Manual edits are supported, and NanoGPT summary generation uses the book's Support model.
- Notes open in the editor workspace.
- Codex supports search, categories, compact/list/tile views, and new entries.
- Chat shows conversation history. Selecting a chat replaces the editor with the conversation and changes the sidebar to that chat's settings.

### Chat

- Current-chat settings include system prompt, model, thinking toggle, and selected context such as scene, chapter, book, or Codex.
- The conversation uses separate user and assistant bubbles. Assistant messages may appear with or without a thumbnail.
- Assistant actions include edit, fork, read aloud, regenerate, and delete. User actions include edit and delete.
- Editing offers Save, Save and regenerate, or Cancel.
- Chat has a compact bottom composer consistent with the Arc drawer.

### Visual system

- Mobile is the source design; desktop expands panels and density without changing the main interaction model.
- The initial theme is **Ink at Night**: a dark writing canvas, warm paper-colored type, muted gold accent, restrained borders, and translucent controls.
- Canvas, ink, muted text, accent, glass, borders, spacing, radii, and typography use semantic variables so additional themes can be developed later.
- The interface should avoid unnecessary effects and keep the manuscript visually dominant.

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
- Small interface preferences and global AI defaults use localStorage. Each book's AI settings are stored with its other entities in IndexedDB.
- Editing should autosave locally.
- Local snapshots provide version history for accidental edits, but they are not backups because they live on the same device.
- The app must provide manual export and import so work can be backed up and moved between devices.
- Destructive or bulk operations should create a recovery point when practical.
- Large binary libraries such as extensive images, audio, or PDFs are not an initial storage goal.

## AI constraints and decisions

- Supported provider choices are OpenRouter, nano-gpt.com, OpenAI, and an OpenAI-compatible custom endpoint.
- The user selects separate Main and Support models from the provider's model list. Main is intended for story writing; Support handles summaries, titles, and names.
- Model controls support loading, search, favorites, capability/context metadata when supplied, and provider errors. Favorites are a global model-picker preference rather than part of a book's generation configuration.
- The user can edit separate Story, Summarize, and Titles & names system prompts.
- Prompt examples support `{{variable}}` placeholders and `{% if condition %}...{% endif %}` blocks. The exact future template engine is not yet selected.
- AI defaults, including the API key, are currently persisted in localStorage on that browser/device. The interface must state this clearly.
- A new book copies provider, API key, base URL, Main/Support models, and all three prompts into an independent IndexedDB record. Later default changes do not affect that book unless the user explicitly resets it from defaults.
- The API key must never be committed to the repository or embedded in the deployed build.
- Local browser persistence is convenient but is not secure storage against scripts running in the same origin; this tradeoff is accepted for the personal prototype and should be revisited before adding third-party scripts or broader distribution.
- Because the app is a static frontend, provider requests are sent from the browser. The provider must permit browser requests, and the key is visible to the browser runtime.
- AI features must fail clearly without damaging or replacing manuscript text.
- AI generation is optional. The non-AI writing experience must remain usable without a configured provider.

### Prompt variables

System prompts use `{{variable}}` for substitution and `{% if variable %}...{% endif %}` for optional blocks. The AI settings screen lists the variables available to the selected prompt type next to the prompt editor.

| Variable | Prompt types | Value |
|---|---|---|
| `{{book.title}}` | All | Current book title |
| `{{book.series}}` | All | Series title; empty for standalone books |
| `{{book.series_order}}` | All | Book position within its series |
| `{{book.overview}}` | All | Book overview from the Book tab |
| `{{book.genre}}` | All | Genre or combination of genres |
| `{{book.style}}` | All | Preferred writing style |
| `{{book.pov}}` | All | Default book point of view |
| `{{book.tense}}` | All | Default narrative tense |
| `{{book.language}}` | All | Primary writing language |
| `{{scene.text}}` | Story | Current scene text supplied for continuation |
| `{{scene.pov}}` | Story | Scene-specific point of view, when set |
| `{{target.type}}` | Summarize, Titles & names | Requested summary, title, or name target |
| `{{target.previous_summary}}` | Summarize | Existing summary supplied during re-summarization |
| `{{count}}` | Titles & names | Requested number of title or name options |

Story and Summarize prompts are rendered by the current generation flows. Titles & names variables define the prompt contract for its planned generation flow.

## Current prototype scope

The current prototype validates the complete interface direction and the working AI-settings flow.

Implemented as working behavior:

- provider selection and compatible endpoint entry;
- API-key entry and device-local persistence;
- provider model loading where browser permissions allow it;
- model search, favorites, and Main/Support selection;
- editable Story, Summarize, and Titles & names prompts;
- saving and restoring global AI defaults;
- independent per-book AI settings, explicit reset from defaults, and book-scoped generation;
- persisted current-book metadata in the right-side Book tab;
- persisted books, acts, chapters, scenes, navigation, autosave, and local document snapshots;
- persisted Scene, Chapter, and Act summaries with freshness tracking and Support-model generation;
- persisted, searchable Notes and categorized Codex entries using the shared Markdown editor.

Implemented as interactive UI prototypes or placeholders:

- Markdown editor and active-line editing;
- settings and book-workspace navigation;
- alternate compact/card layouts for Notes and Codex;
- Arc drawer and generation controls;
- chat history, chat settings, messages, editing states, and composer.

The prototype is not yet an MVP. Chats are not yet backed by the planned IndexedDB data model, and the generation context builder is still pending.

## Not decided yet

- Exact chat data schema
- IndexedDB migrations and repository boundaries
- Autosave and snapshot retention rules
- Export and import file formats
- Cloud synchronization or a backend
- Exact prompt-template parser and escaping rules
- Final context formatting and model-specific budgeting heuristics
- Provider-specific capability normalization
- Final light themes and custom-theme persistence

These items should not be treated as requirements until a later decision updates this document.
