from pathlib import Path
p = Path('src/codex-dependency-cascade.ts')
text = p.read_text()
text = text.replace("import { isCodexEntryArchived, type CodexDependencyEdge, type CodexEntryEntity } from './persistence'", "import type { CodexDependencyEdge, CodexEntryEntity } from './persistence'", 1)
text = text.replace("function edgeOrder(a: CodexDependencyEdge, b: CodexDependencyEdge) {", "function codexEntryArchived(entry: CodexEntryEntity) {\n  return typeof entry.archivedAt === 'number' && entry.archivedAt > 0\n}\n\nfunction edgeOrder(a: CodexDependencyEdge, b: CodexDependencyEdge) {", 1)
text = text.replace(".filter((entry) => !isCodexEntryArchived(entry) && entry.id !== excludeEntryId)", ".filter((entry) => !codexEntryArchived(entry) && entry.id !== excludeEntryId)", 1)
p.write_text(text)
