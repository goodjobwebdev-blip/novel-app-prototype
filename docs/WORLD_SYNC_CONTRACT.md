# Canonical World archive and sync contract (v1)

## Scope and compatibility

`arc-world`, version `1`, is a canonical owner archive. All World/entity/history/dependency/media IDs are preserved. There is exactly one World root, or a terminal World deletion tombstone. No Book, series, outline, scene or manuscript entity is permitted. The existing `arc-book` contract and its detached World-to-Book snapshots are unchanged.

The binary envelope remains `ARCBK001` + big-endian manifest byte length + JSON manifest + media blobs, because the deployed archive provider checks this envelope and stores opaque archives. **The manifest format, not the transport magic, distinguishes Book and World.** Book decoding rejects World manifests. World decoding rejects Book manifests. Binary media is not base64 encoded. Maximum manifest: 64 MiB; maximum archive: 2 GB.

World owners use the existing authenticated provider `/api/v1/books` storage API with `clientBookId = "arc-world:" + worldId`. This is a transport owner namespace, not a local Book or a Book snapshot. World state explicitly records `ownerType: 'world'`. Book cloud listings exclude these owners; `listCloudWorlds()` lists only these owners. The server needs no new endpoint or archive-format validator. Credentials, Basic Auth, `X-Sync-Token`, `If-Match`, device IDs and global endpoint settings reuse the existing provider infrastructure.

## Captured data

- World metadata, lore-type definitions and owner settings.
- Sanitized selected settings profiles and Text profile Chat/Character prompt-preset dependencies, in `settingsProfiles` and the portable selection record's `definitions`. Local `profiles-world` selections are exported with their definitions rather than device-local IDs alone. Profile/model/prompt/UI/media sanitizers and the collision-safe installer are the same as Book archives.
- All owned Codex entries, including draft/archived entries, summaries, Notes, Chat sessions and saved messages/context/proposals.
- Document history/snapshots, canonical Codex dependency edges, illustrations.
- Kept owner gallery assets and assets referenced by document/checkpoint/history blocks; completed kept image jobs associated with exported assets.
- Stable IDs and document block/media links.
- Linked Book IDs plus unresolved pending Book IDs; never their contents.

Provider secrets, connection fingerprints, active provider tickets, execution leases/heartbeats and inline generation-source payloads are not portable. In-progress image jobs are not resumed by import. The local illustration undo buffer and local sync/control records are not archive content.

Metadata/object keys and resource rows are serialized deterministically. Import receipts account for database normalization (for example Codex defaults and World Chat context filtering), making a repeated unchanged archive idempotent rather than a duplicate or spurious conflict.

Profile definitions are sorted by stable ID before hashing. Import preserves free/equal profile IDs, reuses equal prior collision clones and remaps selected IDs and Text preset references without overwriting shared local profiles. A receipt binds the incoming hash to the post-remap local hash, so retrying the same remote archive does not create profiles or a false conflict. As with Book profile import, the profile library is localStorage-backed: archive owner rows commit atomically in IndexedDB, but a later IndexedDB failure can leave unused installed profiles; this is not cross-storage rollback.

## Import, links and atomicity

Decoding validates owner/parent closure, unique stable IDs, dependencies restricted to World entries, summaries, history/media links and image file signatures. A single IndexedDB write transaction covers all archive tables and the existing `meta` table. Foreign table-ID collisions abort without overwriting the other owner. The World root is inserted before canonical children. An authorized replacement affects only this owner's rows. Local Book manuscripts/resources are never imported or deleted.

Available unlinked Books can resolve imported references through existing World linking primitives. Books already attached to a different World remain pending; sync never silently moves them. Missing IDs remain pending and create no phantom Books. `resolvePendingWorldBookReferences(worldId)` must be called after a Book becomes available (for example after Book import). Its return value is the still-pending ID list. Resolved links use the existing linking/type-materialization behavior. Explicit incoming archive replacement can detach links absent from the selected version, preserving Book-local content.

## Conflict policy

There is no timestamp-wins or automatic overwrite policy. A different existing canonical version without a matching known baseline is a conflict. For sync, a remote change can be pulled only when the local canonical content still matches the acknowledged baseline. Simultaneous divergence, first connection to an existing different cloud owner and conditional-upload races preserve complete local/incoming binary archives in durable `meta` records.

The conflict API exposes both versions, hashes, reason, remote ETag and resolution history. Resolution requires an explicit `local` or `incoming` choice and verifies that the local content has not changed since capture. Cloud local-choice writes also require the captured remote ETag and read back the uploaded target. Stale conflicts cannot authorize writes. Retry after a later local/cloud edit captures a fresh conflict; superseded copies remain accessible using `includeResolved = true` or their exact IDs. Successfully resolved copies are retained as recovery data.

Network/storage failures throw, record sync error/offline state where a connection exists, and retain local content. A successful upload is acknowledged only after downloading the exact target and comparing both revision and canonical archive hash. New local edits during the network call remain dirty relative to the sent baseline.

## Deletion/tombstones

Use **`deleteWorldWithTombstone(worldId)`**, not the old World deletion entrypoint, from every World workspace deletion action. It performs empty-only deletion and durable tombstone creation in the same transaction. Codex (including archived), Notes, saved Chat and summaries block deletion. Existing safe unlink/type-materialization behavior preserves Books and their local data.

After committing and notifying deletion, the wrapper attempts `syncWorldNow` when a durable connection exists, independently of mounted owner UI and `automaticUpload`. It awaits that attempt; network/configuration failure retains error/offline connection state but does not undo or reject the successful local deletion. An unconnected deletion does not create a cloud owner. Retry is explicit from the World library, not an automatic incoming-version choice.

A tombstone is a canonical archive with only `worldId` and `{ worldId, deletedAt }`, with all resource/link arrays empty. It syncs through the same conditional state upload, rather than removing the remote owner. A locally tombstoned identity cannot be recreated by import, pull or incoming conflict resolution. A live archive arriving for that ID becomes a preserved conflict; choose local to keep deletion. Recovery under a new identity is intentionally not implemented. An incoming tombstone encountering local content is a conflict and cannot bypass the empty-only protection.

Tombstones and conflict copies survive sync disconnection. Plain direct calls to `world-service.deleteWorld` cannot write sync metadata atomically; integration must use the wrapper above. This is an explicit UI/data-owner wiring requirement, not an implicit hook on unrelated persistence functions.

## Exact application exports

From `src/features/sync/sync-service.ts` (also directly from `world-sync-service.ts`):

```ts
enableWorldSync(worldId: string, beforeSync?: () => Promise<void>): Promise<WorldSyncResult>
syncWorldNow(worldId: string, beforeSync?: () => Promise<void>): Promise<WorldSyncResult>
checkRemoteWorld(worldId: string): Promise<void>
getWorldSyncState(worldId: string): Promise<WorldSyncState | undefined>
listWorldSyncStates(): Promise<WorldSyncState[]>
listDeletedWorldSyncStates(): Promise<WorldSyncState[]>
listCloudWorlds(): Promise<RemoteBook[]>
importCloudWorld(remote: RemoteBook): Promise<WorldSyncResult & { worldId: string }>
resolveWorldSyncConflict(worldId: string, conflictId: string,
  choice: 'local' | 'incoming', beforeSync?: () => Promise<void>): Promise<WorldSyncResult>
disconnectWorldSync(worldId: string): Promise<void>
listWorldArchiveConflicts(worldId: string, includeResolved?: boolean): Promise<WorldArchiveConflict[]>
getWorldArchiveConflict(conflictId: string): Promise<WorldArchiveConflict | undefined>
WORLD_SYNC_CHANGED // 'arc-world-sync-status-changed'; CustomEvent.detail.worldId
```

`WorldSyncResult.kind` is `uploaded | pulled | unchanged | conflict`; conflict results include `conflictId`. `WorldSyncState` contains status/message, endpoint, remoteWorldId, remoteETag, localContentHash, timestamps and optional conflictId. Pass the UI's successful-save barrier as `beforeSync`; save failure prevents networking. No title argument is required: enable reads canonical metadata.

From `src/data/world-archive.ts`:

```ts
readWorldArchive(worldId: string): Promise<WorldArchiveData>
encodeWorldArchive(data: WorldArchiveData): Blob
decodeWorldArchive(file: Blob): Promise<WorldArchiveData>
validateWorldArchive(data: WorldArchiveData): void
exportWorldArchiveBlob(worldId: string): Promise<Blob>
importWorldArchiveBlob(file: Blob, options?: {
  expectedLocalHash?: string; preserveConflict?: boolean; remoteETag?: string
}): Promise<WorldImportResult>
resolveWorldArchiveConflict(conflictId: string, choice: 'local' | 'incoming'): Promise<WorldImportResult>
deleteWorldWithTombstone(worldId: string): Promise<void>
resolvePendingWorldBookReferences(worldId: string): Promise<string[]>
```

Use the **sync** resolution API for cloud conflicts, not the archive-only resolution API, so remote conditional writes and acknowledgement are coordinated. The archive-only API resolves imported-file conflicts. `expectedLocalHash` is an optimistic replacement baseline, never a force-overwrite option; a mismatch preserves a conflict. The archive API returns `imported | unchanged | deleted | conflict` and the exact transaction's `localContentHash` after application.

## UI and notification integration

`WorldSyncPanel` (default and named export from `src/features/sync/WorldSyncPanel.tsx`) accepts `{ worldId: string, beforeSync: () => Promise<void>, onRemoteApplied: () => Promise<void> }`. It provides enable/manual sync, retry, disconnect, archive import/export, explicit local/incoming conflict choices, and downloads of current/historical preserved archives. Cloud conflicts use cloud-aware resolution; file conflicts use archive-only resolution. Incoming application calls the owner refresh callback. A different archive identity is rejected in the active-owner panel.

`CloudWorldImport` (default and named export from `src/features/sync/CloudWorldImport.tsx`) is reusable in the World library, with `{ onImported: (worldId: string) => Promise<void>, beforeImport?: () => Promise<void> }`. It lists authenticated cloud Worlds, imports/connects them, and imports local World archive files. The callback must refresh/open the canonical World and expose its conflict panel if an import preserved a conflict. Parent/UI agent must mount this component in the World library; this agent does not edit those screens.

`DeletedWorldSync` (default and named export from `src/features/sync/DeletedWorldSync.tsx`) must be mounted alongside the library importer. Props: `{ onRemoteApplied?: (worldId: string) => Promise<void> }`; `<DeletedWorldSync />` also works. The optional callback refreshes library data, never opens/recreates a deleted owner. The list joins durable sync states with local tombstones, shows status/error/retry, conflict choices and preserved downloads through `WorldSyncPanel`, and requires no deleted workspace/save barrier. Disconnect removes the list entry, not its tombstone or preserved conflict data. Sync actions continue if the library unmounts; no implicit sync runs on mount.

`useWorkspaceSyncStatus(ownerId, ownerType: 'book' | 'world' = 'book')` retains Book behavior and reads World state separately. Subscriptions are owner-scoped, clean up on owner changes/unmount, and reject stale refresh results. `checkRemoteWorld` is a metadata-only check (no download/upload/apply), records error/offline status, and throws failures to its caller.

`WORLD_SYNC_CHANGED` is now **`arc-world-sync-status-changed`**, separate from `WORLD_ARCHIVE_CHANGED` (`arc-world-sync-changed`). Sync acknowledgement/check/disconnect do not emit entity or library content invalidations. Automatic upload must listen to actual content changes, not status events. Owner routing and successful-save barriers remain required in Workspace scheduling.

Replacement detaches omitted Books against the old registry before replacing canonical rows, within the archive transaction. Retained Books have unavailable dependency edges pruned after replacement; valid edges and private manuscripts/templates remain intact. Conflict resolution checks durable supersession and local hashes initially and again after metadata/export awaits before any PUT. Both preserved blobs survive incoming resolution.

## Verified evidence and remaining validation

Guarded CI **38165829587**, test commit **4ba07ad**, ran the behavioral superseded-conflict regression and failed with **one PUT instead of zero**, proving the production defect before the fix. Log: `/opt/data/cache/terminal-output/out-1791746040-167-8050.log`, lines 3226–3242. The same run's purported incoming-content failure occurred at test line 55, before resolution: deterministic archive sorting made `entities[1]` refer to a Chat, not the Codex entry. Tests now select archive rows by stable identity and assert durable applied content, Notes, saved messages, snapshots, and both preserved versions after resolution; the earlier failure was not evidence of data loss.

Additional behavioral regressions cover supersession during metadata I/O, detach type preservation, retained dependency cleanup, and metadata-check/disconnect event isolation. They retain the mandatory resource-policy guard and use real fake-indexeddb transactions; only network transport is mocked. Parent must run these in guarded CI (no local resource-policy bypass). `npm run build`, test syntax checks, and `git diff --check` succeeded locally after production/UI changes. **GREEN behavioral CI is not yet claimed.** No commit or push was made by this agent.

Outside this edit scope, parent/UI integration must mount the library importer, route World focus/online checks and automatic sync correctly, use `deleteWorldWithTombstone` for every World deletion, and resolve pending references when a real Book becomes available. No force-overwrite or automatic conflict-choice control is exposed.

Follow-up regressions in `tests/world-sync.test.mjs` cover portable local selections, sanitized custom profiles/presets, shared-profile collision isolation, deterministic profile hashing/import receipts, and connected deletion failure/retry with no owner UI. `tests/world-sync-ui.test.mjs` covers the deleted-owner retry/error controls and an in-flight retry surviving library unmount. The local supported test runner fails closed because this environment has no systemd/cgroup isolation; these new tests require parent guarded CI. No resource guard was bypassed and no new behavioral GREEN result is claimed. The follow-up `npm run build` completed successfully (Vite emitted mixed static/dynamic import and bundle-size warnings).
