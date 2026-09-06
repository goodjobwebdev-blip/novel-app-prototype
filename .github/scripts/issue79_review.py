from pathlib import Path

def replace(path, old, new):
    p=Path(path); text=p.read_text()
    if old not in text: raise SystemExit(f'Missing block {old[:100]!r} in {path}')
    p.write_text(text.replace(old,new,1))

replace('src/tts-service.ts',
"export type TtsStatus = 'idle' | 'preparing' | 'generating' | 'playing' | 'paused' | 'waiting' | 'stopping' | 'complete' | 'failed'",
"export type TtsStatus = 'idle' | 'preparing' | 'generating' | 'playing' | 'paused' | 'waiting' | 'stopping' | 'stopped' | 'complete' | 'failed'")
replace('src/tts-service.ts',
"export function getTtsState() { return state }\nexport function subscribeTtsState",
"export function getTtsState() { return state }\nexport function dismissTtsState() {\n  if (activeController || activeAudio) return\n  emit({ status: 'idle', label: '', chunkIndex: 0, chunkCount: 0 })\n}\nexport function subscribeTtsState")
replace('src/tts-service.ts',
"  cleanupObjectUrls()\n  emit({ status: 'idle', label: '', chunkIndex: 0, chunkCount: 0 })\n}",
"  cleanupObjectUrls()\n  emit({ ...state, status: 'stopped' })\n}")
replace('src/Workspace.tsx',
"import { estimateSpeechRequest, fetchSpeechModels, getTtsState, pauseTtsSession, resumeTtsSession, startTtsSession, stopTtsSession, subscribeTtsState, type TtsState } from './tts-service'",
"import { dismissTtsState, estimateSpeechRequest, fetchSpeechModels, getTtsState, pauseTtsSession, resumeTtsSession, startTtsSession, stopTtsSession, subscribeTtsState, type TtsState } from './tts-service'")
replace('src/Workspace.tsx',
"            : tts.status === 'stopping' ? 'Stopping'\n              : tts.status === 'complete' ? 'Complete'",
"            : tts.status === 'stopping' ? 'Stopping'\n              : tts.status === 'stopped' ? 'Stopped'\n                : tts.status === 'complete' ? 'Complete'")
replace('src/Workspace.tsx',
"{!['complete','failed'].includes(tts.status) && <button type=\"button\" onClick={stopTtsSession} aria-label=\"Stop audio\"><Square aria-hidden=\"true\" /></button>}</div></section>",
"{!['complete','failed','stopped'].includes(tts.status) && <button type=\"button\" onClick={stopTtsSession} aria-label=\"Stop audio\"><Square aria-hidden=\"true\" /></button>}{['complete','failed','stopped'].includes(tts.status) && <button type=\"button\" onClick={dismissTtsState} aria-label=\"Dismiss audio status\"><X aria-hidden=\"true\" /></button>}</div></section>")
