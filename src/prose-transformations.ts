export const sensoryPrompts = [
  { id: 'sight', label: 'Sight' },
  { id: 'sound', label: 'Sound' },
  { id: 'smell', label: 'Smell' },
  { id: 'taste', label: 'Taste' },
  { id: 'touch', label: 'Touch / temperature' },
  { id: 'movement', label: 'Balance / movement' },
  { id: 'internal', label: 'Internal bodily sensation' },
] as const
export function proseTransformationInstruction(toolId: string, guidance: string, senses: string[] = []) {
  if (toolId === 'make-more') return guidance.trim()
  const additional = guidance.trim() ? `\nAdditional writer guidance: ${guidance.trim()}` : ''
  if (toolId === 'show-dont-tell') return 'Show, don’t tell: convey the selected passage’s meaning through observable action, dialogue, physical response and concrete detail. Preserve established facts, POV, tense, language and emotional intensity unless the writer explicitly requests a change. Keep the replacement near the original length.' + additional
  if (toolId === 'sensory-detail') {
    if (senses.some((id) => !sensoryPrompts.some((sense) => sense.id === id))) throw new Error('Choose a supported sensory focus.')
    const focus = senses.length ? sensoryPrompts.filter((sense) => senses.includes(sense.id)).map((sense) => sense.label).join(', ') : 'Relevant senses automatically'
    return `Add restrained sensory detail to the selected prose. Sensory focus: ${focus}. Choose details relevant to the viewpoint, situation and existing meaning. Do not force every sense into the passage or invent plot facts to satisfy a checklist. Preserve POV, tense, language, continuity and approximately the original length.` + additional
  }
  throw new Error('This rewrite tool is unavailable.')
}
