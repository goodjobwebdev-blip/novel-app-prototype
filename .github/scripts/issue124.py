from pathlib import Path

path = Path('src/ChatFeature.tsx')
text = path.read_text()

anchor = "import { applyIfStillCurrent } from './async-state-guard'\n"
if anchor not in text:
    raise SystemExit('async guard import anchor missing')
text = text.replace(anchor, anchor + "import { chatHistoryPrefixMatches } from './chat-history-guard'\n", 1)

old = """    let completed = false\n    let unexpectedFailure = false\n    let activeRoundContent = ''\n"""
new = """    let completed = false\n    let unexpectedFailure = false\n    let historyInvalidated = false\n    let activeRoundContent = ''\n"""
if old not in text:
    raise SystemExit('generation state anchor missing')
text = text.replace(old, new, 1)

old = """    async function persistAssistantRound(\n      roundContent: string,\n      roundThoughts: string,\n      extras: Pick<ChatMessageEntity, 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'> = {},\n      status: ChatMessageStatus = 'complete',\n    ) {\n      const hasWorkspaceProposal = Boolean(extras.documentEdits?.length || extras.codexCreations?.length || extras.outlineActions?.length || extras.entityActions?.length)\n"""
new = """    async function ensureSourceHistoryStillCurrent() {\n      const durableHistory = await listChatMessages(activeChat.bookId, activeChat.id)\n      if (chatHistoryPrefixMatches(history, durableHistory)) return\n      historyInvalidated = true\n      controller.abort()\n      throw new Error('Chat history changed while this response was generating. The streamed reply was not saved.')\n    }\n\n    async function persistAssistantRound(\n      roundContent: string,\n      roundThoughts: string,\n      extras: Pick<ChatMessageEntity, 'documentEdits' | 'codexCreations' | 'outlineActions' | 'entityActions'> = {},\n      status: ChatMessageStatus = 'complete',\n    ) {\n      const hasWorkspaceProposal = Boolean(extras.documentEdits?.length || extras.codexCreations?.length || extras.outlineActions?.length || extras.entityActions?.length)\n      if (roundContent || roundThoughts || hasWorkspaceProposal) await ensureSourceHistoryStillCurrent()\n"""
if old not in text:
    raise SystemExit('persist round anchor missing')
text = text.replace(old, new, 1)

old = """    } catch (error) {\n      const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')\n      if (!aborted) {\n        unexpectedFailure = true\n        onToast(error instanceof Error ? error.message : 'Chat generation stopped unexpectedly.')\n      }\n    } finally {\n      const stopped = controller.signal.aborted\n      if (!activeRoundPersisted && (stopped || unexpectedFailure)) {\n"""
new = """    } catch (error) {\n      const aborted = controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')\n      if (historyInvalidated) {\n        onToast(error instanceof Error ? error.message : 'Chat history changed while this response was generating. The streamed reply was not saved.')\n      } else if (!aborted) {\n        unexpectedFailure = true\n        onToast(error instanceof Error ? error.message : 'Chat generation stopped unexpectedly.')\n      }\n    } finally {\n      const stopped = controller.signal.aborted\n      if (!historyInvalidated && !activeRoundPersisted && (stopped || unexpectedFailure)) {\n"""
if old not in text:
    raise SystemExit('catch/finally anchor missing')
text = text.replace(old, new, 1)

old = """    setGenerating(true)\n    setPhase('sending')\n    setStreamedContent('')\n"""
new = """    setGenerating(true)\n    setEditingId('')\n    setPhase('sending')\n    setStreamedContent('')\n"""
if old not in text:
    raise SystemExit('generation start anchor missing')
text = text.replace(old, new, 1)

old = """  async function deleteFrom(message: ChatMessageEntity) {\n    if (!chat || !window.confirm('Delete this message and everything after it in this chat?')) return\n"""
new = """  async function deleteFrom(message: ChatMessageEntity) {\n    if (generating) { onToast('Stop the current response before deleting Chat history.'); return }\n    if (!chat || !window.confirm('Delete this message and everything after it in this chat?')) return\n"""
if old not in text:
    raise SystemExit('delete handler anchor missing')
text = text.replace(old, new, 1)

old = """  function beginEdit(message: ChatMessageEntity) {\n    setEditingId(message.id)\n"""
new = """  function beginEdit(message: ChatMessageEntity) {\n    if (generating) { onToast('Stop the current response before editing Chat history.'); return }\n    setEditingId(message.id)\n"""
if old not in text:
    raise SystemExit('begin edit anchor missing')
text = text.replace(old, new, 1)

old = """  async function saveEdit(message: ChatMessageEntity, regenerate: boolean) {\n    if (!chat || !editingValue.trim()) return\n"""
new = """  async function saveEdit(message: ChatMessageEntity, regenerate: boolean) {\n    if (generating) { onToast('Stop the current response before saving a Chat history edit.'); return }\n    if (!chat || !editingValue.trim()) return\n"""
if old not in text:
    raise SystemExit('save edit anchor missing')
text = text.replace(old, new, 1)

text = text.replace("<button type=\"button\" onClick={() => beginEdit(message)}><Pencil aria-hidden=\"true\" /> Edit</button>", "<button type=\"button\" disabled={generating} title={generating ? 'Stop the current response before editing history' : undefined} onClick={() => beginEdit(message)}><Pencil aria-hidden=\"true\" /> Edit</button>")
text = text.replace("<button type=\"button\" onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden=\"true\" /> Delete</button>", "<button type=\"button\" disabled={generating} title={generating ? 'Stop the current response before deleting history' : undefined} onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden=\"true\" /> Delete</button>")

path.write_text(text)
