#!/usr/bin/env node
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.env.GENUI_BROWSER_OUT ?? join(root, '.e2e-artifacts/business-presentation'))
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const server = await createServer({
  root, configFile: false,
  server: { host: '127.0.0.1', watch: { ignored: ['**/.e2e-artifacts/**'] } },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: [{ find: /^(?:.*\/)?primitive-adapter\.ts$/, replacement: resolve(root, 'src/client/standalone/primitive-adapter.tsx') }],
  },
  optimizeDeps: { entries: ['tests/browser/business-presentation.html'], include: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', 'react-dom/client', 'katex'] },
})
const profile = await mkdtemp(join(tmpdir(), 'genui-business-chrome-'))
let browser, socket
const errors = []
try {
  await mkdir(out, { recursive: true })
  await server.listen()
  const address = server.httpServer.address()
  browser = spawn(process.env.BROWSER_BIN ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium'), [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-background-networking', '--disable-extensions', '--disable-sync', '--no-first-run',
    `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank',
  ], { stdio: 'ignore' })
  let port
  for (let i = 0; i < 100; i++) {
    try { port = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break } catch { await pause(100) }
  }
  assert.ok(port, 'Chromium CDP did not start')
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl)
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject })
  let next = 0
  const pending = new Map()
  socket.onmessage = event => {
    const message = JSON.parse(event.data)
    if (message.id) pending.get(message.id)?.(message)
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
  }
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++next
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, 10000)
    pending.set(id, message => {
      clearTimeout(timer); pending.delete(id)
      if (message.error) reject(new Error(JSON.stringify(message.error)))
      else resolve(message.result)
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.ok(!result.exceptionDetails, result.exceptionDetails?.exception?.description)
    return result.result.value
  }
  const waitFor = async (expression, label) => {
    for (let i = 0; i < 150; i++) {
      if (await evaluate(expression)) return
      assert.deepEqual(errors, [], 'Browser runtime errors')
      await pause(100)
    }
    assert.fail(`Timed out: ${label}`)
  }
  const fixtures = JSON.parse(await readFile(join(root, 'tests/fixtures/business-presentation.json'), 'utf8'))
  const results = []
  const measure = (spec, hostFont) => {
    const failures = []
    const check = (ok, criterion, detail) => { if (!ok) failures.push({ criterion, detail }) }
    const rect = element => {
      const r = element.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }
    }
    const visible = element => {
      const s = getComputedStyle(element)
      return s.display !== 'none' && s.visibility !== 'hidden' && rect(element).width > 0 && rect(element).height > 0
    }
    const textRects = element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      const values = []
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue
        const range = document.createRange()
        range.selectNodeContents(walker.currentNode)
        values.push(...[...range.getClientRects()].map(r => ({ left:r.left, right:r.right, top:r.top, bottom:r.bottom })))
      }
      return values
    }
    const font = element => parseFloat(getComputedStyle(element).fontSize)
    const readingFloor = Math.max(12, hostFont * .75)
    const group = document.querySelector('#root').firstElementChild.querySelector('div[style*="grid-template-columns"]')
    const stats = spec.items[0].items.map((item, index) => {
      const label = [...group.querySelectorAll('span')].find(element => element.textContent === item.label)
      check(Boolean(label), 'content', item.label)
      if (!label) return null
      const card = label.parentElement
      const value = label.nextElementSibling
      const delta = item.delta === undefined ? null : value.nextElementSibling
      const bounds = rect(card)
      const valueBounds = rect(value)
      const numeric = index === 0
      const valueFont = font(value)
      const expected = item.value.replace(/^([+−-]?[\d,]+)(\.\d+)?(?=\s|$)/, (_, integer, fraction = '') => integer.replaceAll(',', '') + fraction).replaceAll(/\s/g, '')
      check(value.textContent.replaceAll(/\s/g, '') === expected && visible(value), 'content', { expected, actual: value.textContent })
      const style = getComputedStyle(value)
      check(style.textOverflow !== 'ellipsis' && style.webkitLineClamp === 'none', 'content-clipping', item.label)
      const low = numeric ? Math.max(22, hostFont * 1.3) : Math.max(14, hostFont * .85)
      const high = numeric ? hostFont * 2.1 : Math.max(20, hostFont * 1.25)
      check(valueFont >= low - .1 && valueFont <= high + .1, numeric ? 'numeric-hierarchy' : 'text-hierarchy', { label:item.label, valueFont, low, high })
      check(font(label) >= readingFloor - .1, 'reading-text', { label:item.label, font:font(label), readingFloor })
      if (numeric) {
        check(valueFont > font(label) && Number(style.fontWeight) >= 600, 'numeric-emphasis', item.label)
        if (item.value.includes('/')) {
          const ranges = [...value.querySelectorAll('span')]
          check(ranges.every(element => Math.abs(font(element) - valueFont) <= .1), 'full-ratio', { value:item.value, fonts:ranges.map(font), valueFont })
        } else {
          const suffix = [...value.querySelectorAll('span')].find(element => element.textContent === '箱')
          check(Boolean(suffix) && font(suffix) >= readingFloor - .1 && font(suffix) <= valueFont + .1 && visible(suffix), 'numeric-suffix', suffix ? { font:font(suffix), readingFloor } : 'missing 箱')
        }
      }
      if (delta) {
        check(delta.textContent === item.delta && visible(delta), 'content', item.delta)
        check(font(delta) >= readingFloor - .1, 'reading-text', { delta:item.delta, font:font(delta), readingFloor })
        if (item.delta !== '+3.2%') {
          const s = getComputedStyle(delta)
          check(!/success|(?:^|[ _])up(?:[ _]|$)/i.test(delta.className) && s.color !== 'rgb(24, 128, 56)' && s.color !== 'rgb(31, 157, 99)', 'neutral-status', { text:item.delta, color:s.color, className:delta.className })
        } else if (item.delta === '+3.2%') {
          check(/up|success/i.test(delta.className), 'positive-convention', { text:item.delta, className:delta.className })
        }
      }
      check(card.scrollWidth <= card.clientWidth + 1, 'card-overflow', { label:item.label, scroll:card.scrollWidth, client:card.clientWidth })
      for (const element of [label, value, ...(delta ? [delta] : [])]) {
        for (const r of textRects(element)) check(r.left >= bounds.left - 1 && r.right <= bounds.right + 1 && r.top >= bounds.top - 1 && r.bottom <= bounds.bottom + 1, 'text-containment', { label:item.label, text:element.textContent, rect:r, bounds })
      }
      const valueTextRects = textRects(value)
      for (let a = 0; a < valueTextRects.length; a++) for (let b = a + 1; b < valueTextRects.length; b++) {
        const first = valueTextRects[a], second = valueTextRects[b]
        check(Math.min(first.right, second.right) - Math.max(first.left, second.left) <= 1 || Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top) <= 1, 'value-suffix-overlap', { value:item.value, first, second })
      }
      check(rect(label).bottom <= valueBounds.top + 1, 'text-overlap', item.label)
      if (delta) check(valueBounds.bottom <= rect(delta).top + 1, 'text-overlap', item.delta)
      return { label:item.label, value:item.value, valueFont, labelFont:font(label), bounds, delta:delta ? { text:delta.textContent, color:getComputedStyle(delta).color, font:font(delta) } : null, suffix:[...value.querySelectorAll('span')].map(element => ({ text:element.textContent, font:font(element) })) }
    }).filter(Boolean)
    for (const a of stats) for (const b of stats) if (a !== b && Math.abs(a.bounds.top - b.bounds.top) <= 1) check(Math.abs(a.bounds.bottom - b.bounds.bottom) <= 1, 'row-alignment', { a:a.label, b:b.label, aBottom:a.bounds.bottom, bBottom:b.bounds.bottom })
    for (const element of [document.documentElement, document.querySelector('#root'), group]) check(element.scrollWidth <= element.clientWidth + 1, 'group-overflow', { tag:element.tagName, scroll:element.scrollWidth, client:element.clientWidth })
    const buttons = [...document.querySelectorAll('button')]
    for (const button of buttons) check(visible(button) && font(button) >= readingFloor - .1, 'action-reading', { text:button.textContent, font:font(button), readingFloor })
    if (spec.items.some(item => item.type === 'callout')) {
      const text = document.querySelector('#root').textContent
      check(text.includes('只覆盖 100 笔订单中的 2 笔') && text.includes('不计算完整订单缺货率') && text.includes('未完成') && !text.includes('分页完成'), 'business-boundary', text)
    }
    return { failures, stats, buttons:buttons.map(element => ({ label:element.textContent, bounds:rect(element), font:font(element) })) }
  }
  await command('Runtime.enable')
  await command('Page.navigate', { url: `http://127.0.0.1:${address.port}/tests/browser/business-presentation.html` })
  await waitFor('Boolean(window.genuiPresentation)', 'fixture load')
  const version = await command('Browser.getVersion')
  for (const id of ['pagination', 'stress']) for (const width of [360, 960]) for (const hostFontSize of [14, 17, 22]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 1000, deviceScaleFactor: 1, mobile: false })
    await evaluate(`window.genuiPresentation.mountCase(${JSON.stringify(id)}, ${JSON.stringify({ width, hostFontSize })})`)
    await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
    const result = await evaluate(`(${measure.toString()})(${JSON.stringify(fixtures.specs[id])}, ${hostFontSize})`)
    assert.deepEqual(await evaluate('window.genuiPresentation.events'), [], 'Mount and resize must emit no actions')
    const screenshot = `${id}-${width}-${hostFontSize}.png`
    const layout = await command('Page.getLayoutMetrics')
    await writeFile(join(out, screenshot), Buffer.from((await command('Page.captureScreenshot', { captureBeyondViewport:true, clip:{ x:0, y:0, width, height:Math.ceil(layout.cssContentSize.height), scale:1 } })).data, 'base64'))
    const clicks = []
    const actions = fixtures.specs[id].items.flatMap(item => item.type === 'button' ? [item] : item.type === 'row' ? item.items : []).filter(item => item.type === 'button')
    for (let index = 0; index < actions.length; index++) {
      const target = `[...document.querySelectorAll('button')].find(button => button.textContent === ${JSON.stringify(actions[index].label)})`
      await evaluate(`${target}.scrollIntoView({behavior:'instant', block:'center', inline:'center'})`)
      await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
      const point = await evaluate(`(() => {
        const button = ${target}
        const rect = button.getBoundingClientRect()
        const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
        return {x, y, width:rect.width, height:rect.height, disabled:button.disabled,
          viewportWidth:innerWidth, viewportHeight:innerHeight, scrollY,
          hit:button.contains(document.elementFromPoint(x, y))}
      })()`)
      assert.ok(point.width > 0 && point.height > 0 && !point.disabled && point.x > 0 && point.x < point.viewportWidth && point.y > 0 && point.y < point.viewportHeight && point.hit, `${id}/${width}/${hostFontSize}/${actions[index].action}: pointer target is not hittable: ${JSON.stringify(point)}`)
      for (const type of ['mousePressed', 'mouseReleased']) await command('Input.dispatchMouseEvent', { type, x:point.x, y:point.y, button:'left', clickCount:1 })
      clicks.push({action:actions[index].action, ...point})
      const events = await evaluate('window.genuiPresentation.events')
      assert.equal(events.length, index + 1, `${id}: one event per real click`)
      assert.equal(events[index].action, actions[index].action, `${id}: preserve action name`)
      assert.deepEqual(events[index].payload.fields ?? {}, {}, `${id}: no hidden fields`)
    }
    results.push({ id, width, hostFontSize, deviceScaleFactor:1, screenshot, input:fixtures.specs[id], ...result, clicks, events:await evaluate('window.genuiPresentation.events') })
  }
  await evaluate(`window.genuiPresentation.mount(${JSON.stringify({ items:[{type:'grid',cols:2,items:[{type:'text',content:'Short'},{type:'text',content:'A longer nonstat item that occupies multiple lines at this width. '.repeat(6)}]},{type:'stat',label:'Numeric prefix status',value:'2 pages remain to be read'},{type:'stat',label:'Currency amount',value:'¥1,024'},{type:'stat',label:'Compact number',value:'1.2k'},{type:'stat',label:'Scientific notation',value:'1e6'},{type:'stat',label:'Localized decimal',value:'1,6328 $'},{type:'stat',label:'Bottle count',value:'20 瓶'},{type:'stat',label:'Transfer rate',value:'8 MB/s'},{type:'stat',label:'Multiplier',value:'3.2x'}] })}, {width:960,hostFontSize:17})`)
  await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
  const compatibility = await evaluate(`(() => {
    const spans=[...document.querySelectorAll('span')]
    const value=label => spans.find(element=>element.textContent===label).nextElementSibling
    const grid=document.querySelector('div[style*="grid-template-columns"]')
    const children=[...grid.children].map(element=>({top:element.getBoundingClientRect().top,height:element.getBoundingClientRect().height}))
    return { numericPrefix:{text:value('Numeric prefix status').textContent,font:parseFloat(getComputedStyle(value('Numeric prefix status')).fontSize)}, currency:{text:value('Currency amount').textContent,font:parseFloat(getComputedStyle(value('Currency amount')).fontSize)}, compact:{text:value('Compact number').textContent,font:parseFloat(getComputedStyle(value('Compact number')).fontSize)}, scientific:value('Scientific notation').textContent, localized:value('Localized decimal').textContent, metrics:['Bottle count','Transfer rate','Multiplier'].map(label=>({label,text:value(label).textContent,font:parseFloat(getComputedStyle(value(label)).fontSize),units:[...value(label).querySelectorAll('span')].map(element=>({text:element.textContent,font:parseFloat(getComputedStyle(element).fontSize)}))})), children }
  })()`)
  await writeFile(join(out, 'compatibility.png'), Buffer.from((await command('Page.captureScreenshot', {captureBeyondViewport:true})).data, 'base64'))
  assert.equal(compatibility.numericPrefix.text, '2 pages remain to be read')
  assert.ok(compatibility.numericPrefix.font <= 21.25, 'A numeric prefix must not turn a status sentence into a numeric stat')
  assert.equal(compatibility.currency.text, '¥1,024')
  assert.ok(compatibility.currency.font >= 22, 'Currency-prefixed numbers remain numeric stats')
  assert.equal(compatibility.compact.text, '1.2k')
  assert.ok(compatibility.compact.font >= 22, 'Compact numbers remain numeric stats')
  assert.equal(compatibility.scientific, '1e6')
  assert.equal(compatibility.localized, '1,6328$')
  for (const [index, expected] of ['20瓶', '8MB/s', '3.2x'].entries()) {
    const metric = compatibility.metrics[index]
    assert.equal(metric.text, expected)
    assert.ok(metric.font >= 22, `${metric.label}: arbitrary metric units retain numeric emphasis`)
    assert.ok(metric.units.some(unit => unit.font < metric.font), `${metric.label}: unit remains smaller than its number`)
  }
  assert.ok(Math.abs(compatibility.children[0].top - compatibility.children[1].top) <= 1 && compatibility.children[0].height < compatibility.children[1].height, 'Nonstat grid items retain start alignment')
  assert.deepEqual(await evaluate('window.genuiPresentation.events'), [], 'Compatibility mounts emit no actions')
  const deltaCases = [
    { text:'+3.2%', color:'rgb(17, 128, 68)' },
    { text:'−2%', color:'rgb(176, 36, 36)' },
    ...['+2 待核对', '+2 pending', '−2 pending', '未完成', '未知'].map(text => ({ text, color:'rgb(78, 83, 92)' })),
  ]
  const deltaResults = []
  for (const type of ['stat', 'hero']) {
    const items = deltaCases.map(({text}) => type === 'stat'
      ? {type, label:text, value:'2', delta:text}
      : {type, title:'Change', value:'2', delta:text})
    await evaluate(`window.genuiPresentation.mount(${JSON.stringify({items})})`)
    await waitFor("[...document.querySelectorAll('span')].filter(element => element.className.includes('heroValue')).every(element => element.textContent === '2')", 'numeric change fixture settles')
    const colors = await evaluate(`(() => {
      const root = document.querySelector('#root')
      root.style.setProperty('--dsw-alias-state-success-secondary', '#118044')
      root.style.setProperty('--dsw-alias-state-error-primary', '#b02424')
      root.style.setProperty('--dsw-alias-label-secondary', '#4e535c')
      return [...root.querySelectorAll('span')].filter(element => element.className.includes('statDelta')).map(delta => ({text:delta.textContent, color:getComputedStyle(delta).color}))
    })()`)
    await writeFile(join(out, `delta-${type}.png`), Buffer.from((await command('Page.captureScreenshot', {captureBeyondViewport:true})).data, 'base64'))
    assert.deepEqual(colors, deltaCases, `${type}: only fully numeric changes receive positive or negative colors`)
    deltaResults.push({type, colors})
  }
  assert.deepEqual(errors, [], 'Browser runtime errors')
  const tableStates = ['已完成', '未完成', '未知', '未通过', '不正常', 'inactive', 'broken', 'token', '正常', 'partial', '失败']
  await evaluate(`window.genuiPresentation.mount(${JSON.stringify({ items:[{type:'table',columns:['环节','状态'],types:['text','badge'],rows:tableStates.map((state, index) => [`环节 ${index + 1}`, state])}] })})`)
  const tableBadges = await evaluate(`(() => {
    const root = document.querySelector('#root')
    root.style.setProperty('--dsw-alias-state-success-secondary', '#118044')
    return [...root.querySelectorAll('tbody td:nth-child(2) > span')].map(element => ({text:element.textContent,color:getComputedStyle(element).color}))
  })()`)
  await writeFile(join(out, 'table-status-badges.png'), Buffer.from((await command('Page.captureScreenshot', {captureBeyondViewport:true})).data, 'base64'))
  assert.deepEqual(tableBadges.map(badge => badge.text), tableStates, 'Table badges preserve all status labels')
  for (const index of [0, 8]) assert.equal(tableBadges[index].color, 'rgb(17, 128, 68)', `${tableStates[index]} retains success semantics`)
  for (const index of [1, 2, 3, 4, 5, 6, 7]) assert.notEqual(tableBadges[index].color, 'rgb(17, 128, 68)', `${tableStates[index]} must not inherit success from a substring`)
  const failures = results.flatMap(result => result.failures.map(failure => ({ id:result.id, width:result.width, hostFontSize:result.hostFontSize, ...failure })))
  await writeFile(join(out, 'result.json'), JSON.stringify({ passed:failures.length === 0, browser:version, dataScope:fixtures.dataScope, provenance:fixtures.provenance, results, compatibility, deltaResults, tableBadges, failures }, null, 2) + '\n')
  console.log(JSON.stringify({ passed:failures.length === 0, cells:results.length, failures:failures.length, criteria:[...new Set(failures.map(failure => failure.criterion))], out }))
  assert.equal(failures.length, 0, `Business presentation criteria failed; see ${join(out, 'result.json')}`)
} catch (error) {
  await writeFile(join(out, 'failure.json'), JSON.stringify({ passed:false, error:error instanceof Error ? error.stack : String(error) }, null, 2) + '\n')
  throw error
} finally {
  socket?.close()
  browser?.kill('SIGTERM')
  for (let i = 0; i < 30 && browser?.exitCode === null; i++) await pause(100)
  if (browser?.exitCode === null) browser.kill('SIGKILL')
  await server.close()
  await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
