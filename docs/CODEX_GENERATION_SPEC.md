# Codex Generation and Context Management Specification

Status: Approved and implemented on `main`  
Original decision date: 2026-09-05  
Implementation status reconciled: 2026-09-06

## Purpose

Add AI generation to the Codex editor while preserving the interaction model of Scene generation. Context configuration is book-scoped and generation-type-specific, with automatic context kept separate from explicitly selected additional context.

The current implementation also exposes a rendered request preview in Context Management for Story, Codex, and Chat. Chat now uses its persisted per-chat context profile. A Note profile is persisted, but dedicated Note generation is not implemented yet.

## Codex generation

1. Codex uses the same generation drawer component, styling, and controls as Scene generation.
2. The drawer context picker is removed from both Scene and Codex generation.
3. The drawer input retains the same appearance but has type-specific meaning:
   - Scene: instructions for continuing the story.
   - Codex: instructions for creating or revising the lore entry.
4. Codex generation replaces only the entry's Markdown body.
5. The entry title and category never change during generation.
6. Generated text streams directly into the editor.
7. Generate and Regenerate do not show confirmation dialogs.
8. One completed generation is one undoable editor-history operation.
9. Undo restores the complete pre-generation body. Redo restores the generated body.
10. Stop or failure restores the complete pre-generation body and does not save partial output.

## AI settings

1. Add an optional **Codex model** control.
2. When Codex model is empty, Codex generation uses the existing Main model.
3. Add a **Lore entries** system-prompt tab alongside the other prompt tabs.
4. The Lore entries prompt has an editable default.
5. Lore prompts support:
   - `{{entry.title}}`
   - `{{entry.category}}`
   - `{{entry.content}}`
   - `{{scene.text}}`
   - Existing `{{book.*}}` variables
   - `{{additional_context}}`

## Context profiles

1. Context configuration is persisted per book and generation type.
2. Profiles exist for Scene, Codex, Note, and Chat. Chat uses a persisted per-chat copy of its profile; Note keeps its profile for the future dedicated Note-generation flow.
3. Context Management displays the profile matching the document/generation type currently active in the main workspace.
4. Switching between Scene and Codex restores each type's independent context configuration.
5. Codex's current Scene is the last Scene opened in that book.
6. If a book has no Scene, the Codex current-Scene value is empty.
7. Every profile has two distinct sections:
   - Automatic context
   - Additional context
8. Automatic context is supplied through dedicated prompt variables and is never serialized into `{{additional_context}}`.

## Automatic Scene context

1. Include book metadata.
2. Include the complete current Scene.
3. When the current Scene is empty, include the complete immediately previous Scene.
4. Include summaries of earlier material using hierarchical compression.
5. An Act summary replaces its covered Chapter and Scene summaries only when the entire Act occurs before the current Scene.
6. A Chapter summary replaces its covered Scene summaries only when the entire Chapter occurs before the current Scene.
7. Otherwise, use available summaries of earlier Scenes.
8. Parent summaries must never expose later material from the current Act or Chapter.

## Automatic Codex context

1. Include book metadata.
2. Include the entry title, category, and existing body.
3. Include the last-opened Scene by default.
4. The user can disable the last-opened Scene in the Codex context profile.
5. If no Scene exists, its prompt value is empty.

## Additional context

Users can explicitly select:

- Notes
- Other Codex entries
- Full Scenes
- Full Chapters
- Full Acts
- A summary range

Full structural context expands as follows:

- A Scene includes that Scene's full text.
- A Chapter includes the full text of all descendant Scenes in outline order.
- An Act includes the full text of all descendant Scenes in outline order.

Summary range is a single mutually exclusive choice:

- None
- All summaries
- Summaries strictly before the current Scene
- Summaries strictly after the current Scene

Additional summary ranges include every available Act, Chapter, and Scene summary within the selected range. They do not use the hierarchical replacement rules applied to automatic context.

Full text and its summary are different representations and may coexist intentionally. Exact duplicate representations are emitted only once. When the same representation is present in automatic and additional context, automatic placement wins.

The current Codex entry cannot select itself as additional context.

## Deterministic ordering and prompt caching

Additional context is serialized in this order:

1. Selected structural full text in book-outline order
2. Selected summaries in book-outline order
3. Notes in creation order
4. Codex entries in creation order

Unchanged configuration and unchanged source content must produce byte-for-byte identical serialized context across generations. Database retrieval order must not affect the result.

The system-prompt template controls where its variables appear. Context assembly must not rearrange template variables.

## Deduplication rules

- The same Scene full text included twice is a duplicate.
- The same summary included twice is a duplicate.
- Scene full text and that Scene's summary are not duplicates.
- Chapter full text and that Chapter's summary are not duplicates.
- A previous Scene included automatically is not repeated as additional full text.
- An automatic summary is not repeated inside additional summaries.

## Context limits

1. Estimate the complete request before generation starts.
2. Codex uses the selected Codex model's context limit, falling back to the Main model's limit.
3. If the request exceeds the model's context window:
   - Show a warning containing the estimated request size and model limit.
   - Refuse to start generation.
   - Leave the editor unchanged.
   - Do not silently omit or truncate context.
4. The user must reduce the selected context or choose a model with a larger context window before retrying.

## Request preview

The implemented Context Management screen previews the request shape before generation:

- Story shows the rendered Story system prompt, automatic/additional context, and fallback generation instruction.
- Codex shows the rendered Lore system prompt, selected context, and fallback generation instruction.
- Chat shows its per-chat system prompt, workspace instructions, selected book context, and saved message history.
- Dedicated Note request preview is deferred with dedicated Note generation.

The preview is diagnostic UI; the actual generation code remains the source of truth for the provider request.

## Acceptance criteria

- Scene and Codex display the same drawer structure and controls.
- Neither drawer contains the old context picker.
- Codex output streams into the editor and changes only the entry body.
- A successful generation can be undone and redone as one operation.
- Stop and failure restore the exact pre-generation body.
- Scene and Codex context choices remain independent within the same book.
- Reopening each editor type restores its matching context profile.
- Codex defaults to the last-opened Scene and allows it to be disabled.
- Automatic summary selection never uses a parent summary that contains the current or later Scene.
- Additional Act and Chapter selections expand to descendant Scene text in outline order.
- Summary range is mutually exclusive and respects the current-Scene boundary.
- Repeated context assembly is deterministically ordered.
- Oversized requests are rejected before any editor mutation or provider request.
