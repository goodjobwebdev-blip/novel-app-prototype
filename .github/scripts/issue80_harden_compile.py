from pathlib import Path

p = Path('src/stt-service.ts')
text = p.read_text()
old = """async function startRecordedSession(session: ActiveSession) {\n  if (!session.stream) throw new Error('The microphone stream is no longer available.')\n  if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support recorded transcription.')\n  const mimeType = chooseRecorderMime()\n  const recorder = mimeType ? new MediaRecorder(session.stream, { mimeType }) : new MediaRecorder(session.stream)\n"""
new = """async function startRecordedSession(session: ActiveSession) {\n  const stream = session.stream\n  if (!stream) throw new Error('The microphone stream is no longer available.')\n  if (typeof MediaRecorder === 'undefined') throw new Error('This browser does not support recorded transcription.')\n  const mimeType = chooseRecorderMime()\n  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream)\n"""
if old not in text:
    raise SystemExit('recorded stream narrowing target not found')
text = text.replace(old, new, 1)
text = text.replace("""    session.stream.getTracks().forEach((track) => track.stop())\n    sessionState(session, 'transcribing')\n""", """    stream.getTracks().forEach((track) => track.stop())\n    sessionState(session, 'transcribing')\n""", 1)
p.write_text(text)
