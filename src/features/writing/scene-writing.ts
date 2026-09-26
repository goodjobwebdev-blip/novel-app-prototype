export const sceneWritingFields = ['pov', 'tense', 'writingStyle', 'language'] as const
export type SceneWritingField = typeof sceneWritingFields[number]
export type SceneWritingOverrides = Partial<Record<SceneWritingField, string>>
export const sceneWritingLabels: Record<SceneWritingField, string> = { pov: 'Point of view', tense: 'Tense', writingStyle: 'Writing style', language: 'Language' }

export function sceneWritingValues(scene?: Record<string, unknown> | null): Record<SceneWritingField, string> {
  return Object.fromEntries(sceneWritingFields.map((key) => [key, typeof scene?.[key] === 'string' ? scene[key].trim() : ''])) as Record<SceneWritingField, string>
}
export function validateSceneWritingPatch(value: unknown): SceneWritingOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Provide scene writing settings.')
  const entries = Object.entries(value)
  if (!entries.length || entries.some(([key, val]) => !sceneWritingFields.includes(key as SceneWritingField) || typeof val !== 'string')) throw new Error('Only scene POV, tense, writingStyle and language strings are supported.')
  return Object.fromEntries(entries.map(([key, val]) => [key, String(val).trim()]))
}
export function resolveSceneWriting(book: { pov?: string; tense?: string; style?: string; language?: string }, scene?: SceneWritingOverrides) {
  const raw = sceneWritingValues(scene)
  const fields = { pov: 'pov', tense: 'tense', style: 'writingStyle', language: 'language' } as const
  return Object.fromEntries(Object.entries(fields).map(([name, key]) => [name, {
    value: raw[key] || book[name as keyof typeof book] || '', origin: raw[key] ? 'Scene override' : 'Book default',
  }])) as Record<'pov' | 'tense' | 'style' | 'language', { value: string; origin: string }>
}
export function sceneWritingTemplateValues(book: Parameters<typeof resolveSceneWriting>[0], scene?: SceneWritingOverrides) {
  const raw = sceneWritingValues(scene)
  const effective = resolveSceneWriting(book, scene)
  return {
    'scene.pov': raw.pov, 'scene.tense': raw.tense, 'scene.style': raw.writingStyle, 'scene.language': raw.language,
    ...Object.fromEntries(Object.entries(effective).flatMap(([key, item]) => [[`scene.effective_${key}`, item.value], [`scene.${key}_origin`, item.origin]])),
  }
}
