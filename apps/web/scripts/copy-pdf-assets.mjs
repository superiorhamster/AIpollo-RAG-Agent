import { cpSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const source = dirname(require.resolve('pdfjs-dist/package.json'))
const assets = new URL('../public/pdfjs/', import.meta.url)
mkdirSync(assets, { recursive: true })
for (const file of ['build/pdf.worker.min.mjs', 'cmaps', 'standard_fonts', 'wasm']) {
  cpSync(join(source, file), new URL(file.split('/').at(-1), assets), { recursive: true })
}
