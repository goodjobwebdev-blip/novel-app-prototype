# Product specification

> Status: confirmed product direction plus current implementation boundary. Last reconciled with `main` on 2026-09-06. Update this document when a product decision or implemented boundary changes.

## What this app is

A personal, local-first novel-writing application inspired by NovelCrafter. It is intended for one writer to plan books, draft and organize manuscripts, keep story knowledge, and use AI writing assistance from phone or desktop browsers.

The application should feel like a quiet writing workspace, not a general-purpose chat client or publishing platform.

## Core product direction

- The home screen is a book library with covers, book and optional series titles, last-edited information, and a **New book** action.
- Creating a book immediately creates and opens an untitled book.
- If text-model settings are incomplete, Home shows a warning that opens the default AI settings.
- AI defaults are copied into a new book and then become independent book settings. Model favorites remain a global picker preference.
- UI appearance settings are global on the device and apply to every book; books do not override them.
- A book can contain optional Acts, Chapters, Scenes, Notes, summaries, a searchable story Codex, and book-aware Chats.
- Scenes, Notes, summaries, and Codex entries open in the main workspace.
- Chat replaces the editor workspace with a persisted conversation surface.
- AI generation uses the provider, model, prompt, and context selected by the user for the relevant book/generation type.

## Confirmed interface direction

### Editor

- The editor is the visual center of the app and occupies almost the full screen.
- It is a Markdown editor with an Obsidian-like active-line model: inactive lines render cleanly, while the active line exposes Markdown symbols.
- Floating controls open settings on the left and book navigation on the right without permanently reducing the writing surface.
- The bottom-right generation control starts generation. A long press exposes secondary generation actions.
- The bottom-left control opens a compact Arc drawer for generation instructions.
- Arc is a compact scrollable text input and can expand to a near-full-screen writing surface.
- Streamed manuscript generation is rendered at a configurable word pace; the default is 40 ms per word.

### Left settings

- The left side contains AI, Context, UI, Speech, and Image settings.
- AI and Context can be scoped to the open book where applicable.
- UI is global on the current device and has no per-book override.
- UI settings control editor typography, expandable/scalable text-input typography, built-in themes, and custom themes. Typography and theme selection are independent.
- Context Management is generation-type-specific for Story, Codex, Note, and Chat profiles. Story, Codex, and Chat currently expose rendered request previews; dedicated Note generation is not implemented yet.

### Right book workspace

- The right side contains persistent Book, Outline, Notes, Codex, and Chat tabs.
- Book contains current-book identity and story-profile metadata: title, shared series and book index, overview, genre, writing style, point of view, tense, and language. It also contains the destructive delete action.
- Series are library-level entities shared by books. The Book tab can choose `Standalone`, select an existing series, create one, and rename the selected series for every linked book.
- Outline supports optional Acts, Chapters, and Scenes. Selecting a Scene opens it in the editor.
- Acts, Chapters, and Scenes expose distinct current, missing, and outdated summary states.
- Summary icons open persisted Markdown summaries in the shared editor. Manual edits are supported, and AI summary generation uses the book's Support model.
- Notes open in the editor workspace.
- Codex supports search, categories, multiple layouts, and new entries.
- Chat shows persisted conversations ordered by recent activity. Selecting a Chat opens the conversation in place of the manuscript editor.

### Chat

- Chats belong to a Book and persist with their messages in IndexedDB.
- A new Chat inherits the book's Main model, Assistant system prompt, and Chat context defaults; those values are then saved independently for that Chat.
- Current-chat controls include model, system prompt, Thinking, and context selection through Context Management.
- Chat list actions include create, open, rename, delete with confirmation, recent-activity ordering, and search over title/last-message preview.
- User messages are persisted before assistant generation begins.
- Assistant responses stream into the conversation and can be stopped.
- User actions include edit and delete. Editing supports **Save** and **Save & regenerate**.
- Assistant actions include edit, fork, read aloud, regenerate, and delete.
- Chat can inspect the book workspace with read-only tools and can propose edits/creations/outline changes as approval cards. Mutating tool actions are not applied until the user approves them.
- Chat errors use the reusable top-screen toast and API keys must be redacted from surfaced provider errors.

### Visual system

- Mobile is the source design; desktop expands panels and density without changing the main interaction model.
- The initial theme direction is a dark writing canvas with warm paper-colored type, restrained borders, and translucent controls.
- Six built-in themes are currently defined: Very Dark, Blue Dark, Green Dark, Very White, Blue Light, and Green Light.
- Custom themes expose semantic colors for background, elevated surface, editor background, primary text, muted text, border, accent, active accent, selection, and error states.
- Main-editor typography and expandable-input typography each have independent font family, font size, line height, and font weight controls. Theme changes never change typography.
- The interface should keep the manuscript visually dominant and avoid unnecessary decoration.

## Technical constraints

- **Browser-first:** it must run in current phone and desktop browsers.
- **Installable:** the repository includes a web manifest and service worker for PWA installation/application-shell behavior.
- **Static deployment:** GitHub Actions builds the app and GitHub Pages hosts the generated files.
- **Current stack:** React 19, TypeScript, Vite 7, CodeMirror 6, and Dexie/IndexedDB. CI uses Node.js 24.
- **Local-first:** ordinary writing and organization do not require an application server or account.
- **Single-user:** collaboration, permissions, and multi-user accounts are out of scope.
- **No automatic cross-device sync initially:** each browser/device has an independent database.
- **Responsive:** essential writing and settings flows must work on both narrow phone screens and desktop screens.
- **Network boundary:** AI requests, provider model refreshes, and uncached external runtime dependencies require network access. Offline support remains prototype-grade rather than a guaranteed fully self-contained build.

## Data and recovery

- Manuscripts and structured book data are persisted in IndexedDB through Dexie.
- The current entity model includes Book, Series, Act, Chapter, Scene, Note, Codex entry, Summary, Chat, ChatMessage, and book-scoped Settings records.
- Document snapshots are stored separately and can be created for autosave, generation, manual, navigation, and lifecycle recovery points.
- Small interface preferences and global AI defaults use `localStorage`. Each book's AI and context settings are stored with its IndexedDB entities.
- UI typography, active theme, custom themes, and model favorites are global device preferences.
- Editing autosaves locally.
- Local snapshots provide recovery/version history but are not backups because they live on the same device.
- Manual export/import is still required for reliable backup and transfer between devices, but is not implemented yet.
- Destructive or bulk operations should create a recovery point when practical.
- Large binary libraries such as extensive images, audio, or PDFs are not an initial storage goal.

## AI constraints and decisions

- Supported provider choices are OpenRouter, nano-gpt.com, OpenAI, and an OpenAI-compatible custom endpoint.
- Provider calls are made directly from the browser. The provider must permit browser requests, and the API key is necessarily available to the browser runtime.
- The user selects Main and Support models from the provider model list, plus an optional Codex model. Main is intended for story writing and is the default Chat model; Support handles summaries and utility tasks; Codex falls back to Main when its dedicated model is empty.
- Model controls support loading, search, favorites, context/capability metadata when supplied, and provider errors.
- The user can edit five system prompts: Story, Summarize, Titles & names, Lore entries, and Assistant.
- Prompt rendering is implemented in-app. It supports `{{variable}}` substitution and simple `{% if variable %}...{% endif %}` conditional blocks.
- AI defaults, including the API key, are persisted in `localStorage` on that browser/device. A new book copies provider, key, endpoint, model choices, generation word delay, and prompts into an independent book settings record. Later default changes do not affect an existing book unless it is explicitly reset from defaults.
- The API key must never be committed to the repository or embedded in the deployed build.
- Local browser persistence is convenient but is not secure storage against scripts running in the same origin; this tradeoff is accepted for the personal prototype.
- AI features must fail clearly without corrupting manuscript text.
- AI generation is optional. The non-AI writing experience remains usable without a configured provider.

### Scene generation

- Story generation uses the Story prompt and the book's Main model.
- The current Scene is always part of the request. When the Scene is empty, the previous Scene can be included as an automatic fallback.
- Earlier summaries are assembled hierarchically so a complete earlier Act/Chapter summary can replace lower-level summaries without leaking later material.
- User-selected additional context is deterministic and separate from automatic context.
- Generation streams into the editor and is integrated with editor history/recovery.
- Oversized requests are rejected before generation rather than silently truncating selected story context.

### Codex generation

- Codex generation uses the Lore prompt and the optional Codex model, falling back to Main.
- Generation replaces only the Codex entry body; title/category are preserved.
- The last-opened Scene is included automatically by default and can be disabled in the Codex context profile.
- Stop/failure restore the pre-generation body rather than persisting a partial Codex result.
- Full behavior is specified in [CODEX_GENERATION_SPEC.md](CODEX_GENERATION_SPEC.md).

### Chat generation

- Chat uses the current book's provider/API settings and a per-chat model inherited from Main by default.
- The Assistant system prompt is copied into each Chat when created and can then be edited independently.
- Selected book context is assembled through the same context service and sent as system context alongside the saved conversation history.
- The request preview shows the Chat system prompt, workspace instructions, selected book context, saved user/assistant turns, and assistant reasoning where present.
- Chat tool calls can inspect Scenes/Notes/Codex/outline and can create approval proposals for document, entity, Codex, and outline changes.
- The current implementation still has two open issue #29 gaps: it rejects an over-budget full history instead of trimming older turns first, and a non-abort provider/network failure after streaming begins does not yet persist the partial assistant round.

### Prompt variables

System prompts use `{{variable}}` for substitution and `{% if variable %}...{% endif %}` for optional blocks. The AI settings screen lists variables available to the selected prompt type.

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
| `{{scene.text}}` | Story, Lore entries | Current Scene for Story; last-opened Scene for Lore entries |
| `{{scene.previous_text}}` | Story | Immediately previous Scene text when the current Scene is empty |
| `{{scene.summary_context}}` | Story | Automatically selected summaries of earlier material |
| `{{scene.pov}}` | Story | Scene-specific point of view, when set |
| `{{entry.title}}` | Lore entries | Current Codex entry title |
| `{{entry.category}}` | Lore entries | Current Codex entry category |
| `{{entry.content}}` | Lore entries | Existing Codex entry Markdown body |
| `{{additional_context}}` | Story, Lore entries | Deterministically ordered sources selected in Context Management |
| `{{target.type}}` | Summarize, Titles & names | Requested summary, title, or name target |
| `{{target.previous_summary}}` | Summarize | Existing summary supplied during re-summarization |
| `{{count}}` | Titles & names | Requested number of title or name options |

Chat book context is assembled as separate system context rather than through `{{additional_context}}` in the Assistant template.

## Current prototype scope

Implemented as working behavior:

- book library, Book metadata, shared Series entities, outline navigation, and delete/create flows;
- IndexedDB persistence for book content/settings plus local document snapshots;
- Markdown editor, autosave, navigation, undo/redo integration, and responsive workspace panels;
- persisted Scene/Chapter/Act summaries with freshness tracking and Support-model generation;
- persisted searchable Notes and categorized Codex entries with multiple list layouts;
- global typography/theme settings and persisted custom semantic themes;
- provider/model loading for four provider modes, model favorites, global AI defaults, and independent per-book AI settings;
- five editable prompts and the current prompt template renderer;
- generation writing-pace control;
- Story generation and Codex generation with context-budget checks;
- per-book Scene/Codex/Note/Chat context profiles and deterministic context assembly;
- rendered request preview for Story, Codex, and Chat;
- persisted Chats and ChatMessages, chat list/search/rename/delete, streaming responses, Stop, edit/regenerate/fork/read-aloud actions, per-chat settings, and approval-based workspace tools;
- PWA manifest/service worker and GitHub Pages CI/CD.

Implemented only as placeholders or still incomplete:

- dedicated Note generation/context request flow;
- Speech settings and speech-generation features beyond browser read-aloud in Chat;
- Image settings/generation;
- dedicated Titles & names generation UI despite the prompt contract being present;
- export/import and cross-device transfer;
- automatic cloud synchronization;
- Chat context-history trimming and non-abort partial-response persistence tracked in #29.

The prototype is not yet an MVP; its main missing product-quality work is recovery/transfer, more complete offline packaging, remaining AI edge cases, and unfinished settings/generation surfaces.

## Not decided yet

- Snapshot retention/cleanup rules.
- Export/import file format and compatibility policy.
- Cloud synchronization or backend architecture.
- Provider-specific capability normalization beyond the metadata currently exposed.
- Whether the simple prompt renderer should remain intentionally limited or be replaced with a richer templating system.
- Exact dedicated Note-generation behavior and UX.
