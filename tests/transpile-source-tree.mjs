import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const sourceRoot = fileURLToPath(new URL('../src/', import.meta.url))

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) ? [path] : []
  })
}

export function transpileSourceTree(outputDirectory) {
  for (const sourcePath of sourceFiles(sourceRoot)) {
    const relativePath = relative(sourceRoot, sourcePath)
    const outputPath = resolve(outputDirectory, relativePath.replace(/\.tsx?$/, '.mjs'))
    const source = readFileSync(sourcePath, 'utf8')
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText
      .replace(/import ['"][^'"]+\.css['"];?/g, '')
      .replace(/(['"])(\.\.?\/[^'"]+)\1/g, (_, quote, path) => {
        const match = path.match(/^(.*?)(\?[^?]*)?$/)
        const modulePath = match[1].replace(/\.tsx?$/, '')
        return `${quote}${modulePath}.mjs${match[2] ?? ''}${quote}`
      })
    mkdirSync(dirname(outputPath), { recursive: true })
    writeFileSync(outputPath, compiled)
  }
}
