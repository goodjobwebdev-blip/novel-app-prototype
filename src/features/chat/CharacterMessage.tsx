import type { ReactNode } from 'react'
import type { CharacterParticipant } from './character-chat'
export function characterSpeakerParts(content: string, participants: CharacterParticipant[]) {
  const result: Array<{ speaker?: CharacterParticipant; content: string }> = []
  let current: { speaker?: CharacterParticipant; content: string } = { content: '' }
  for (const line of content.split('\n')) {
    const match = line.match(/^\s*@([^:]+):\s*(.*)$/)
    if (match) {
      if (current.content) result.push(current)
      const token = match[1].trim(), speaker = participants.find(p => p.token === token) ?? participants.find(p => p.label.toLocaleLowerCase() === token.toLocaleLowerCase())
      current = { speaker, content: speaker ? match[2] : `[Unselected speaker] ${match[2]}` }
    } else current.content += (current.content ? '\n' : '') + line
  }
  if (current.content || current.speaker) result.push(current)
  return result
}
export default function CharacterMessage({ content, participants, render }: { content: string; participants: CharacterParticipant[]; render: (text: string) => ReactNode }) {
  return <>{characterSpeakerParts(content, participants).map((part, index) => <div key={index} className={`character-speech ${part.speaker ? `speaker-color-${parseInt(part.speaker.token.slice(-4), 16) % 6}` : ''}`}>{part.speaker && <strong className="character-speaker">@{part.speaker.label}:</strong>}{render(part.content)}</div>)}</>
}
