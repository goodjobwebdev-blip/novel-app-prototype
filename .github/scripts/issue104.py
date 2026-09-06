from pathlib import Path
import re

path = Path('src/ChatFeature.tsx')
text = path.read_text()

anchor = "import ExpandableTextInput from './ExpandableTextInput'\n"
if anchor not in text:
    raise SystemExit('Chat import anchor not found')
if "import { applyIfStillCurrent } from './async-state-guard'" not in text:
    text = text.replace(anchor, anchor + "import { applyIfStillCurrent } from './async-state-guard'\n", 1)

anchor = "  const followOutputRef = useRef(true)\n"
if anchor not in text:
    raise SystemExit('Chat ref anchor not found')
text = text.replace(anchor, anchor + "  const selectedChatIdRef = useRef(chatId)\n  selectedChatIdRef.current = chatId\n", 1)

replacements = {
'rld': r'''  async function reloadMessages() {
    if (!chat) return []
    const sourceChat = chat
    const next = await listChatMessages(sourceChat.bookId, sourceChat.id)
    applyIfStillCurrent(sourceChat.id, () => selectedChatIdRef.current, () => setMessages(next))
    const refreshed = await getChat(sourceChat.id)
    if (refreshed) applyIfStillCurrent(sourceChat.id, () => selectedChatIdRef.current, () => setChat(refreshed))
    return next
  }
''',
'model': r'''  async function changeModel(modelId: string) {
    if (!chat) return
    const sourceChat = chat
    const selected = models.find((model) => model.id === modelId)
    try {
      const updated = await updateChat(sourceChat.id, { model: modelId, modelContextLength: selected?.context_length })
      applyIfStillCurrent(sourceChat.id, () => selectedChatIdRef.current, () => setChat(updated))
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the chat model.')
    }
  }
''',
'limit': r'''  async function saveEffectiveContextLimit() {
    if (!chat || limitDraft === chat.effectiveContextLimit) return
    const sourceChat = chat
    const limitSnapshot = limitDraft
    const error = contextLimitInputError(limitSnapshot)
    if (error) { onToast(error); return }
    try {
      const updated = await updateChat(sourceChat.id, { effectiveContextLimit: limitSnapshot })
      applyIfStillCurrent(sourceChat.id, () => selectedChatIdRef.current, () => {
        setChat(updated)
        setLimitDraft(updated.effectiveContextLimit)
      })
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the Chat context cap.')
    }
  }
''',
'prompt': r'''  async function savePrompt() {
    if (!chat) return
    const sourceChat = chat
    const promptSnapshot = promptDraft
    try {
      const updated = await updateChat(sourceChat.id, { systemPrompt: promptSnapshot })
      applyIfStillCurrent(sourceChat.id, () => selectedChatIdRef.current, () => {
        setChat(updated)
        setPromptDraft(updated.systemPrompt)
        setPromptOpen(false)
      })
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the system prompt.')
    }
  }
''',
'thinking': r'''  async function setThinking(value: boolean) {
    if (!chat) return
    const sourceChat = chat
    applyIfStillCurrent(sourceChat.id, () => selectedChatIdRef.current, () => setChat({ ...sourceChat, thinking: value }))
    try {
      const updated = await updateChat(sourceChat.id, { thinking: value })
      applyIfStillCurrent(sourceChat.id, () => selectedChatIdRef.current, () => setChat(updated))
    } catch (error) {
      onToast(error instanceof Error ? error.message : 'Could not save the thinking setting.')
    }
  }
''',
}
patterns = {
'rld': r"  async function reloadMessages\(\) \{[\s\S]*?\n  \}\n\n(?=  async function changeModel)",
'model': r"  async function changeModel\(modelId: string\) \{[\s\S]*?\n  \}\n\n(?=  async function saveEffectiveContextLimit)",
'limit': r"  async function saveEffectiveContextLimit\(\) \{[\s\S]*?\n  \}\n\n(?=  async function savePrompt)",
'prompt': r"  async function savePrompt\(\) \{[\s\S]*?\n  \}\n\n(?=  async function setThinking)",
'thinking': r"  async function setThinking\(value: boolean\) \{[\s\S]*?\n  \}\n\n(?=  function insertMicroPlaceholder)",
}
for key, pattern in patterns.items():
    text, count = re.subn(pattern, lambda _: replacements[key] + '\n', text, count=1)
    if count != 1:
        raise SystemExit(f'Could not replace Chat block: {key}')

old = """    function commitVisibleRound(saved: ChatMessageEntity | null, hadThoughts: boolean) {
      if (saved) {
"""
new = """    function commitVisibleRound(saved: ChatMessageEntity | null, hadThoughts: boolean) {
      if (selectedChatIdRef.current !== activeChat.id) return
      if (saved) {
"""
if old not in text:
    raise SystemExit('commitVisibleRound anchor not found')
text = text.replace(old, new, 1)

old = """      const refreshed = await getChat(activeChat.id).catch(() => undefined)
      if (refreshed) setChat(refreshed)
"""
new = """      const refreshed = await getChat(activeChat.id).catch(() => undefined)
      if (refreshed) applyIfStillCurrent(activeChat.id, () => selectedChatIdRef.current, () => setChat(refreshed))
"""
if old not in text:
    raise SystemExit('generation refresh anchor not found')
text = text.replace(old, new, 1)

send_pattern = r"  async function send\(\) \{[\s\S]*?\n  \}\n\n(?=  function stop\(\))"
send_replacement = r'''  async function send() {
    if (!chat || generating || chat.id !== selectedChatIdRef.current) return
    const sourceChat = chat
    const text = draft.trim()
    if (!text) return
    setDraft('')
    try {
      const userMessage = await createChatMessage(sourceChat, 'user', text)
      const refreshedChat = await getChat(sourceChat.id) ?? sourceChat
      const history = [...messages, userMessage]
      if (selectedChatIdRef.current !== sourceChat.id) return
      setChat(refreshedChat)
      setMessages(history)
      await runAssistantGeneration(refreshedChat, history)
    } catch (error) {
      applyIfStillCurrent(sourceChat.id, () => selectedChatIdRef.current, () => setDraft(text))
      onToast(error instanceof Error ? error.message : 'Could not send the message.')
    }
  }

'''
text, count = re.subn(send_pattern, lambda _: send_replacement, text, count=1)
if count != 1:
    raise SystemExit('send block not found')

path.write_text(text)
