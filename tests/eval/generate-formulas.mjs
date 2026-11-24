import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { dirname } from 'node:path'
const manifest = JSON.parse(await readFile(new URL('./formula_cases.json', import.meta.url), 'utf8'))
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const output = process.env.FORMULA_OUTPUT ?? '/tests/formula-output/formulas.pdf'
await mkdir(dirname(output), { recursive: true })
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.setContent('<meta charset="utf-8"><style>body{font-family:"DejaVu Sans",sans-serif;margin:48px;font-size:18px}.case{break-after:page}h2{font-size:28px}</style>' + manifest.cases.map(item =>
    `<section class="case"><h1>Synthetic formula ${escape(item.id)}</h1><h2>${escape(item.formula)}</h2><p>${escape(item.description)}</p></section>`).join(''))
  await writeFile(output, await page.pdf({ format: 'A4', printBackground: true }))
} finally { await browser.close() }
