from pathlib import Path

path = Path('src/persistence.ts')
text = path.read_text()
replacements = [
("""  const now = Date.now()
  const updated: CodexEntryEntity = { ...current, archivedAt: now, updatedAt: now }""",
 """  const now = Date.now()
  const sourceRevision = typeof current.sourceRevision === 'number' ? current.sourceRevision : current.updatedAt
  const updated: CodexEntryEntity = { ...current, sourceRevision, archivedAt: now, updatedAt: now }"""),
("""  const now = Date.now()
  const { archivedAt: _archivedAt, ...active } = current
  const updated: CodexEntryEntity = { ...active, updatedAt: now }""",
 """  const now = Date.now()
  const sourceRevision = typeof current.sourceRevision === 'number' ? current.sourceRevision : current.updatedAt
  const { archivedAt: _archivedAt, ...active } = current
  const updated: CodexEntryEntity = { ...active, sourceRevision, updatedAt: now }"""),
("""  const updated: CodexEntryEntity = { ...current, preferSummaryForContext }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, Date.now())
  })""",
 """  const now = Date.now()
  const sourceRevision = typeof current.sourceRevision === 'number' ? current.sourceRevision : current.updatedAt
  const updated: CodexEntryEntity = { ...current, sourceRevision, preferSummaryForContext, updatedAt: now }
  await db.transaction('rw', db.table('entities'), async () => {
    await db.table('entities').put(updated)
    await touchAncestors(db, current.bookId, now)
  })""")
]
for old, new in replacements:
    if old not in text:
        raise SystemExit(f'Missing expected migration block: {old[:120]}')
    text = text.replace(old, new, 1)
path.write_text(text)

# Present a friendly target.type to the existing Summarize prompt without changing persisted sourceType.
summary = Path('src/summary-service.ts')
text = summary.read_text()
old = "    'target.type': targetType,"
new = "    'target.type': targetType === 'codexEntry' ? 'Codex entry' : targetType,"
if old not in text:
    raise SystemExit('Missing target.type assignment')
summary.write_text(text.replace(old, new, 1))
