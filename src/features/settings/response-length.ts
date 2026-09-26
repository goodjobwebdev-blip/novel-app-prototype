export type ResponseLengthSettings = {
  story: string
  codex: string
  summary: string
}

export const EMPTY_RESPONSE_LENGTHS: ResponseLengthSettings = { story: '', codex: '', summary: '' }

export const STORY_RESPONSE_LENGTH_PRESETS = [
  { label: 'One paragraph', value: 'Write approximately one substantial paragraph, stopping at a natural beat rather than completing the whole scene.' },
  { label: '2–3 paragraphs', value: 'Write 2–3 substantial paragraphs, developing the current beat and stopping at a natural transition.' },
  { label: 'Half scene', value: 'Write roughly half of a typical scene continuation. Develop the current situation substantially, but do not rush to a full resolution.' },
  { label: 'Finish scene', value: 'Continue with a full scene-sized passage and bring the current scene to a natural ending when the existing momentum supports it.' },
  { label: '≤300 words', value: 'Keep the response concise and do not exceed 300 words.' },
] as const

export const CODEX_RESPONSE_LENGTH_PRESETS = [
  { label: 'Brief', value: 'Write one focused paragraph or a similarly compact addition appropriate to the requested lore.' },
  { label: 'Standard', value: 'Write several focused paragraphs, enough to develop the requested Codex material without padding.' },
  { label: 'Detailed', value: 'Develop the requested Codex material comprehensively while remaining relevant and avoiding filler.' },
] as const

export const SUMMARY_RESPONSE_LENGTH_PRESETS = [
  { label: 'Compact', value: 'Retain only the most important established facts and unresolved threads.' },
  { label: 'Standard', value: 'Preserve the important events, decisions, relationships, causal links, and unresolved information useful later.' },
  { label: 'Detailed', value: 'Retain substantial concrete detail that may matter for future continuity while remaining a summary rather than a rewrite.' },
] as const

/** Normalize the v1 Story/Codex/Summary contract without sharing mutable objects between defaults and Books. */
export function normalizeResponseLengths(value: unknown, legacySharedValue?: unknown): ResponseLengthSettings {
  const input = value && typeof value === 'object' ? value as Partial<ResponseLengthSettings> : undefined
  return {
    story: typeof input?.story === 'string' ? input.story : typeof legacySharedValue === 'string' ? legacySharedValue : '',
    codex: typeof input?.codex === 'string' ? input.codex : '',
    summary: typeof input?.summary === 'string' ? input.summary : '',
  }
}
