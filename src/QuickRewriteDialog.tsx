import ProseRewriteDialog from './ProseRewriteDialog'
import SensoryDetailDialog from './SensoryDetailDialog'
import type { QuickTool, QuickToolCapture } from './quick-tools'
import { generateQuickTool } from './quick-tool-generation'
import { proseTransformationInstruction } from './prose-transformations'

export default function QuickRewriteDialog({ tool, capture, apply, close }: {
  tool: QuickTool; capture: QuickToolCapture; apply: (text: string) => boolean; close: () => void
}) {
  if (tool.id === 'sensory-detail') return <SensoryDetailDialog capture={capture} apply={apply} close={close} />
  const specialized = tool.id !== 'make-more'
  return <ProseRewriteDialog title={tool.label} original={capture.snapshot.text} instruction="" examples={tool.examples} generateLabel="Go" allowEmptyInstruction={specialized} instructionLabel={specialized ? 'Optional guidance' : 'Instruction'}
    generate={(guidance, chunk, signal, onRequest) => generateQuickTool(capture, proseTransformationInstruction(tool.id, guidance), chunk, signal, onRequest)} apply={apply} close={close} />
}
