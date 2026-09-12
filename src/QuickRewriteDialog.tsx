import { useState } from 'react'
import ProseRewriteDialog from './ProseRewriteDialog'
import type { QuickTool, QuickToolCapture } from './quick-tools'
import { generateQuickTool } from './quick-tool-generation'
import { proseTransformationInstruction, sensoryPrompts } from './prose-transformations'

export default function QuickRewriteDialog({ tool, capture, apply, close }: {
  tool: QuickTool; capture: QuickToolCapture; apply: (text: string) => boolean; close: () => void
}) {
  const [senses, setSenses] = useState<string[]>([])
  const specialized = tool.id !== 'make-more'
  return <ProseRewriteDialog title={tool.label} original={capture.snapshot.text} instruction="" examples={tool.examples} generateLabel="Go" allowEmptyInstruction={specialized} instructionLabel={specialized ? 'Optional guidance' : 'Instruction'}
    options={tool.id === 'sensory-detail' ? (running) => <fieldset className="sensory-options" disabled={running}><legend>Sensory focus</legend>
      <label><input type="checkbox" checked={!senses.length} onChange={() => setSenses([])} /> Relevant senses automatically</label>
      {sensoryPrompts.map((sense) => <label key={sense.id}><input type="checkbox" checked={senses.includes(sense.id)} onChange={(event) => setSenses((current) => event.target.checked ? [...current, sense.id] : current.filter((id) => id !== sense.id))} />{sense.label}</label>)}
    </fieldset> : undefined}
    generate={(guidance, chunk, signal, onRequest) => generateQuickTool(capture, proseTransformationInstruction(tool.id, guidance, senses), chunk, signal, onRequest)} apply={apply} close={close} />
}
