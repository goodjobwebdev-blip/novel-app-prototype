from pathlib import Path
import re

p = Path('.github/scripts/issue81.py')
text = p.read_text()
pattern = re.compile(r"old_listener = \"\"\"[\s\S]*?text = text\.replace\(old_listener, new_listener, 1\)\n", re.M)
replacement = r'''listener_line = "          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(dictationProvisional))) onChangeRef.current(update.state.doc.toString())\n"
if listener_line not in text: raise SystemExit('editor update listener line not found')
text = text.replace(listener_line, listener_line + "          onHistoryAvailabilityRef.current?.({ canUndo: undoDepth(update.state) > 0, canRedo: redoDepth(update.state) > 0 })\n", 1)
'''
next_text, count = pattern.subn(replacement, text, count=1)
if count != 1:
    raise SystemExit(f'listener helper replacement count={count}')
p.write_text(next_text)
