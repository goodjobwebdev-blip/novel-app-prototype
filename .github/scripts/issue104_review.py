from pathlib import Path

path = Path('src/ChatFeature.tsx')
text = path.read_text()

old = """  async function runAssistantGeneration(activeChat: ChatEntity, history: ChatMessageEntity[]) {
    if (abortRef.current) return
    let settings
"""
new = """  async function runAssistantGeneration(activeChat: ChatEntity, history: ChatMessageEntity[]) {
    if (abortRef.current || selectedChatIdRef.current !== activeChat.id) return
    let settings
"""
if old not in text:
    raise SystemExit('generation start anchor not found')
text = text.replace(old, new, 1)

old = """        }, (chunk) => {
          if (chunk.thoughts) {
"""
new = """        }, (chunk) => {
          if (selectedChatIdRef.current !== activeChat.id) return
          if (chunk.thoughts) {
"""
if old not in text:
    raise SystemExit('stream callback anchor not found')
text = text.replace(old, new, 1)

old = """        }, controller.signal, () => {
          if (!controller.signal.aborted) setPhase('thinking')
        })

        if (result.toolCalls.length) {
"""
new = """        }, controller.signal, () => {
          if (!controller.signal.aborted && selectedChatIdRef.current === activeChat.id) setPhase('thinking')
        })

        if (controller.signal.aborted || selectedChatIdRef.current !== activeChat.id) break
        if (result.toolCalls.length) {
"""
if old not in text:
    raise SystemExit('stream completion anchor not found')
text = text.replace(old, new, 1)

old = """      abortRef.current = null
      setGenerating(false)
      setPhase(null)
      setElapsed(0)
      setStreamedContent('')
      setStreamedThoughts('')
      const refreshed = await getChat(activeChat.id).catch(() => undefined)
"""
new = """      if (abortRef.current === controller) abortRef.current = null
      if (selectedChatIdRef.current === activeChat.id) {
        setGenerating(false)
        setPhase(null)
        setElapsed(0)
        setStreamedContent('')
        setStreamedThoughts('')
      }
      const refreshed = await getChat(activeChat.id).catch(() => undefined)
"""
if old not in text:
    raise SystemExit('generation teardown anchor not found')
text = text.replace(old, new, 1)

path.write_text(text)
