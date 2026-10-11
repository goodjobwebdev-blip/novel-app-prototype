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
