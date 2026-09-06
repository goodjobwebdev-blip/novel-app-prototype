from pathlib import Path
path = Path('tests/book-metadata-save-order.test.mjs')
text = path.read_text()
text = text.replace("source.indexOf('\n", "source.indexOf('")
path.write_text(text)
