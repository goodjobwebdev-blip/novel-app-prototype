import { markdownLanguage } from '@codemirror/lang-markdown'

export const ARTICLE_LINK_PREFIX = 'arc-codex:'

export function articleLink(id: string, title: string) {
  // encodeURIComponent intentionally leaves parentheses unescaped; Markdown does not.
  const encodedId = encodeURIComponent(id).replace(/[()]/g, character => character === '(' ? '%28' : '%29')
  return `[${title.replace(/[\\\[\]]/g, '\\$&').replace(/\r?\n/g, ' ')}](${ARTICLE_LINK_PREFIX}${encodedId})`
}

export function articleLinkTarget(href: string): string | null {
  if (!href.startsWith(ARTICLE_LINK_PREFIX)) return null
  try { return decodeURIComponent(href.slice(ARTICLE_LINK_PREFIX.length)) || null }
  catch { return null }
}

/** Remap only real Markdown link destinations, never prose, images or code examples. */
export function remapArticleLinks(content: string, ids: ReadonlyMap<string, string>): string {
  const changes: { from: number; to: number; text: string }[] = []
  markdownLanguage.parser.parse(content).iterate({
    enter(node) {
      if (node.name !== 'Link') return
      const url = node.node.getChild('URL')
      if (!url) return
      const destination = content.slice(url.from, url.to)
      const angled = destination.startsWith('<') && destination.endsWith('>')
      const id = articleLinkTarget(angled ? destination.slice(1, -1) : destination)
      const mapped = id ? ids.get(id) : undefined
      if (!mapped || mapped === id) return
      const encoded = encodeURIComponent(mapped).replace(/[()]/g, character => character === '(' ? '%28' : '%29')
      changes.push({ from: url.from, to: url.to, text: `${angled ? '<' : ''}${ARTICLE_LINK_PREFIX}${encoded}${angled ? '>' : ''}` })
    },
  })
  // Apply from the end so replacements cannot invalidate parser offsets.
  for (const change of changes.sort((a, b) => b.from - a.from)) content = content.slice(0, change.from) + change.text + content.slice(change.to)
  return content
}

export function articleLinkIds(content: string): string[] {
  const ids = new Set<string>()
  // Use the editor's Markdown grammar: examples inside code and image URLs are not links.
  markdownLanguage.parser.parse(content).iterate({
    enter(node) {
      if (node.name !== 'Link') return
      const url = node.node.getChild('URL')
      if (!url) return
      const id = articleLinkTarget(content.slice(url.from, url.to).replace(/^<|>$/g, ''))
      if (id) ids.add(id)
    },
  })
  return [...ids]
}
