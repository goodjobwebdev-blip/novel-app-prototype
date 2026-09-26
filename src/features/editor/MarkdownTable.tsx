import type { ComponentPropsWithoutRef } from 'react'
import './markdown-table.css'

// Scroll the wrapper, keeping the semantic table intact for layout and readers.
export default function MarkdownTable({ node: _node, ...props }: ComponentPropsWithoutRef<'table'> & { node?: unknown }) {
  return <div className="markdown-table-scroll" role="region" aria-label="Table — scroll horizontally to see all columns" tabIndex={0}>
    <table {...props} />
  </div>
}
