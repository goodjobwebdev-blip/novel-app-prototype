export type PromptScope = 'story' | 'summarize' | 'titles'

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

const everyPrompt: PromptScope[] = ['story', 'summarize', 'titles']

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
  { name: 'scene.text', description: 'Scene text supplied to Story generation', scopes: ['story'] },
  { name: 'scene.pov', description: 'Scene-specific POV when one is set', scopes: ['story'] },
  { name: 'target.type', description: 'The requested summary, title, or name target', scopes: ['summarize', 'titles'] },
  { name: 'target.previous_summary', description: 'Existing summary when re-summarizing', scopes: ['summarize'] },
  { name: 'count', description: 'Requested number of title or name options', scopes: ['titles'] },
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
