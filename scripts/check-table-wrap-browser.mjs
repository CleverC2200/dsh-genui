#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { createServer } from 'vite'

const exec = promisify(execFile)
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(root, '.e2e-artifacts/table-wrap')
let profile
let server
try {
  await mkdir(out, { recursive: true })

  profile = await mkdtemp(join(tmpdir(), 'genui-table-wrap-chrome-'))
  const candidates = process.env.BROWSER_BIN
    ? [process.env.BROWSER_BIN]
    : [
      'google-chrome',
      'chromium',
      'chromium-browser',

      'msedge',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
  let browser
  for (const candidate of candidates) {
    try { await exec(candidate, ['--version']); browser = candidate; break } catch {                                     }
  }
  if (browser === undefined) throw new Error('Install Chrome/Chromium or set BROWSER_BIN to an installed browser executable')
  server = await createServer({
    root, configFile: false,
    server: { host: '127.0.0.1', port: 0, strictPort: true, watch: { ignored: ['**/.e2e-artifacts/**'] } },
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        { find: /^(?:.*\/)?primitive-adapter\.ts$/, replacement: resolve(root, 'src/client/standalone/primitive-adapter.tsx') },
      ],
    },
    optimizeDeps: {
      include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client'],
      force: true,
    },
  })
  await server.listen()
  const address = server.httpServer.address()
  if (address === null || typeof address === 'string') throw new Error('Vite did not bind a loopback TCP port')
  const { stdout, stderr } = await exec(browser, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-extensions', '--disable-sync', `--user-data-dir=${profile}`,
    '--virtual-time-budget=5000', '--window-size=1200,1800',
    `--screenshot=${join(out, 'layout.png')}`, '--dump-dom',
    `http://127.0.0.1:${address.port}/tests/browser/table-wrap.html`,
  ], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 })
  await writeFile(join(out, 'page.html'), stdout)
  await writeFile(join(out, 'browser.log'), stderr)
  const raw = /<pre id="results">([^<]*)<\/pre>/.exec(stdout)?.[1]
  const browserErrors = /<pre id="browser-errors">([\s\S]*?)<\/pre>/.exec(stdout)?.[1]

  const decodeBrowserText = value => value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
  const errorSummary = browserErrors === undefined ? '' : decodeBrowserText(browserErrors).trim().slice(0, 2000)
  if (raw === undefined || raw === 'pending') {
    const detail = errorSummary === '' ? 'inspect page.html and browser.log' : `Browser errors:\n${errorSummary}`
    throw new Error(`Browser fixture did not finish; ${detail}`)
  }
  if (errorSummary !== '') throw new Error(`Browser reported client errors:\n${errorSummary}`)
  const results = JSON.parse(decodeBrowserText(raw))
  await writeFile(join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n')

  if (results.length !== 9) throw new Error(`Expected 9 browser layout checks, got ${results.length}`)
  const byName = Object.fromEntries(results.map(result => [result.name, result]))
  const failures = []

  const check = (condition, message) => { if (!condition) failures.push(message) }

  const dataDefault = byName['issue326 data table, default']
  const dataWrap = byName['issue326 data table, wrap']
  const proseDefault = byName['prose table, default']
  const proseWrap = byName['prose table, wrap']
  for (const [label, result] of Object.entries({ dataDefault, dataWrap, proseDefault, proseWrap })) {
    if (result === undefined) failures.push(`missing case: ${label}`)
  }

  if (dataDefault && dataWrap && proseDefault && proseWrap) {

    check(dataDefault.cellWhiteSpace === 'nowrap', `default data table cells must stay nowrap (got ${dataDefault.cellWhiteSpace})`)
    check(dataDefault.tableWidth > dataDefault.wrapWidth, `default data table must size to max-content and exceed the column (table ${dataDefault.tableWidth}px, column ${dataDefault.wrapWidth}px)`)
    check(dataDefault.overflows, 'default data table must scroll horizontally, not clip (#326)')

    check(dataWrap.cellWhiteSpace === 'normal', `wrap data table cells must wrap (got ${dataWrap.cellWhiteSpace})`)
    check(dataWrap.tableLayout === 'auto', `wrap data table must keep table-layout:auto (got ${dataWrap.tableLayout})`)
    check(!dataWrap.overflows, `wrap data table must fit its column (table ${dataWrap.tableWidth}px, column ${dataWrap.wrapWidth}px)`)
    check(dataWrap.minColWidth >= 80, `wrap data table column floor missing: min column ${dataWrap.minColWidth}px — #326 collapse risk`)

    check(proseDefault.cellWhiteSpace === 'nowrap', `default prose table cells must stay nowrap (got ${proseDefault.cellWhiteSpace})`)
    check(proseDefault.overflows, `default prose table must overflow at this column width (table ${proseDefault.tableWidth}px, column ${proseDefault.wrapWidth}px)`)

    check(proseWrap.cellWhiteSpace === 'normal', `wrap prose table cells must wrap (got ${proseWrap.cellWhiteSpace})`)
    check(!proseWrap.overflows, `wrap prose table must fit its column (table ${proseWrap.tableWidth}px, column ${proseWrap.wrapWidth}px)`)
    check(proseWrap.minColWidth >= 80, `wrap prose table column floor missing: min column ${proseWrap.minColWidth}px — #326 collapse risk`)
    check(proseWrap.rowHeight > proseDefault.rowHeight, `wrap prose table must actually wrap (row ${proseWrap.rowHeight}px vs ${proseDefault.rowHeight}px unwrapped)`)
  }

  for (const name of ['long token, wrap', 'inline code, wrap']) {
    const result = byName[name]
    check(result !== undefined && !result.overflows, `${name} must fit its 400px container`)
  }
  check(byName['inline code, wrap']?.codeWhiteSpace === 'pre-wrap', 'wrapped code must preserve spaces while wrapping')
  const multiline = byName['explicit newlines, wrap']
  check(multiline?.cellWhiteSpaces.join(',') === 'pre-line,pre-wrap', 'explicit prose and code newlines must keep their whitespace rules')
  check(multiline?.cellText[1] === 'print(1)\n    print(2)', 'copyable code indentation and newlines must survive')
  const narrow = byName['narrow six columns, wrap']
  check(narrow?.overflows && narrow.minColWidth >= 80, 'a narrow six-column table must scroll with readable columns')
  check(byName['nested default table']?.cellWhiteSpace === 'nowrap', 'parent wrapping must not change a nested default table')

  if (failures.length > 0) {
    throw new Error(`Browser table.wrap regression failed:\n${failures.map(line => `- ${line}`).join('\n')}\n\nmeasurements:\n${JSON.stringify(results, null, 2)}`)
  }
  await readFile(join(out, 'layout.png'))
  console.log(`Chromium table.wrap layout check passed: ${results.length} cases`)
} finally {
  await server?.close()
  if (profile !== undefined) await rm(profile, { recursive: true, force: true })
}
