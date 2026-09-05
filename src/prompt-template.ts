export type PromptScope = 'story' | 'summarize' | 'titles' | 'lore' | 'assistant'

export type BookPromptValues = {
  title: string
  series: string
  seriesOrder: string
  overview: string
  genre: string
  style: string
  pov: string
  tense: string
  language: string
}

export type PromptVariable = {
  name: string
  description: string
  scopes: PromptScope[]
}

const everyPrompt: PromptScope[] = ['story', 'summarize', 'titles', 'lore', 'assistant']

export const promptVariables: PromptVariable[] = [
  { name: 'book.title', description: 'Current book title', scopes: everyPrompt },
  { name: 'book.series', description: 'Series title, empty for standalone books', scopes: everyPrompt },
  { name: 'book.series_order', description: 'Position of the book within its series', scopes: everyPrompt },
  { name: 'book.overview', description: 'Book overview from the Book tab', scopes: everyPrompt },
  { name: 'book.genre', description: 'Genre or combination of genres', scopes: everyPrompt },
  { name: 'book.style', description: 'Preferred writing style', scopes: everyPrompt },
  { name: 'book.pov', description: 'Default point of view for the book', scopes: everyPrompt },
  { name: 'book.tense', description: 'Default narrative tense', scopes: everyPrompt },
  { name: 'book.language', description: 'Primary writing language', scopes: everyPrompt },
  { name: 'scene.text', description: 'Current Scene for Story; last-opened Scene for Lore entries', scopes: ['story', 'lore'] },
  { name: 'scene.pov', description: 'Scene-specific POV when one is set', scopes: ['story'] },
  { name: 'scene.previous_text', description: 'Previous Scene when the current Scene is empty', scopes: ['story'] },
  { name: 'scene.summary_context', description: 'Hierarchically compressed summaries of earlier material', scopes: ['story'] },
  { name: 'additional_context', description: 'Sources selected in Context Management', scopes: ['story', 'lore'] },
  { name: 'target.type', description: 'The requested summary, title, or name target', scopes: ['summarize', 'titles'] },
  { name: 'target.previous_summary', description: 'Existing summary when re-summarizing', scopes: ['summarize'] },
  { name: 'count', description: 'Requested number of title or name options', scopes: ['titles'] },
  { name: 'entry.title', description: 'Current Codex entry title', scopes: ['lore'] },
  { name: 'entry.category', description: 'Current Codex entry category', scopes: ['lore'] },
  { name: 'entry.content', description: 'Existing Codex entry Markdown', scopes: ['lore'] },
]

export function bookTemplateValues(book: BookPromptValues): Record<string, string> {
  return {
    'book.title': book.title,
    'book.series': book.series,
    'book.series_order': book.seriesOrder,
    'book.overview': book.overview,
    'book.genre': book.genre,
    'book.style': book.style,
    'book.pov': book.pov,
    'book.tense': book.tense,
    'book.language': book.language,
  }
}

export function renderPromptTemplate(template: string, values: Record<string, string>) {
  return template
    .replace(/{%\s*if\s+([\w.]+)\s*%}([\s\S]*?){%\s*endif\s*%}/g, (_match, key: string, body: string) => values[key]?.trim() ? body : '')
    .replace(/{{\s*([\w.]+)\s*}}/g, (_match, key: string) => values[key] ?? '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
