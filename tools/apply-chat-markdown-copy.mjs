import fs from 'node:fs'

function read(path) { return fs.readFileSync(path, 'utf8') }
function write(path, value) { fs.writeFileSync(path, value) }
function replaceOnce(path, from, to) {
  const source = read(path)
  if (!source.includes(from)) throw new Error(`${path}: anchor not found: ${from.slice(0, 160)}`)
  write(path, source.replace(from, to))
}

replaceOnce('package.json',
`    "lucide-react": "1.31.0",\n    "react": "19.1.1",`,
`    "lucide-react": "1.31.0",\n    "react": "19.1.1",\n    "react-markdown": "10.1.0",\n    "remark-gfm": "4.0.1",`)

replaceOnce('src/ChatFeature.tsx',
`import { useEffect, useMemo, useRef, useState } from 'react'\nimport {\n  Bot,\n  ChevronDown,`,
`import { useEffect, useMemo, useRef, useState } from 'react'\nimport ReactMarkdown from 'react-markdown'\nimport remarkGfm from 'remark-gfm'\nimport {\n  Bot,\n  Check,\n  ChevronDown,\n  Copy,`)

replaceOnce('src/ChatFeature.tsx',
`  const [editingId, setEditingId] = useState('')\n  const [editingValue, setEditingValue] = useState('')\n  const [generating, setGenerating] = useState(false)`,
`  const [editingId, setEditingId] = useState('')\n  const [editingValue, setEditingValue] = useState('')\n  const [copiedMessageId, setCopiedMessageId] = useState('')\n  const [generating, setGenerating] = useState(false)`)

replaceOnce('src/ChatFeature.tsx',
`  const startedAtRef = useRef(0)\n  const bottomRef = useRef<HTMLDivElement | null>(null)`,
`  const startedAtRef = useRef(0)\n  const bottomRef = useRef<HTMLDivElement | null>(null)\n  const copyResetRef = useRef<ReturnType<typeof setTimeout> | null>(null)`)

replaceOnce('src/ChatFeature.tsx',
`  useEffect(() => () => abortRef.current?.abort(), [])`,
`  useEffect(() => () => {\n    abortRef.current?.abort()\n    if (copyResetRef.current) clearTimeout(copyResetRef.current)\n  }, [])`)

replaceOnce('src/ChatFeature.tsx',
`  function readAloud(message: ChatMessageEntity) {`,
`  async function copyMessage(message: ChatMessageEntity) {\n    if (!message.content) return\n    try {\n      if (navigator.clipboard?.writeText) {\n        await navigator.clipboard.writeText(message.content)\n      } else {\n        const textarea = document.createElement('textarea')\n        textarea.value = message.content\n        textarea.setAttribute('readonly', '')\n        textarea.style.position = 'fixed'\n        textarea.style.opacity = '0'\n        document.body.appendChild(textarea)\n        textarea.select()\n        const copied = document.execCommand('copy')\n        textarea.remove()\n        if (!copied) throw new Error('Copy command was not accepted.')\n      }\n      setCopiedMessageId(message.id)\n      if (copyResetRef.current) clearTimeout(copyResetRef.current)\n      copyResetRef.current = setTimeout(() => {\n        setCopiedMessageId((current) => current === message.id ? '' : current)\n        copyResetRef.current = null\n      }, 1600)\n    } catch {\n      onToast('Could not copy this message to the clipboard.')\n    }\n  }\n\n  function readAloud(message: ChatMessageEntity) {`)

replaceOnce('src/ChatFeature.tsx',
`              <div className="bubble">{message.content || (message.documentEdits?.length || message.codexCreations?.length ? <em>Workspace proposal</em> : <em>No final answer returned.</em>)}</div>`,
`              <div className="bubble chat-markdown-bubble">{message.content ? <MarkdownMessage content={message.content} /> : (message.documentEdits?.length || message.codexCreations?.length ? <em>Workspace proposal</em> : <em>No final answer returned.</em>)}</div>`)

replaceOnce('src/ChatFeature.tsx',
`              <div className="message-tools"><button type="button" onClick={() => beginEdit(message)}><Pencil aria-hidden="true" /> Edit</button><button type="button" onClick={() => { void fork(message) }}><GitFork aria-hidden="true" /> Fork</button><button type="button" onClick={() => readAloud(message)}><Volume2 aria-hidden="true" /> Read aloud</button><button type="button" onClick={() => { void regenerate(message) }}><RefreshCw aria-hidden="true" /> Regenerate</button><button type="button" onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden="true" /> Delete</button></div>`,
`              <div className="message-tools"><button type="button" onClick={() => { void copyMessage(message) }}>{copiedMessageId === message.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copiedMessageId === message.id ? 'Copied' : 'Copy'}</button><button type="button" onClick={() => beginEdit(message)}><Pencil aria-hidden="true" /> Edit</button><button type="button" onClick={() => { void fork(message) }}><GitFork aria-hidden="true" /> Fork</button><button type="button" onClick={() => readAloud(message)}><Volume2 aria-hidden="true" /> Read aloud</button><button type="button" onClick={() => { void regenerate(message) }}><RefreshCw aria-hidden="true" /> Regenerate</button><button type="button" onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden="true" /> Delete</button></div>`)

replaceOnce('src/ChatFeature.tsx',
`            <div className="bubble">{message.content}</div>\n            <div className="message-tools"><button type="button" onClick={() => beginEdit(message)}><Pencil aria-hidden="true" /> Edit</button><button type="button" onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden="true" /> Delete</button></div>`,
`            <div className="bubble chat-markdown-bubble"><MarkdownMessage content={message.content} /></div>\n            <div className="message-tools"><button type="button" onClick={() => { void copyMessage(message) }}>{copiedMessageId === message.id ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />} {copiedMessageId === message.id ? 'Copied' : 'Copy'}</button><button type="button" onClick={() => beginEdit(message)}><Pencil aria-hidden="true" /> Edit</button><button type="button" onClick={() => { void deleteFrom(message) }}><Trash2 aria-hidden="true" /> Delete</button></div>`)

replaceOnce('src/ChatFeature.tsx',
`          {streamedContent && <div className="bubble">{streamedContent}</div>}`,
`          {streamedContent && <div className="bubble chat-markdown-bubble"><MarkdownMessage content={streamedContent} /></div>}`)

replaceOnce('src/ChatFeature.tsx',
`function ChatModelPicker({ value, models, onChange }: { value: string; models: ChatModel[]; onChange: (modelId: string) => void }) {`,
`function MarkdownMessage({ content }: { content: string }) {\n  return <div className="chat-markdown"><ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown></div>\n}\n\nfunction ChatModelPicker({ value, models, onChange }: { value: string; models: ChatModel[]; onChange: (modelId: string) => void }) {`)

const css = `\n\n/* Render chat message bodies as safe Markdown. react-markdown leaves raw HTML escaped. */\n.functional-chat .bubble.chat-markdown-bubble { white-space: normal; }\n.chat-markdown { min-width: 0; overflow-wrap: anywhere; }\n.chat-markdown > :first-child { margin-top: 0; }\n.chat-markdown > :last-child { margin-bottom: 0; }\n.chat-markdown p { margin: 0 0 .72em; }\n.chat-markdown p:last-child { margin-bottom: 0; }\n.chat-markdown h1,.chat-markdown h2,.chat-markdown h3,.chat-markdown h4,.chat-markdown h5,.chat-markdown h6 { margin: 1em 0 .45em; color: var(--ink); font-family: var(--serif); font-weight: 500; line-height: 1.2; }\n.chat-markdown h1 { font-size: 1.5em; }\n.chat-markdown h2 { font-size: 1.32em; }\n.chat-markdown h3 { font-size: 1.17em; }\n.chat-markdown h4,.chat-markdown h5,.chat-markdown h6 { font-size: 1em; }\n.chat-markdown ul,.chat-markdown ol { margin: .55em 0 .8em; padding-left: 1.45em; }\n.chat-markdown li + li { margin-top: .28em; }\n.chat-markdown blockquote { margin: .75em 0; padding: .1em 0 .1em .9em; border-left: 2px solid rgba(198,168,107,.45); color: var(--soft); }\n.chat-markdown blockquote > :last-child { margin-bottom: 0; }\n.chat-markdown code { padding: .12em .32em; border-radius: .35em; background: rgba(255,255,255,.055); color: #ddd5c6; font: .84em/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }\n.chat-markdown pre { max-width: 100%; margin: .75em 0; padding: .8em .9em; overflow: auto; border: 1px solid var(--line); border-radius: .7em; background: #0b0c0b; }\n.chat-markdown pre code { padding: 0; border-radius: 0; background: transparent; color: #d9d3c8; font-size: .78em; white-space: pre; }\n.chat-markdown a { color: var(--accent-bright); text-decoration-color: rgba(224,200,143,.45); text-underline-offset: 2px; }\n.chat-markdown hr { margin: 1em 0; border: 0; border-top: 1px solid var(--line); }\n.chat-markdown table { width: max-content; min-width: 100%; border-collapse: collapse; font: .78em/1.45 ui-sans-serif,system-ui; }\n.chat-markdown table th,.chat-markdown table td { padding: .48em .62em; border: 1px solid var(--line); text-align: left; vertical-align: top; }\n.chat-markdown table th { background: rgba(255,255,255,.04); color: var(--ink); }\n.chat-markdown .contains-task-list { padding-left: .2em; list-style: none; }\n.chat-markdown .task-list-item { display: flex; align-items: flex-start; gap: .45em; }\n.chat-markdown .task-list-item input { width: auto; min-height: 0; margin-top: .28em; accent-color: var(--accent); }\n`
write('src/chat.css', read('src/chat.css') + css)

console.log('Chat Markdown rendering and copy actions applied.')
