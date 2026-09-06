from pathlib import Path

path = Path('src/tts-service.ts')
text = path.read_text()
old = """  let models: SpeechModel[] = []
  try { models = await fetchSpeechModels(settings.apiKey, controller.signal) } catch { /* generation can still use saved model */ }
  const modelInfo = models.find((model) => model.id === settings.model)
"""
new = """  let models: SpeechModel[] = []
  try {
    models = await fetchSpeechModels(settings.apiKey, controller.signal)
  } catch (error) {
    if (controller.signal.aborted || currentSession !== sessionId) return
    // A catalog failure is recoverable because generation can still use the saved model.
  }
  if (controller.signal.aborted || currentSession !== sessionId) return
  const modelInfo = models.find((model) => model.id === settings.model)
"""
if old not in text:
    raise SystemExit('issue101 target block not found')
path.write_text(text.replace(old, new, 1))
