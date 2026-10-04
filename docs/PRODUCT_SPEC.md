# Product specification

> Status: confirmed product direction plus current implementation boundary. Settings/profiles reconciled with the current working-tree code on 2026-10-04, not only `main`. This documentation-only review ran no tests, builds, or browser checks; the redesign remains in integration, not fully validated/completed. Update this document when a product decision or implemented boundary changes.

## What this app is

A personal, local-first novel-writing application inspired by NovelCrafter. It is intended for one writer to plan books, draft and organize manuscripts, keep story knowledge, and use AI writing assistance from phone or desktop browsers.

The application should feel like a quiet writing workspace, not a general-purpose chat client or publishing platform.

## Core product direction

- The home screen is a book library with covers, book and optional series titles, last-edited information, and a **New book** action.
- Creating a book immediately creates and opens an untitled book.
- If text-model settings are incomplete, Home shows a warning that opens global AI settings.
- Global defaults assign shared profile/preset IDs to a new book; changing the default assignment does not reassign existing books. Saving a shared definition affects all linked books for subsequent operations. Duplicate creates an independent definition; model favorites remain a global text-picker preference.
- Each book selects a UI profile. Home and other global surfaces use the same default UI profile assigned to new books; there is no separate application UI profile.
- A book can contain optional Acts, Chapters, Scenes, Notes, summaries, a searchable story Codex, and book-aware Chats.
- Scenes, Notes, summaries, and Codex entries open in the main workspace.
- Chat replaces the editor workspace with a persisted conversation surface.
- AI generation resolves the book-selected model profile and prompt preset with book/chat-local context. One globally active text connection serves every text profile/role; books do not choose credentials or endpoints.

## Confirmed interface direction

### Editor

- The editor is the visual center of the app and occupies almost the full screen.
- It is a Markdown editor with an Obsidian-like active-line model: inactive lines render cleanly, while the active line exposes Markdown symbols.
- Floating controls open settings on the left and book navigation on the right without permanently reducing the writing surface.
- The bottom-right generation control starts generation. A long press exposes secondary generation actions.
- The bottom-left control opens a compact Arc drawer for generation instructions.
- Arc is a compact scrollable text input and can expand to a near-full-screen writing surface.
- Streamed manuscript generation is rendered at a configurable word pace stored in the UI profile; the initial default is 40 ms per word.

### Left settings

- Book settings have exactly two tabs: **Profiles** and **Context**. Profiles offers Text, TTS, STT, Image, Video, UI, and Story/Codex/Summary preset selections, summaries, and **Edit** links, not credentials or detailed editors.
- Global Settings is available from Home and beside Home in book settings. It contains **AI > Connections / Models / Prompts**, **UI**, **Application**, and **Sync**. TTS, STT, Image, and Video are separate model-profile types; UI has its own editor.
- Shared profile/preset editors use drafts and explicit **Save**, display linked books, and confirm changes affecting them. Unsaved edits do not propagate; Duplicate lets a book diverge. Current defaults and referenced objects cannot be deleted.
- Application selects defaults for new books and work outside a book, and contains global audio-cache settings and initial Context defaults. Working Context remains book/chat-local, not a shared profile.
- UI profiles control editor typography, expandable/scalable text-input typography, themes/custom themes, Highlight dialogue, Show scene beats, Save Arc as beat, and text reveal speed/custom speed. Typography and theme selection are independent. Save Arc as beat affects instruction storage, not only appearance.
- **Edit** opens the selected global object; **Back to Profiles** returns to that book's assignments. Close returns to the source screen, including Images. **Back to last book** uses a device-local saved book/document/chat location, not last-edited timestamps, and is unavailable when no accessible last book exists. Cursor/scroll/focus restoration is not part of the persisted location.
- Context Management uses explicit Story, Codex, Chat, Summary, and Note tabs rather than following the active workspace entity. Story, Codex, and Chat expose rendered request previews; Summary context is source-driven and read-only, and dedicated Note generation is not implemented yet.

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
- **Confirmed option A:** a new Chat snapshots the Chat role of the **book-selected Text profile**, including role model (Main fallback when empty), thinking, role-linked prompt preset content, context-window parameters, and max model rounds. Book Chat context defaults initialize its independent context.
- Character chat snapshots the separate Character chat role from the same selected Text profile, with its own model/thinking/preset/rounds, participants, story cutoff, and character-local context. Knowledge boundaries and app-owned roleplay instructions are enforced separately from the preset.
- No separate book Chat/Character prompt selector is introduced. Existing chats/forks keep their own snapshots and manual overrides after shared-profile/preset edits; connections/credentials are not part of the snapshot.
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
- **Independent device storage:** each browser/device has its own database and profile library. Optional per-book archive sync is implemented through a self-hosted Go/PostgreSQL backend; it transfers complete revisions rather than merging records or synchronizing the whole global library. See [SYNC_BACKEND.md](SYNC_BACKEND.md).
- **Responsive:** essential writing and settings flows must work on both narrow phone screens and desktop screens.
- **Network boundary:** AI requests, provider model refreshes, and uncached external runtime dependencies require network access. Offline support remains prototype-grade rather than a guaranteed fully self-contained build.

## Data and recovery

- Manuscripts and structured book data are persisted in IndexedDB through Dexie.
- The current entity model includes Book, Series, Act, Chapter, Scene, Note, Codex entry, Summary, Chat, ChatMessage, and book-scoped Settings records.
- Document snapshots are stored separately and can be created for autosave, generation, manual, navigation, and lifecycle recovery points.
- Shared profiles/presets, default selections, global Connections, model favorites, and last-book location use device-local `localStorage`. Books store profile-selection IDs, validated catalog metadata, and local Context settings in IndexedDB.
- UI profiles contain typography, active theme, custom themes, editor flags, and reveal speed; the selected book profile or global default determines the active UI. The current code embeds custom themes in each UI profile rather than a separate shared theme library.
- Legacy per-book AI configuration is retained in local recovery metadata during lazy migration. It is excluded from archives as a connection and does not override the active global connection. A user-facing legacy-credential reconciliation/recovery flow is still missing.
- Manuscript/content editing autosaves locally; shared profile/preset drafts require explicit Save.
- Local snapshots provide recovery/version history but are not backups because they live on the same device.
- Manual book export/import uses `.arcbook` **v4** for profile-bearing books: text, book-local settings/selections, sanitized selected profile/preset/theme definitions and Chat/Character dependencies, chat snapshots, history, illustrations, and kept gallery media. The decoder accepts v1–v4; legacy payloads without profiles encode as v2 or v3 with video. See [CODEX_ILLUSTRATIONS.md](CODEX_ILLUSTRATIONS.md).
- Archives and archive sync exclude all connection configurations: endpoints, accounts, credentials, local connection IDs, and credential/connection fingerprints, including nested job metadata. Provider/model identity remains portable; imported models require compatible local Connections. Free text is not a secret-redaction boundary.
- Ordinary imports remap book/profile IDs and create an independent book; paid jobs never resume. Connected sync preserves book identity and installs incoming profiles with conflict clones/remapped references rather than overwrite differing shared local objects; repeat installation can reuse an identical prior clone. This does not transfer global default assignments or the whole library.
- Book records commit in IndexedDB, but profile installation writes `localStorage`; rollback is not atomic across both stores and failed imports can leave unused profiles. End-to-end failure/recovery validation remains pending.
- Destructive or bulk operations should create a recovery point when practical.
- Codex entries support one optimized primary illustration plus a thumbnail, with local storage usage and backup controls. Generated images/videos also have a separate kept-media Gallery. A general-purpose audio/PDF library remains outside this storage scope.

## AI constraints and decisions

- Supported text provider choices are OpenRouter, nano-gpt.com, OpenAI, LiteLLM, an OpenAI-compatible custom endpoint, and Fake (testing). Global Connections selects **one active text provider/connection for all profiles and roles**; text profiles contain no connection selector.
- Provider calls are made directly from the browser. The provider must permit browser requests, and the API key is necessarily available to the browser runtime.
- One Text profile contains **Main / Support / Codex / Chat / Character chat**, with independent model/thinking settings. Main writes prose and supports quick tools; Support handles summaries/titles and utilities. Codex, Chat, and Character chat fall back to Main when their model is empty; the fallback does not replace role-specific thinking or chat rounds.
- Main and Codex context caps are in their role cards, never raising the model hard maximum. Codex → Main fallback uses Main cap. Chat/Character chat role cards select initial prompt presets and max model rounds for new snapshots.
- Model controls support loading, search, favorites, context/capability metadata when supplied, and provider errors.
- Global prompt-preset libraries cover **Story, Codex, Summary, Chat, and Character chat**, with System and ordered Predefined messages. Book Story/Codex/Summary selections are live links; Chat/Character selections belong to Text-profile roles and are copied into new chats.
- Story/Codex/Summary **response length belongs to the preset**, not the Text or UI profile. It is sent only through enabled templates referencing `{{response.length}}`, never as a hidden extra message. Titles & names remains a runtime/legacy prompt contract, not a new book preset selector.
- Prompt rendering is implemented in-app. It supports `{{variable}}` substitution and simple `{% if variable %}...{% endif %}` conditional blocks.
- Credentials/endpoints are device-global Connections stored locally, never copied into new book/profile/chat records. Global speech/media overrides are allowed; they do not introduce book-local connections. Consolidating their UI does not add provider capabilities beyond the existing adapters.
- New books store the default profile/preset IDs. Later changes to default IDs do not change existing assignments; successful Save of a linked definition affects the next operation. In-flight requests/jobs must retain captured configuration rather than silently switch models/accounts mid-operation.
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

- Chat uses the globally active text connection with its independently saved per-chat model. Changing Connections still affects existing chats; a saved model ID must be compatible with that provider.
- The role-linked preset content is copied from the book-selected Text profile into each Chat/Character chat at creation and can then be edited independently. A Main fallback snapshots Main context cap/window, but retains the Chat/Character thinking and rounds.
- Chat uses a per-conversation PromptComposition: one System prompt plus ordered Predefined System/User/Assistant configuration messages, followed by real chronological history and the newest real User turn. Book/story context is exposed through explicit composition variables; no hidden selected-context or response-length message is injected.
- Workspace instructions are exposed as the app-owned `chat.workspace_instructions` variable while callable tool schemas remain structured provider metadata. The prototype database v3 migration deletes legacy Chat and ChatMessage entities together while preserving all non-Chat entities and Book-level settings.
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

Chat book context is exposed through explicit composition variables such as `{{context.automatic}}` and `{{context.additional}}`; enabled System/Predefined templates determine where it appears. App-owned workspace/character instructions and structured tool metadata retain their separate contracts; there is no hidden selected-context message.

## Current prototype scope

Present in the implementation (profile items are based on source inspection, not acceptance-test results):

- book library, Book metadata, shared Series entities, outline navigation, and delete/create flows;
- IndexedDB persistence for book content/settings plus local document snapshots;
- Markdown editor, autosave, navigation, undo/redo integration, and responsive workspace panels;
- persisted Scene/Chapter/Act summaries with freshness tracking and Support-model generation;
- persisted searchable Notes and categorized Codex entries with multiple list layouts;
- shared UI profiles with typography/themes/custom semantic themes, editor flags, and generation writing pace, resolved per book or from global defaults;
- global Connections and provider/model loading, text model favorites, shared Text/TTS/STT/Image/Video profiles and book selections;
- live prompt presets and the current template/composition renderer, explicit shared Save/usage warnings, Duplicate, protected defaults, and per-chat snapshots;
- Profiles + Context book settings, global editors/defaults/audio cache, Edit/back navigation, and persisted last-book entity/surface location;
- portable archive v4 profile definitions, sanitation, ordinary-import ID remapping, and conflict clones during sync-profile installation;
- TTS/read-aloud and STT/dictation paths, a separate image/video workspace and durable device queue, kept-media Gallery, and optional per-book archive sync;
- Story generation and Codex generation with context-budget checks;
- per-book Scene/Codex/Note/Chat context profiles and deterministic context assembly;
- rendered request preview for Story, Codex, and Chat;
- persisted Chats and ChatMessages, chat list/search/rename/delete, streaming responses, Stop, edit/regenerate/fork/read-aloud actions, per-chat settings, and approval-based workspace tools;
- PWA manifest/service worker and GitHub Pages CI/CD.

Implemented only as placeholders or still incomplete:

- dedicated Note generation/context request flow;
- full settings/profile redesign acceptance: legacy-credential reconciliation UI, cross-store import rollback/recovery, all runtime consumers, navigation/draft preservation, and keyboard/mobile behavior are not signed off. TTS/STT and image/video paths exist; they are no longer placeholder settings;
- dedicated Titles & names generation UI despite the prompt contract being present;
- whole-library cross-device synchronization and record-level merges (optional complete-book archive sync, remote checks, and opt-in idle uploads exist);
- Chat context-history trimming and non-abort partial-response persistence tracked in #29.

The prototype is not yet an MVP; its main missing product-quality work is broader recovery/transfer validation, more complete offline packaging, remaining AI edge cases, and unfinished settings/generation integration. The confirmed profile decisions, code map, and unvalidated acceptance checklist are in [SETTINGS_PROFILES_REDESIGN.md](SETTINGS_PROFILES_REDESIGN.md).

## Not decided yet

- Snapshot retention/cleanup rules.
- Future archive evolution beyond implemented v4; versions 1–4 and sanitized profile portability are no longer open format decisions.
- Broader sync evolution beyond the implemented optional Go/PostgreSQL per-book archive backend; whole-library sync/merging is not part of the profile redesign.
- Provider-specific capability normalization beyond the metadata currently exposed.
- Whether the simple prompt renderer should remain intentionally limited or be replaced with a richer templating system.
- Exact dedicated Note-generation behavior and UX.
