# Canonical World archive and sync contract (v1)

## Scope and compatibility

`arc-world`, version `1`, is a canonical owner archive. All World/entity/history/dependency/media IDs are preserved. There is exactly one World root, or a terminal World deletion tombstone. No Book, series, outline, scene or manuscript entity is permitted. The existing `arc-book` contract and its detached World-to-Book snapshots are unchanged.

The binary envelope remains `ARCBK001` + big-endian manifest byte length + JSON manifest + media blobs, because the deployed archive provider checks this envelope and stores opaque archives. **The manifest format, not the transport magic, distinguishes Book and World.** Book decoding rejects World manifests. World decoding rejects Book manifests. Binary media is not base64 encoded. Maximum manifest: 64 MiB; maximum archive: 2 GB.

World owners use the existing authenticated provider `/api/v1/books` storage API with `clientBookId = "arc-world:" + worldId`. This is a transport owner namespace, not a local Book or a Book snapshot. World state explicitly records `ownerType: 'world'`. Book cloud listings exclude these owners; `listCloudWorlds()` lists only these owners. The server needs no new endpoint or archive-format validator. Credentials, Basic Auth, `X-Sync-Token`, `If-Match`, device IDs and global endpoint settings reuse the existing provider infrastructure.

## Captured data

- World metadata, lore-type definitions and owner settings.
- All owned Codex entries, including draft/archived entries, summaries, Notes, Chat sessions and saved messages/context/proposals.
- Document history/snapshots, canonical Codex dependency edges, illustrations.
- Kept owner gallery assets and assets referenced by document/checkpoint/history blocks; completed kept image jobs associated with exported assets.
- Stable IDs and document block/media links.
- Linked Book IDs plus unresolved pending Book IDs; never their contents.

Provider secrets, connection fingerprints, active provider tickets, execution leases/heartbeats and inline generation-source payloads are not portable. In-progress image jobs are not resumed by import. The local illustration undo buffer and local sync/control records are not archive content.

Metadata/object keys and resource rows are serialized deterministically. Import receipts account for database normalization (for example Codex defaults and World Chat context filtering), making a repeated unchanged archive idempotent rather than a duplicate or spurious conflict.

## Import, links and atomicity

Decoding validates owner/parent closure, unique stable IDs, dependencies restricted to World entries, summaries, history/media links and image file signatures. A single IndexedDB write transaction covers all archive tables and the existing `meta` table. Foreign table-ID collisions abort without overwriting the other owner. The World root is inserted before canonical children. An authorized replacement affects only this owner's rows. Local Book manuscripts/resources are never imported or deleted.

Available unlinked Books can resolve imported references through existing World linking primitives. Books already attached to a different World remain pending; sync never silently moves them. Missing IDs remain pending and create no phantom Books. `resolvePendingWorldBookReferences(worldId)` must be called after a Book becomes available (for example after Book import). Its return value is the still-pending ID list. Resolved links use the existing linking/type-materialization behavior. Explicit incoming archive replacement can detach links absent from the selected version, preserving Book-local content.

## Conflict policy

There is no timestamp-wins or automatic overwrite policy. A different existing canonical version without a matching known baseline is a conflict. For sync, a remote change can be pulled only when the local canonical content still matches the acknowledged baseline. Simultaneous divergence, first connection to an existing different cloud owner and conditional-upload races preserve complete local/incoming binary archives in durable `meta` records.

The conflict API exposes both versions, hashes, reason, remote ETag and resolution history. Resolution requires an explicit `local` or `incoming` choice and verifies that the local content has not changed since capture. Cloud local-choice writes also require the captured remote ETag and read back the uploaded target. Stale conflicts cannot authorize writes. Retry after a later local/cloud edit captures a fresh conflict; superseded copies remain accessible using `includeResolved = true` or their exact IDs. Successfully resolved copies are retained as recovery data.

Network/storage failures throw, record sync error/offline state where a connection exists, and retain local content. A successful upload is acknowledged only after downloading the exact target and comparing both revision and canonical archive hash. New local edits during the network call remain dirty relative to the sent baseline.

## Deletion/tombstones

Use **`deleteWorldWithTombstone(worldId)`**, not the old World deletion entrypoint, from every World workspace deletion action. It performs empty-only deletion and durable tombstone creation in the same transaction. Codex (including archived), Notes, saved Chat and summaries block deletion. Existing safe unlink/type-materialization behavior preserves Books and their local data.

A tombstone is a canonical archive with only `worldId` and `{ worldId, deletedAt }`, with all resource/link arrays empty. It syncs through the same conditional state upload, rather than removing the remote owner. A locally tombstoned identity cannot be recreated by import, pull or incoming conflict resolution. A live archive arriving for that ID becomes a preserved conflict; choose local to keep deletion. Recovery under a new identity is intentionally not implemented. An incoming tombstone encountering local content is a conflict and cannot bypass the empty-only protection.

Tombstones and conflict copies survive sync disconnection. Plain direct calls to `world-service.deleteWorld` cannot write sync metadata atomically; integration must use the wrapper above. This is an explicit UI/data-owner wiring requirement, not an implicit hook on unrelated persistence functions.

## Exact application exports

From `src/features/sync/sync-service.ts` (also directly from `world-sync-service.ts`):

```ts
enableWorldSync(worldId: string, beforeSync?: () => Promise<void>): Promise<WorldSyncResult>
syncWorldNow(worldId: string, beforeSync?: () => Promise<void>): Promise<WorldSyncResult>
getWorldSyncState(worldId: string): Promise<WorldSyncState | undefined>
listWorldSyncStates(): Promise<WorldSyncState[]>
listCloudWorlds(): Promise<RemoteBook[]>
importCloudWorld(remote: RemoteBook): Promise<WorldSyncResult & { worldId: string }>
resolveWorldSyncConflict(worldId: string, conflictId: string,
  choice: 'local' | 'incoming', beforeSync?: () => Promise<void>): Promise<WorldSyncResult>
disconnectWorldSync(worldId: string): Promise<void>
listWorldArchiveConflicts(worldId: string, includeResolved?: boolean): Promise<WorldArchiveConflict[]>
getWorldArchiveConflict(conflictId: string): Promise<WorldArchiveConflict | undefined>
WORLD_SYNC_CHANGED // 'arc-world-sync-changed'; CustomEvent.detail.worldId
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

## Integration and validation remaining

UI files and `persistence.ts`/`world-service.ts` are owned by other agents and were not edited here. UI must wire the save barrier, status/retry, explicit conflict choices, preserved-version downloads, deletion wrapper, and World archive file import/export. Book-availability flows must invoke pending-reference resolution. Optional automatic World sync scheduling is not installed; the callable APIs perform actual authenticated network sync.

`tests/world-sync.test.mjs` uses the mandatory resource-policy header and real fake-indexeddb transactions for archives/conflicts/tombstones; only network transport is faked. The supported command `npm test -- tests/world-sync.test.mjs` was attempted and exited **2** before running assertions: `Tests require Linux systemd/cgroup v2 memory isolation. No unrestricted fallback. See README.md.` No isolation bypass, direct test execution, commit or push was made. Parent must coordinate guarded CI RED/GREEN; the added regression is syntax-checked, not behaviorally verified.

### Audit blockers (implementation is not yet complete)

1. **Superseded local cloud choices can write before rejection.** `resolveWorldSyncConflict` checks `resolution` but not `supersededAt` before the PUT. Archive resolution later rejects superseded conflicts, after the remote archive has already been replaced. The added behavioral regression `superseded cloud conflict cannot authorize a conditional upload` uses real durable conflict records and a coherent revisioned transport; it asserts zero PUTs. Add the superseded check before networking only after guarded CI confirms RED. Also review conflicts superseded during metadata/download awaits, not just at initial lookup.
2. **Archive replacement can lose inherited Book type metadata during detach.** `apply` overwrites the World root and children before `setBookWorld(book.id, '')` materializes inherited types. If the selected version removed a custom World type, Book-local templates referencing that type can lose its definition. Detach omitted Books against the old World registry before replacing its rows, within the same transaction; add a behavioral regression first.
3. **Retained Book links can retain dangling dependency edges.** Replacement deletes old World entries but prunes Book dependency edges only for Books detached by `setBookWorld`. Books that remain linked need unavailable source/target edges pruned atomically after replacement. Do not delete Book manuscripts or their still-valid edges.
4. **Status notifications currently masquerade as content changes.** World sync state `save`/disconnect calls `notifyWorldArchive`, which emits `arc-worlds-changed` and `arc-entity-changed` as well as sync status. Wiring automatic World upload to content events can continually reschedule itself from acknowledgements. Separate sync-state notification from content invalidation before enabling that scheduling.
5. **World workspace hook/check contract is missing.** `WorkspaceSyncStatus.tsx` exports only `useWorkspaceSyncStatus(bookId)`, backed by Book tables; there is no World status hook or `checkRemoteWorld` export yet. Add World-aware subscription/hook and read-only remote-check exports with owner-scoped events, cleanup, stale-read protection, and observable failures. Do not route World IDs through the Book hook/service.

### Parent/UI wiring (outside this agent's edit scope)

- Current `Workspace.tsx` status hook and focus/online check are Book-only. Wire the future World status hook/check by `currentBook.type`; preserve existing Book behavior.
- `scheduleAutomaticSync` still invokes `syncBookNow` for the current owner ID regardless of owner type. Either explicitly skip Worlds until the World scheduler is ready or route Worlds to `syncWorldNow(worldId, prepareBookExport)` (the existing save barrier flushes the active document despite its name). Refresh the canonical World, not `importedBook`, after a pull/tombstone.
- Wire enable/sync/retry, explicit choices, preserved-version downloads, cloud World import, and World archive import/export through the existing exported service/archive APIs. Pass a successful-save barrier before any overwrite-capable operation; `importCloudWorld` currently has no barrier argument, so flush in the caller before invoking it.
- Use `deleteWorldWithTombstone` for every World deletion action, including World-management/library screens. Never disconnect/drop the state before uploading a deletion tombstone. Invoke `resolvePendingWorldBookReferences` when a matching real Book becomes available.

No production fixes or new hook exports were added in this audit pass: the mandatory test-first workflow is blocked at verified RED. The contract above describes the intended guarantees, not a claim that these blockers have been resolved.
