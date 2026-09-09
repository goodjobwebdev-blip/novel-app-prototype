# Codex illustrations and book backups

## Scope

Each Codex entry can have one primary illustration. Images appear beside the entry title, in Codex list thumbnails, and in manuscript mention previews. Tapping the title thumbnail opens a full-screen viewer with pinch-to-zoom, panning, zoom buttons, and keyboard controls. Archived entries keep their illustrations but cannot change them until restored.

Image actions open in a bottom sheet on phones and a centered dialog on larger screens. Separate editors handle descriptions and thumbnail crops. Cropping supports drag, pinch zoom, zoom buttons, Reset, and Done. Empty entries show a compact Add image action. Uploads show Preparing image, Saving, and Saved on this device states. AI image generation, multiple-image galleries, and automatic cross-device sync remain future work. Existing text-generation behavior is unchanged.

## Storage and image processing

- Database schema v4 adds an `illustrations` table with a unique entry ID index; v5 adds a per-entry `illustrationUndo` table. Existing books, text, chats, snapshots, and dependencies are preserved.
- An illustration contains a primary image Blob, a 160 × 160 thumbnail Blob, dimensions, caption, alt text, crop position and optional zoom (1–4, default 1 for older images), timestamps, book ID, and entry ID. The Codex entry stores `primaryImageId`.
- Uploads accept PNG, JPEG, and WebP with file-signature validation, a 20 MiB input limit, and a 40-megapixel decoded-image limit. Animated inputs are flattened to a still image.
- The primary image is resized without upscaling to at most 1600 pixels on its longest edge. WebP encoding targets 500 KB using progressively lower quality; complex images or browsers falling back to PNG may exceed this target. The UI shows actual saved size.
- Only the optimized image is retained. Writers should keep original files separately for print-quality use.
- Image changes run outside the text editor and patch only the primary-image link. They do not change lore text, title, category, text history, or summary freshness.
- Uploads, metadata edits, replacement, and removal retain one previous illustration state per entry for Undo. Undo survives reopening or reloading, and is cleared by the next image change or Dismiss. It restores images and metadata without changing lore text. Undo checks a unique change token as well as the current image, so a stale window cannot undo a newer operation.
- Replacement and removal use atomic database transactions and check the expected image ID. A storage failure retains the previous image. A competing edit or an archived/deleted target is rejected.
- Permanent entry/book deletion removes associated illustration and undo records. Archiving preserves them.
- Object URLs are temporary display handles and are revoked when components change or unmount. They are never saved as permanent image references.
- Dexie is bundled with the app rather than fetched at runtime. Offline availability still depends on the existing PWA shell/assets being cached.

## Mobile interaction details

- Title thumbnails are 64 pixels; illustration actions have at least 48-pixel touch targets and form inputs use 16-pixel text.
- Sheets and the viewer use native modal focus handling, explicit close buttons, Escape dismissal, and background scroll locking. Controls respect safe-area insets.
- Sheet height follows the visual viewport as the software keyboard opens. Headers and Save/Done footers stay outside the scrolling content.
- Description drafts are saved immediately in session storage, with an in-memory fallback. Dismissing a sheet preserves the draft. Saving clears it; cropping carries an unfinished description forward to the updated image record. Replacing the picture clears the old picture's draft.
- Gestures use pointer capture, handle pointer cancellation, clamp panning to image boundaries, and keep pinch anchors stable where bounds allow. Keyboard arrows pan, plus/minus zoom, and explicit Reset controls provide alternatives to touch.
- One undo state can retain an extra optimized image per entry. Storage usage includes this extra state; Dismiss releases it. Backups contain current illustrations, not local undo history or unsaved description drafts.

## Storage controls

The Book panel includes estimated total browser-origin usage and allowance through `navigator.storage.estimate()`. This includes all books and app caches, not just images. The allowance is not a guarantee of physically available disk space.

New uploads and imports check estimated headroom with a 10 MB reserve. The storage meter warns above 85% usage. Quota errors are handled even when the browser's estimate is missing or optimistic. A user-initiated protection action requests persistent storage; browsers can decline, and clearing site data can still erase protected storage.

## Book backup format

Book settings expose **Export book backup** and **Import book backup**. Import is also available on the home book list, including an empty list.

Exports flush the active editor and current Book metadata before reading one consistent database snapshot. Stop text generation before export. The `.arcbook` file includes:

- the book and its series metadata;
- outline, scenes, notes, Codex entries, summaries, chats and messages;
- book AI/context settings, with configured API keys and authentication-token fields removed;
- local text snapshots, Codex dependency edges, optimized images, thumbnails, and image metadata.

Device-global preferences and original pre-optimization images are not included. Text written into documents is preserved verbatim; writers should not put credentials in manuscripts or prompts.

Format version 1 starts with the eight ASCII bytes `ARCBK001`, followed by an unsigned big-endian 32-bit JSON manifest byte length. The UTF-8 manifest identifies `format: "arc-book"` and `version: 1`. Each illustration records MIME types and byte lengths. Primary and thumbnail binary data follow the manifest, in illustration order. Images are not base64-encoded, avoiding expansion. This is an app-specific binary archive, not a ZIP file. The initial reader/writer caps archives at 2 GB and metadata at 64 MiB.

Import validates the format, record IDs, ownership and parent chains, image links, signatures and lengths before writing. It remaps identifiers and creates a new book with an `(imported)` suffix. Text and image links are preserved; pending chat edit proposals become stale. All imported records commit together or roll back together. Existing books are never overwritten. API keys must be configured again after import.

## Verification

Run `npm install --no-package-lock`, `npm run build`, and `node --test tests/*.test.mjs`.

`tests/illustrations.test.mjs` runs real Dexie operations with fake-indexeddb. It covers schema v3 migration, image sizing/cropping and zoom, upload validation, replacement without text loss, archive/delete behavior, book isolation, binary export/import round trips, credential exclusion, invalid archives, transaction rollback, and undo consistency.

`tests/mobile-illustrations.test.mjs` exercises React components in jsdom: pointer drag/pinch/cancel, keyboard zoom/reset, description draft recovery, removal/undo, focus return, and visual-viewport changes. These tests simulate the DOM and do not replace a real phone layout or browser image-encoding check.

Manual browser checks: upload a landscape and portrait; drag and pinch-crop both; check portrait/landscape orientation and software keyboard; enlarge and close with Escape; replace; navigate and reload; preview a Codex mention; archive/restore; export and import on another browser; inspect narrow mobile layout; try a full-storage failure. These checks require a reachable browser preview.
