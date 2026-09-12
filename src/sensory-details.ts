import { protectedRanges } from './document-projection.ts'
import { sensoryPrompts } from './prose-transformations'
import { prepareQuickToolRequest } from './quick-tool-generation'
import type { QuickToolCapture } from './quick-tools'
import { streamTextProviderCompletion } from './text-provider'

export type SensoryVariant = { id: string; sense: typeof sensoryPrompts[number]['id']; label: string; text: string; edited?: boolean }
export const SENSORY_VARIANTS_PER_SENSE = 2
const normalized = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase()

export function validSensoryReplacement(text: string) {
  return Boolean(text.trim()) && !protectedRanges(text).length
}

/** Emit each complete idea as it arrives; never expose incomplete JSON as prose. */
export function createSensoryVariantParser(original: string, existing: SensoryVariant[], onVariant: (variant: SensoryVariant) => void) {
  let buffer = '', output = ''
  const variants: SensoryVariant[] = []
  const seen = new Set([normalized(original), ...existing.map(variant => normalized(variant.text))])
  const counts = new Map<string, number>()
  function accept(value: unknown) {
    if (!value || typeof value !== 'object') return
    const item = value as Record<string, unknown>
    if (Array.isArray(value)) { value.forEach(accept); return }
    if (Array.isArray(item.variants)) { item.variants.forEach(accept); return }
    const sense = sensoryPrompts.find(sense => sense.id === item.sense)
    if (!sense || typeof item.label !== 'string' || typeof item.text !== 'string') return
    const label = item.label.trim(), text = item.text.trim()
    if (!label || label.length > 100 || /[\r\n]/.test(label) || text.length > Math.max(4000, original.length * 3) || !validSensoryReplacement(text) || seen.has(normalized(text)) || (counts.get(sense.id) ?? 0) >= SENSORY_VARIANTS_PER_SENSE) return
    seen.add(normalized(text)); counts.set(sense.id, (counts.get(sense.id) ?? 0) + 1)
    const variant: SensoryVariant = { id: crypto.randomUUID(), sense: sense.id, label, text }
    variants.push(variant); onVariant(variant)
  }
  function parse(text: string) {
    let value: unknown
    try { value = JSON.parse(text) } catch { return }
    accept(value)
  }
  return {
    push(text: string) {
      if (output.length + text.length > 500_000) throw new Error('The suggestion response is too long. Select a shorter passage and try again.')
      output += text; buffer += text
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      lines.forEach(parse)
    },
    finish() {
      parse(buffer)
      // Also accept a complete JSON array/object if a model ignores the line format.
      parse(output.trim().replace(/^```(?:json|jsonl|ndjson)?\s*/i, '').replace(/\s*```$/, ''))
      if (!variants.length) throw new Error('No new usable sensory ideas were returned. Try again.')
      return variants
    },
  }
}

export function prepareSensoryDetailRequest(capture: QuickToolCapture, existing: SensoryVariant[], signal: AbortSignal) {
  const senses = sensoryPrompts.map(sense => `${sense.id}: ${sense.label}`).join('; ')
  const instruction = `Propose ${SENSORY_VARIANTS_PER_SENSE} distinct sensory-detail variants for each of these seven senses: ${senses}. Each variant independently replaces the ENTIRE selected passage, adding one restrained, concrete detail focused on that sense. Keep the original meaning, POV, tense, language, Markdown, dialogue and pacing. Use plausible, low-assumption details grounded in the current viewpoint and situation; do not invent plot events to force a sense. Do not combine all seven senses into one replacement. Give each variant a short, specific chip label naming its sensory idea, in the passage's language. Interleave the senses so the first idea for every sense arrives before the second round.${existing.length ? `\nAvoid repeating these ideas: ${JSON.stringify(existing.map(({ sense, label }) => ({ sense, label })))}` : ''}`
  return prepareQuickToolRequest(capture, instruction, signal, 'Return newline-delimited JSON only, one complete object per line: {"sense":"one of the requested sense IDs","label":"short sensory idea","text":"complete replacement passage"}. Escape all newlines inside JSON strings. Do not wrap the objects in an array, commentary or code fences.')
}

export async function generateSensoryDetails(capture: QuickToolCapture, existing: SensoryVariant[], signal: AbortSignal, onVariant: (variant: SensoryVariant) => void) {
  const { settings, model, request } = await prepareSensoryDetailRequest(capture, existing, signal)
  signal.throwIfAborted()
  const parser = createSensoryVariantParser(capture.snapshot.text, existing, variant => { signal.throwIfAborted(); onVariant(variant) })
  await streamTextProviderCompletion({ provider: settings.provider, task: 'story', thinkingEffort: settings.mainThinkingEffort, apiKey: settings.apiKey, baseUrl: settings.baseUrl, model, systemPrompt: '', userMessage: '', messages: request.providerMessages }, text => { signal.throwIfAborted(); parser.push(text) }, signal)
  signal.throwIfAborted()
  return parser.finish()
}
