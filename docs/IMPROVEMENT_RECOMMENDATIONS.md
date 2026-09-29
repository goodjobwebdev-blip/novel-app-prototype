# Application Improvement Recommendations

> Review date: 2026-09-29  
> Status: recommendations only — no application changes are included in this document.

This document collects suggested improvements for the Novel App Prototype after reviewing the frontend, backend, tests, build configuration, synchronization design, PWA behavior, and product documentation.

## Priority definitions

- **P0 — Release-critical:** address before deployments can be considered reliably validated.
- **P1 — High priority:** strong candidate for the next product or engineering milestone.
- **P2 — Medium priority:** valuable enhancement that can follow the reliability baseline.

The recommendations are divided into these sections:

1. Bugs and correctness
2. Product features
3. UX and accessibility
4. Performance and offline behavior
5. Security, privacy, and reliability
6. Engineering quality and maintainability
7. Suggested roadmap

---

# Section 1 — Bugs and correctness

## P0: Reconcile the failing frontend test suite

The production build succeeds, but the frontend suite currently reports **29 failing tests out of 499**.

Some failures appear to be stale source-code assertions rather than real product failures, but at least one exposes a genuine mismatch: sync settings are expected to normalize the endpoint, while the implementation stores it unchanged.

### Suggestion

Classify every failure as one of the following:

- actual product regression;
- stale test;
- test-environment problem;
- obsolete expectation.

Deployments should not proceed through CI while the status of those failures is unknown.

### Relevant areas

- `tests/`
- `tests/sync.test.mjs`
- `src/features/sync/sync-settings.ts`
- `.github/workflows/deploy.yml`

---

## P1: Prevent synchronization from overwriting edits made during a pull

Synchronization saves current work before beginning, but the user can continue editing while the remote archive is downloading. The subsequent remote replacement can overwrite those newer local changes.

### Suggestion

Introduce a local book revision or generation counter:

1. Capture the local revision immediately after the pre-sync save barrier.
2. Download and validate the remote archive.
3. Before replacing local data, verify that the local revision has not changed.
4. If it changed, stop and present a conflict rather than replacing the book.
5. Pause or queue writes during the replacement transaction and workspace reload.

### Relevant areas

- `src/features/sync/sync-service.ts`
- `src/features/sync/sync-persistence.ts`
- `src/app/Workspace.tsx`

---

## P1: Serialize synchronization across tabs and entry points

Manual synchronization, automatic synchronization, and synchronization from another browser tab can run simultaneously. This can create false conflicts or allow an older operation to overwrite newer status information.

### Suggestion

- Introduce a book-level queue within each tab.
- Use the Web Locks API or an IndexedDB lease for cross-tab ownership.
- Associate status updates with operation IDs so stale operations cannot overwrite newer state.
- When a request returns `412`, compare content hashes before declaring a conflict. Identical content should be considered synchronized.

### Relevant areas

- `src/features/sync/sync-service.ts`
- `src/features/sync/BookSyncControls.tsx`
- `src/features/sync/LocalBookSync.tsx`
- `src/app/Workspace.tsx`
- `src/data/persistence.ts`

---

## P1: Make chat regeneration non-destructive

Regenerating an assistant response deletes the existing response—and potentially later conversation history—before the replacement succeeds.

If the provider request, persistence, context validation, or network connection fails, the previous answer is lost.

### Suggestion

Retain the existing answer until the replacement is saved successfully. Ideally, regeneration should create an alternative answer or branch instead of deleting the previous one.

### Relevant area

- `src/features/chat/ChatFeature.tsx`

---

## P1: Prevent dictation from modifying a newly read-only document

The editor’s imperative dictation methods can retain an old `readOnly` value. If a document becomes read-only without the component being fully remounted, dictation may still insert text.

### Suggestion

Check the editor’s current state whenever dictation begins or inserts content rather than relying on the initial React property.

### Relevant area

- `src/features/editor/MarkdownEditor.tsx`

---

## P1: Ensure pending settings changes survive refresh and tab closure

AI and image settings are saved with short delays. Closing or refreshing the page before that delay expires can lose the latest setting.

### Suggestion

- Save lightweight local settings immediately; or
- explicitly flush pending values during browser lifecycle events such as `pagehide` and `visibilitychange`.

### Relevant areas

- `src/app/App.tsx`
- `src/features/images/ImageSettingsPanel.tsx`

---

## P1: Validate sync settings before displaying “Saved”

The sync screen stores every keystroke and can display “Saved” for malformed URLs, insecure production URLs, or unnormalized endpoints.

### Suggestion

Distinguish between:

- draft value;
- valid saved configuration;
- invalid configuration;
- successfully tested connection.

Normalize valid endpoints before persisting them.

### Relevant areas

- `src/features/sync/SyncSettingsPanel.tsx`
- `src/features/sync/sync-settings.ts`
- `tests/sync.test.mjs`

---

## P1: Record the hash of the archive actually downloaded

During synchronization, book metadata and the archive are fetched separately. If another device uploads between those requests, the app can associate the downloaded archive with an older content hash.

### Suggestion

Calculate the hash from the downloaded archive itself, or return a verified content hash with the archive response.

### Relevant area

- `src/features/sync/sync-service.ts`

---

## P2: Allow a previously deleted cloud book to reconnect

Cloud deletion is currently a soft delete, but the backend’s uniqueness rules can prevent the same local book identity from being registered again.

### Suggestion

Explicitly support one of these models:

- restore a deleted cloud book;
- permanently purge it;
- allow a new active record after soft deletion.

The UI should call soft deletion **Archive** if the data is intentionally retained.

### Relevant areas

- `backend/migrations/000001_initial.sql`
- `backend/internal/storage/store.go`
- `src/features/sync/sync-service.ts`

---

## P2: Prevent concurrent image-source additions from replacing one another

Selecting multiple gallery source images quickly can start asynchronous conversions from the same stale source list. The conversion that finishes last can overwrite the other selection.

### Suggestion

Serialize source additions, temporarily disable additional selections while decoding, or use an atomic functional state update.

### Relevant area

- `src/features/images/ImageGenerationControls.tsx`

---

## P2: Keep image default-model state consistent

Removing the current default model can leave the settings screen showing stale state, even though persistence selects a fallback.

### Suggestion

Apply normalized persisted settings back to visible component state immediately.

### Relevant areas

- `src/features/images/ImageSettingsPanel.tsx`
- `src/features/images/image-settings.ts`

---

## P2: Complete the remaining chat failure behavior

The README identifies two incomplete chat behaviors:

- trim older history when the request exceeds the model context window;
- preserve partial assistant output after a non-cancellation provider or network failure.

These are particularly important for long conversations and unreliable mobile connections.

### Relevant areas

- `README.md`
- `src/features/chat/`

---

## P2: Verify lifecycle document saves in real browsers

The application starts asynchronous IndexedDB work during page lifecycle events. Browsers do not always guarantee completion of arbitrary asynchronous work during termination.

The normal autosave interval reduces the risk, but an edit made immediately before closing a tab may still be vulnerable.

### Suggestion

Treat this as a browser-level verification task rather than a confirmed defect. Add termination/reload tests and consider reducing the amount of unsaved state held between durable writes.

### Relevant area

- `src/app/Workspace.tsx`

---

# Section 2 — Product features

## P1: Document history and recovery interface

The application already creates and stores document snapshots, including autosave, recovery, generation, manual, navigation, and lifecycle snapshots. Users cannot currently browse or restore them through the interface.

### Suggested feature

- Per-document history drawer.
- Snapshot timestamp and reason.
- Side-by-side or inline preview.
- Diff against the current version.
- Restore as a new revision rather than destructively replacing the current text.
- Optional named or manual checkpoints.

This is one of the highest-value additions for a writing application because much of the underlying data support already exists.

### Relevant areas

- `src/data/persistence.ts`
- `src/app/Workspace.tsx`

---

## P1: Alternative AI responses and chat branches

Build on the existing chat-fork capability so regeneration creates alternatives instead of erasing the current answer.

### Suggested feature

- Previous/next response navigation.
- Compare alternatives.
- Fork from any answer.
- Promote an alternative as the active branch.
- Preserve tool proposals associated with each branch.

### Relevant area

- `src/features/chat/ChatFeature.tsx`

---

## P1: Publishing-oriented manuscript export

Current `.arcbook` export is suitable for backup, but not for sharing with editors or publishing.

### Suggested formats

- Markdown;
- plain text;
- DOCX;
- PDF;
- optionally EPUB later.

### Suggested options

- Chapter headings.
- Scene separators.
- Title page.
- Include or exclude notes and planning information.
- Page-break rules.
- Illustration inclusion.
- Manuscript formatting presets.

### Relevant area

- `src/data/BookStorage.tsx`

---

## P1: AI and media usage dashboard

The application already receives token and cost-related metadata in several generation paths.

### Suggested feature

- Token usage by book, provider, and model.
- Estimated cost by day and month.
- Image and video generation spend.
- Cost estimates before starting expensive jobs.
- Configurable monthly budget warnings.
- Exportable usage history.

This is especially valuable when a chat response performs multiple tool rounds.

### Relevant areas

- `src/app/Workspace.tsx`
- `src/features/chat/ChatFeature.tsx`
- `src/features/images/ImageResults.tsx`

---

## P1: Search across the whole book

Codex and Chat have localized search, but a novel-writing workspace benefits from a unified search surface.

### Suggested scope

- Scenes.
- Notes.
- Summaries.
- Codex entries.
- Chat titles and messages.
- Character mentions.
- Exact phrase and fuzzy matching.
- Filters by entity type, Act, Chapter, or date.

A useful extension would be **Find all mentions** from a Codex character or location.

---

## P1: Dedicated revision workflow for manuscript text

Beyond snapshots, writers often need an editorial state model.

### Suggested additions

- Document status such as Draft, Revised, or Final.
- Scene-level comments.
- Private inline annotations.
- Revision goals.
- Accepted and rejected AI changes.
- Comparison between drafts.

---

## P2: Writing analytics and progress goals

The app already has author-planning functionality that could be extended into writing progress.

### Suggested metrics

- Daily word count.
- Words by Scene or Chapter.
- Writing streak.
- Target manuscript length.
- Session duration.
- Revision versus new-writing totals.
- Project completion estimate.

All analytics could remain device-local by default.

---

## P2: Dedicated Note generation

Dedicated Note generation remains incomplete.

### Possible actions

- Expand a note.
- Summarize research.
- Convert a note into scene beats.
- Extract Codex candidates.
- Rewrite a note as an outline.
- Identify unresolved questions.

---

## P2: Titles and names generation interface

A prompt contract exists for titles and names, but the application lacks a dedicated product surface.

### Possible workflows

- Book and Chapter titles.
- Character names.
- Place names.
- Organization names.
- Style, language, and genre constraints.
- Save results directly to book metadata or Codex.

---

## P2: Storage-management dashboard

The app stores snapshots, illustrations, generated media, audio, and archives locally. Users need visibility into storage consumption.

### Suggested feature

- Total browser storage usage.
- Usage by book and media type.
- Browser quota estimate.
- Old generated-media cleanup.
- Snapshot-cleanup preview.
- Backup reminder before destructive cleanup.

---

## P2: Sync history and device management

Once roaming is important, synchronization should expose more than a current status label.

### Suggested feature

- Connected devices.
- Most recent upload and download.
- Revision history.
- Archive size.
- Restore an earlier cloud revision.
- Revoke a device or token.
- Clearly distinguish local, remote, synchronized, and conflict states.

---

# Section 3 — UX and accessibility

## P1: Standardize dialogs

Several custom dialogs visually appear modal but do not consistently:

- move focus into the dialog;
- keep keyboard focus inside it;
- hide or disable the background;
- restore focus to the invoking button;
- support assistive technology correctly.

### Suggestion

Use one shared accessible dialog primitive across the application, preferably based on the native `<dialog>` element where browser support and application behavior allow it.

### Relevant examples

- Generation details in `src/app/Workspace.tsx`.
- Automatic title dialog in `src/app/Workspace.tsx`.
- `src/features/editor/EditorBlocks.tsx`.
- `src/features/writing/SynonymsDialog.tsx`.
- `src/features/images/IllustrationModal.tsx` as an existing native-dialog reference.

---

## P1: Consolidate searchable model selectors

There are multiple independently implemented model and select controls with different keyboard and screen-reader behavior.

### Suggestion

Create one accessible, reusable rich picker supporting:

- field-label association;
- arrow-key navigation;
- Escape and focus restoration;
- closing when focus leaves;
- loading and error states;
- favorites;
- model capability metadata.

### Relevant areas

- `src/shared/ui/SearchableSelect.tsx`
- `src/features/chat/ChatFeature.tsx`

---

## P1: Improve long-running operation feedback

Generation, archive export/import, synchronization, media conversion, and cloud transfer can take substantial time.

### Suggested improvements

- Operation progress where measurable.
- Elapsed time.
- Cancel action.
- Clear distinction between queued, preparing, uploading, generating, and saving.
- “Safe to close” or “Keep this tab open” messaging.
- Recovery instructions when an operation is interrupted.

---

## P1: Make data safety visible

Local-first behavior is valuable, but users may not understand the difference between:

- autosave;
- snapshots;
- backups;
- cloud sync;
- provider requests.

### Suggestion

Provide a small data-safety status area showing:

- saved locally;
- last recovery point;
- last external backup;
- last cloud synchronization;
- current offline or online state;
- whether the current operation sends text or images to an external provider.

---

## P2: Improve first-run onboarding

The application contains many sophisticated systems. A new user may struggle to understand books, Codex, context configuration, model roles, and synchronization.

### Suggested onboarding sequence

1. Create the first book.
2. Explain local-first storage.
3. Offer an immediate backup.
4. Configure AI only if desired.
5. Create the first Scene.
6. Introduce Codex and context progressively.
7. Explain paid image or video generation before first use.

---

## P2: Introduce a command palette and keyboard shortcuts

A command palette would be useful for desktop writers without adding permanent interface clutter.

### Possible commands

- Switch Scene.
- Create Scene, Note, or Codex entry.
- Search book.
- Toggle focus mode.
- Open history.
- Export.
- Generate.
- Stop generation.
- Open AI or context settings.

Include a searchable keyboard-shortcut reference.

---

# Section 4 — Performance and offline behavior

## P1: Split the application bundle by feature

The production build currently produces one main JavaScript bundle of approximately:

- **1.84 MB minified**;
- **567 KB gzip**.

Major features are imported eagerly even if the user never opens them.

### Suggested lazy-loading boundaries

- Library and home shell.
- Editor and CodeMirror.
- Chat.
- Images and gallery.
- Settings.
- Speech.
- Advanced Codex views.
- Synchronization screens.

This would particularly improve first load on mobile devices.

### Relevant areas

- `src/app/Workspace.tsx`
- `src/app/App.tsx`
- `src/app/main.tsx`

---

## P1: Reduce the default font payload

The application imports many variable font families on startup.

### Suggestion

- Ship a small default font set.
- Load optional fonts only when selected.
- Load only required language subsets.
- Cache selected fonts for offline use.

### Relevant area

- `src/app/main.tsx`

---

## P1: Replace runtime-only service-worker caching with build-generated precaching

The service worker initially caches only the root page. Other assets become available offline only after they happen to be requested.

### Suggestion

Use a build-revisioned precache manifest so the required application shell is predictably available offline.

Also add:

- cleanup of obsolete hashed assets;
- an **Update available** notification;
- controlled reload behavior;
- browser-level offline and update tests.

### Relevant areas

- `public/sw.js`
- `src/app/main.tsx`

---

## P1: Avoid permanent background image-queue polling

The image queue polls IndexedDB regularly even when no image jobs exist.

### Suggestion

Use event-driven wakeups and poll only while queued or active jobs exist. Slow recovery polling can remain as a fallback.

### Relevant areas

- `src/features/images/image-queue.ts`
- `src/app/Workspace.tsx`

---

## P2: Improve large-archive handling

Current synchronization builds and hashes complete archives in browser memory. Media-heavy books could cause slowdowns or browser termination on mobile devices.

### Near-term suggestions

- Expose the server archive-size limit.
- Reject oversized archives before uploading.
- Show encoding, hashing, upload, download, and decode progress.
- Support cancellation.
- Avoid rebuilding an unchanged archive when a stable local hash is available.

### Long-term suggestion

- Separate media into content-addressed objects.
- Synchronize only missing or changed blobs.
- Retain a versioned book manifest.

### Relevant areas

- `src/data/book-archive.ts`
- `src/features/sync/sync-hash.ts`
- `src/features/sync/sync-api.ts`
- `src/features/sync/sync-service.ts`
- `backend/internal/config/config.go`

---

## P2: Strengthen PWA install metadata

### Suggested improvements

- Add 192×192 and 512×512 PNG icons.
- Add a dedicated maskable icon.
- Reconcile HTML and manifest theme colors.
- Update the application title and description.
- Add application screenshots.
- Add optional application shortcuts.
- Validate installation in Chromium and through an installed-PWA smoke test.

### Relevant areas

- `public/manifest.webmanifest`
- `index.html`

---

## P2: Make the frontend deployment base configurable

The Vite base path and service-worker path are independently hardcoded to the current GitHub Pages repository path.

### Suggestion

Derive both from one build configuration and test root-hosted and subpath-hosted builds.

### Relevant areas

- `vite.config.ts`
- `public/sw.js`

---

# Section 5 — Security, privacy, and reliability

## P0: Make backend archive commits recoverable

The backend stores archive files on disk and metadata in PostgreSQL. These two systems cannot commit atomically.

A crash at the wrong point can leave:

- an archive file with no database record;
- a database record whose archive is missing;
- an ambiguous commit followed by unsafe cleanup.

### Suggestion

Introduce a recoverable object lifecycle:

1. Write archives under a temporary or pending key.
2. Record pending metadata transactionally.
3. Promote or mark the archive committed after the database commit.
4. Run reconciliation for orphaned and missing files.
5. Do not delete a final archive solely because a commit returned an ambiguous error.
6. Consider content-addressed object names.

### Relevant areas

- `backend/internal/storage/archive.go`
- `backend/internal/storage/store.go`

---

## P1: Add storage quotas, retention, and garbage collection

Every successful synchronization creates another full archive version, with no implemented retention limit.

A valid client or client bug can therefore consume storage indefinitely.

### Suggested controls

- Per-user storage quota.
- Per-book version limit.
- Maximum revision age.
- Deleted-book recovery period.
- Safe archive garbage collection.
- Free-disk monitoring and alerts.
- Upload concurrency limits.
- API rate limiting.
- Pagination and hard limits for book and version lists.

### Relevant areas

- `backend/internal/storage/store.go`
- `backend/internal/api/router.go`
- `backend/internal/config/config.go`
- `docs/SYNC_BACKEND.md`

---

## P1: Clarify manuscript encryption and privacy

Cloud archives are encrypted in transit when HTTPS is used, but they are stored as readable archive files on the server.

Provider API keys and sync credentials are also stored in browser-accessible local storage.

### Suggestion

- Clearly explain the threat model.
- Distinguish transport encryption from end-to-end encryption.
- Consider optional client-side archive encryption.
- Encrypt or tightly protect infrastructure backups.
- Provide token rotation and revocation.
- Add a strict frontend Content Security Policy.
- Minimize third-party scripts and same-origin attack surface.

### Relevant areas

- `src/data/book-archive.ts`
- `src/features/sync/sync-settings.ts`
- `index.html`
- `backend/internal/storage/archive.go`

---

## P1: Add backend readiness checks

The current health endpoint reports success without checking PostgreSQL or archive storage.

### Suggestion

Separate:

- **Liveness:** the server process is running.
- **Readiness:** the database is reachable, required migrations are present, and archive storage is accessible and writable.

### Relevant areas

- `backend/internal/api/router.go`
- `docker-compose.prod.yml`

---

## P2: Enforce token scopes

Token scopes exist in the database schema, but routes do not currently enforce read/write distinctions.

### Suggestion

Either enforce `books:read` and `books:write` at the router or handler level, or remove the misleading schema field until scopes are supported.

### Relevant areas

- `backend/migrations/000001_initial.sql`
- `backend/internal/api/auth.go`
- `backend/internal/api/router.go`
- `backend/internal/storage/store.go`

---

## P2: Support direct bearer authentication in the frontend

The backend supports bearer-token authentication, but the frontend requires Basic Auth credentials plus a separate sync token.

### Suggestion

Provide explicit authentication modes:

- direct bearer token;
- Basic-authenticated reverse proxy plus sync token.

Do not send credentials that are not required by the selected mode.

### Relevant areas

- `backend/internal/api/auth.go`
- `src/features/sync/sync-settings.ts`
- `src/features/sync/sync-api.ts`
- `src/features/sync/SyncSettingsPanel.tsx`

---

## P2: Add request cancellation and deadlines

Sync requests currently have no browser-side timeout or cancellation.

### Suggestion

Use different deadlines for:

- metadata requests;
- archive uploads;
- archive downloads.

Large transfers should expose an explicit cancel action, and operations should be aborted when their owning book or component changes.

### Relevant areas

- `src/features/sync/sync-api.ts`
- `src/features/sync/BookSyncControls.tsx`

---

## P2: Validate device identifiers

The backend stores `X-Device-ID` without a small application-level length or format limit.

### Suggestion

Require a defined format, such as a UUID, or enforce a small maximum length such as 128 bytes.

### Relevant areas

- `backend/internal/api/books.go`
- `backend/internal/storage/store.go`
- `backend/migrations/000001_initial.sql`

---

## P2: Verify archive integrity on download

The backend records archive hashes but download handling primarily verifies size.

### Suggestion

Verify the stored SHA-256 before or during archive serving, and provide an integrity signal that the client can verify against the downloaded bytes.

### Relevant areas

- `backend/internal/api/books.go`
- `backend/internal/storage/store.go`

---

## P2: Add privacy-conscious diagnostics

For a writing application, diagnostics must avoid capturing manuscript text, prompts, media, or API keys by default.

### Suggested local diagnostics

- Operation name.
- Feature name.
- Timestamp and duration.
- Sanitized error class or code.
- App, database, and service-worker versions.
- IndexedDB migration or save failures.
- Sync state transitions.
- Queue recovery counts.

Allow users to inspect and explicitly export a redacted diagnostic package.

---

## P2: Add backend metrics and operational monitoring

The backend already has structured logging and request IDs, which provide a useful foundation.

### Suggested metrics

- Requests by route and status.
- Upload and download bytes and duration.
- `412` conflict counts.
- Authentication failures.
- Storage and database errors.
- Active database-pool usage.
- Archive object and version counts.
- Free disk space.
- Missing-object and integrity errors.

---

# Section 6 — Engineering quality and maintainability

## P0: Add tests to the deployment gate

`package.json` does not expose test or complete-check scripts, and the deployment workflow builds without running the frontend or backend tests.

### Suggestion

Deployments should require:

- frontend tests;
- TypeScript checks;
- production bundle build;
- Go tests;
- `go vet`;
- backend integration tests where practical.

Add explicit scripts such as:

- `test`;
- `test:frontend`;
- `check`.

Make Pages deployment depend on the complete check job.

### Relevant areas

- `package.json`
- `.github/workflows/deploy.yml`
- `Makefile`

---

## P1: Commit a dependency lockfile

The project intentionally does not commit an npm lockfile. Exact top-level versions do not guarantee reproducible transitive dependencies.

### Suggestion

- Commit `package-lock.json`.
- Use `npm ci` in CI.
- Declare the supported Node version through `engines`, `.nvmrc`, or an equivalent mechanism.
- Consider scheduled dependency and security update automation.

### Relevant areas

- `package.json`
- `README.md`
- `.github/workflows/deploy.yml`

---

## P1: Add real-browser tests

The current tests are broad, but many inspect source text or run through custom transpilation. Those tests can fail after harmless refactors while missing actual browser behavior.

### Suggested Playwright coverage

- Create, edit, and reload a book.
- Autosave and recovery.
- Backup export and import.
- Offline reopen.
- Service-worker update.
- Mobile workspace navigation.
- Fake-provider Chat generation.
- Image queue recovery.
- Sync conflict behavior.
- Keyboard navigation.
- Automated accessibility scans.

Source-shape assertions should remain only where they enforce a deliberate architectural rule.

### Relevant areas

- `tests/`
- `tests/transpile-source-tree.mjs`

---

## P1: Add PostgreSQL-backed backend integration tests

Backend unit tests pass, but coverage is relatively low and does not deeply exercise real storage transactions.

### Suggested integration coverage

- Migrations from an empty database.
- Concurrent conditional uploads.
- ETag conflicts.
- Ownership isolation.
- Soft delete and restoration.
- Missing archive files.
- Database commit failures.
- Filesystem/database reconciliation.
- Version retrieval and pagination.
- Authentication and scope enforcement.

Run the existing backend smoke test in CI against a composed service where practical.

### Relevant areas

- `backend/internal/api/`
- `backend/internal/storage/`
- `scripts/backend-smoke-test.py`

---

## P1: Break up large orchestration components incrementally

Several files coordinate too many unrelated responsibilities:

- `src/app/Workspace.tsx`;
- `src/app/App.tsx`;
- `src/features/chat/ChatFeature.tsx`;
- `src/data/persistence.ts`.

### Suggestion

Extract focused boundaries rather than performing a wholesale rewrite:

- document autosave and lifecycle;
- active-book loading;
- generation ownership;
- sync scheduling;
- speech lifecycle;
- image queue state;
- screen-level workspace components;
- cross-cutting notification handling.

The top-level shell should primarily own navigation and application-wide coordination.

---

## P1: Separate domain and persistence layers from feature UI

`src/data/persistence.ts` imports feature-specific modules, while those features also depend on persistence. This creates bidirectional dependencies and makes migrations harder to reason about.

### Suggestion

- Move stable entity and archive contracts into dependency-free domain modules.
- Use typed Dexie tables and a typed database class.
- Split persistence into focused repositories.
- Keep cross-feature workflows in application services above repositories.
- Isolate database migrations into explicitly tested modules.
- Keep persistence unaware of React and feature UI code.

---

## P2: Add linting, formatting, and dependency-boundary checks

Strict TypeScript is already a good foundation.

### Suggested additions

- ESLint with TypeScript and React Hooks rules.
- Formatting enforcement.
- Circular-dependency detection.
- Feature-boundary rules.
- Unused-export and dead-code checks where practical.
- Bundle-size budgets.

Linting should complement, not replace, behavioral tests.

---

## P1: Reconcile documentation with the current application

`docs/PRODUCT_SPEC.md` is materially behind the implementation. It describes image generation, speech, archive versions, and automatic sync as missing or undecided even though they now exist.

Other documentation issues include:

- sync documentation references a missing `.env.example`;
- the README does not document the frontend test suite;
- snapshot retention is described as undecided despite being implemented;
- provider lists differ between documents;
- the current archive format has advanced beyond the version described in parts of the specification.

### Suggestion

Assign one document as the authoritative product boundary and update it whenever a feature’s implementation status changes.

### Relevant areas

- `README.md`
- `docs/PRODUCT_SPEC.md`
- `docs/SYNC_BACKEND.md`
- `docs/IMAGE_GENERATION.md`

---

## P2: Add and maintain `.env.example`

The synchronization deployment documentation instructs users to copy `.env.example`, but no such file is currently present at the repository root.

### Suggestion

Provide a non-secret example containing every environment variable required by the production Compose file and backend configuration. Explain which values are required, optional, or security-sensitive.

### Relevant areas

- `docs/SYNC_BACKEND.md`
- `docker-compose.prod.yml`
- `backend/internal/config/config.go`

---

# Section 7 — Suggested roadmap

## Milestone 1: Reliability baseline

1. Reconcile the 29 failing frontend tests.
2. Add complete CI release gates.
3. Commit a dependency lockfile and switch CI to reproducible installs.
4. Prevent sync from overwriting mid-flight edits.
5. Serialize synchronization across tabs and entry points.
6. Make chat regeneration non-destructive.
7. Fix delayed settings persistence and sync-setting validation.
8. Address backend filesystem/database consistency.
9. Add sync quotas, retention, and garbage collection.

## Milestone 2: User trust and recovery

1. Expose document history and restoration.
2. Improve sync history and conflict presentation.
3. Standardize accessible dialogs and rich selectors.
4. Add publishing-oriented manuscript export.
5. Improve long-running operation progress and cancellation.
6. Make data-safety status visible.
7. Make offline behavior deterministic.
8. Add browser-level critical-flow and accessibility tests.

## Milestone 3: Product depth

1. Add alternative AI responses and chat branches.
2. Add unified book search.
3. Add revision and editorial workflows.
4. Add AI and media usage analytics.
5. Add writing goals and progress analytics.
6. Add dedicated Note generation.
7. Add Titles and names generation UI.
8. Add storage-management and device-management surfaces.

## Milestone 4: Performance and maintainability

1. Code-split major workspaces.
2. Reduce font and initial bundle weight.
3. Replace permanent background polling with event-driven scheduling.
4. Improve large-archive processing.
5. Refactor large orchestration components incrementally.
6. Separate domain, persistence, and feature layers.
7. Add PostgreSQL-backed integration tests.
8. Add privacy-conscious diagnostics and backend metrics.
9. Reconcile all product and deployment documentation.

---

# Review validation notes

The following checks informed this review:

- `npm run build` completed successfully.
- The production build emitted a large-bundle warning.
- The frontend test suite reported 470 passing and 29 failing tests.
- `go test ./...` completed successfully in `backend/`.
- `go vet ./...` completed successfully in `backend/`.

Some frontend test failures appear to be stale source-shape assertions. They should be reconciled before being treated either as confirmed application bugs or as safe-to-ignore test failures.
