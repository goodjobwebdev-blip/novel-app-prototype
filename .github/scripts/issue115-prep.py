from pathlib import Path

path = Path('.github/scripts/issue115.py')
text = path.read_text()
old = "if (proposal.status !== 'proposed') return\\n  await setActionStatus(message.id, proposal.id, { status: 'rejected' })"
new = "if (proposal.status !== 'proposed') throw new Error(`This proposal is already ${proposal.status}.`)\\n  await setActionStatus(message.id, proposal.id, { status: 'rejected' })"
if old not in text:
    raise SystemExit('entity reject script pattern not found')
path.write_text(text.replace(old, new, 1))
