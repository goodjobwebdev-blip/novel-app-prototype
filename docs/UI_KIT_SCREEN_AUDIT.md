# UI Kit screen audit

Status: obvious migrations complete; visual review and design decisions remain  
Branch: `fix/ui-kit-screen-audit`

This document tracks the app-wide migration to the shared components in `src/shared/ui`.

## Standards

- Ordinary rectangular controls and surfaces use `--radius` (`5px`).
- Named actions use `Button`; standard fields use `Input`, `Select`, `Checkbox`, and `RadioGroup`.
- Choices that change a value within the current view use `SegmentedControl`; panel navigation uses `Tabs`. Rich checkbox/radio rows use `Choice`, while `Checkbox` stays simple.
- User-facing settings accordions use `Disclosure`, with a right-aligned chevron and shared header/body geometry.
- Utility, close, expand, send, stop, and submenu icon actions are square.
- Touch targets are at least `44px` on mobile.
- Header actions use a lightweight transparent treatment.
- Circles are reserved for radio controls, avatars, status dots, and loaders.
- Pills remain valid when the shape communicates tag, chip, or status semantics.
- Media, covers, chat bubbles, and large overlay geometry are not mechanically forced to `5px`.
- Editor typography settings affect editor prose and expandable inputs only.

## App shell and workspace

- [x] Migrate standard settings fields in `src/app/App.tsx` to shared inputs, selects, and checkboxes.
- [x] Migrate standard book metadata fields in `src/app/Workspace.tsx`.
- [x] Standardize search fields in Notes, Book Settings, and dependency pickers.
- [ ] Replace the duplicate workspace toast shell with shared `Toast` (blocked on severity/title mapping).
- [x] Make model favorites, outline actions, content-row actions, and summary actions square and touch-safe.
- [x] Normalize ordinary settings cards and grouped surfaces to `--radius`.

## Chat

- [x] Align chat composer geometry and generation settings with the shared drawer system.
- [x] Migrate proposal draft fields and actions.
- [x] Migrate brainstorm fields, choices, and actions.
- [x] Migrate character-chat setup fields and ordinary actions.
- [x] Migrate skill choices and utility actions.
- [x] Migrate predefined-message fields and actions.
- [x] Make sidebar, pagination, message, and prompt-dialog actions square and touch-safe.
- [x] Normalize proposal, brainstorm, and document-edit cards to `--radius`.
- [x] Remove stale model-picker radius overrides.

## Codex

- [x] Migrate dashboard search, filters, pagination, view-mode segmented control, and ordinary actions.
- [x] Migrate template selection and apply action.
- [x] Migrate timeline filters, checkpoint field, and ordinary actions.
- [x] Migrate lore-type fields, choices, and management actions.
- [x] Migrate series source fields, relationship choices, and management actions.
- [x] Make Codex illustration and mention utility actions square and touch-safe.
- [x] Normalize dependency, archive, summary, trigger, and mention surfaces to `--radius`.

## Images

- [x] Reuse `SearchableSelect` for model selection.
- [x] Migrate generation task segmented control, configuration fields, and source actions.
- [x] Migrate image settings fields, choices, radios, and actions.
- [ ] Reuse `Tabs` for Image Workspace and Image Panel views (shared Tabs API does not yet preserve current panel linkage and keyboard behavior).
- [x] Migrate gallery search, Codex destination, and ordinary workspace actions.
- [x] Migrate media prompt radios and ordinary actions.
- [x] Make modal, source-preview, and image-menu utility actions square and touch-safe.
- [x] Normalize ordinary image controls and card surfaces to `--radius`.
- [ ] Use shared toasts for transient success/error feedback where severity is known (mixed persistent status state needs separation first).

## Settings

- [x] Migrate prompt preset selection and actions.
- [x] Migrate appearance toggles, text fields, and ordinary actions.
- [x] Make theme utility actions square and touch-safe.
- [x] Normalize ordinary appearance controls and surfaces to `--radius`.

## Sync

- [x] Migrate connection fields, automatic-upload choice, and connection actions.
- [x] Migrate book sync, cloud import, local sync, and conflict actions.
- [x] Make password visibility and dialog close actions square and touch-safe.
- [x] Normalize ordinary sync surfaces to `--radius`.

## Speech

- [x] Migrate cache settings controls.
- [x] Make playback and speech utility actions square and touch-safe.
- [x] Normalize ordinary speech controls and surfaces to `--radius`.

## Writing tools

- [x] Migrate rewrite, sensory detail, and synonym dialog actions.
- [x] Migrate synonym replacement and scene override fields.
- [x] Make writing-dialog and auto-title close/actions square and touch-safe.
- [x] Normalize ordinary auto-title controls and surfaces to `--radius`.

## Shared context

- [x] Migrate source-picker search, selected-only choice, and clear/retry actions.
- [x] Migrate metadata-rich source rows to shared `Choice`; keep the selected-only toolbar filter on simple `Checkbox`.
- [x] Normalize context banners, budgets, and trees to `--radius`.

## Intentional exceptions

- Chat bubbles, avatars, covers, media previews, crop viewports, loaders, radio controls, range thumbs, tags, chips, and status pills retain semantic geometry.
- Rich model/provider/theme/series selectors remain bespoke until a shared rich-selection primitive is a clear fit.
- Indeterminate generation jobs do not use a determinate `ProgressBar`.
- The speech player is an interactive media region, not a toast.

## Decisions needed after obvious migrations

- [x] Large dialogs and mobile bottom sheets use the dedicated `--overlay-radius` token (`20px`).
- [x] Shared `Tabs` supports caller-controlled panel IDs and Home/End behavior; Settings and Image Workspace tabs use it.
- [x] Task/view value choices use the shared accessible `SegmentedControl`; tabs remain reserved for panel navigation.
- [x] Shared `Toast` supports an action slot for Undo and similar actions.
- [x] Shared `ProgressBar` supports compact, label-optional, and indeterminate presentation.
- [x] Keep shared `Checkbox` simple and use a separate `Choice` primitive for rich checkbox/radio rows with React content.
