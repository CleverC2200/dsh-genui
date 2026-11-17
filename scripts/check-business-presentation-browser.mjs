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
  const modelCards = JSON.parse(await readFile(join(root, 'tests/fixtures/model-card-layout.json'), 'utf8'))
  const modelCardResults = []
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
  for (const input of modelCards.cases) for (const [viewportWidth, width] of [[1024, 640], [1440, 960]]) for (const hostFontSize of [14, 17, 22]) {
    await command('Emulation.setDeviceMetricsOverride', { width:viewportWidth, height:1000, deviceScaleFactor:1, mobile:false })
    await evaluate(`window.genuiPresentation.mount(${JSON.stringify(input.spec)}, ${JSON.stringify({ width, hostFontSize })})`)
    await evaluate('document.fonts.ready.then(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))')
    const measured = await evaluate(`(${measureCards.toString()})(${JSON.stringify(input)})`)
    const screenshot = `model-${input.id}-${width}-${hostFontSize}.png`
    const layout = await command('Page.getLayoutMetrics')
    await writeFile(join(out, screenshot), Buffer.from((await command('Page.captureScreenshot', { captureBeyondViewport:true, clip:{ x:0, y:0, width:viewportWidth, height:Math.ceil(layout.cssContentSize.height), scale:1 } })).data, 'base64'))
    assert.deepEqual(await evaluate('window.genuiPresentation.events'), [], 'Card layout replay must not dispatch actions')
    modelCardResults.push({ id:input.id, provenance:input.provenance, width, viewportWidth, hostFontSize, screenshot, ...measured })
  }
  const resizeSpec = { items:[
    {type:'grid',cols:3,items:['12 箱','9876 箱','3.25 箱'].map((value,index) => ({type:'card',title:`指标 ${index + 1}`,items:[{type:'stat',label:'数量',value}]}))},
    {type:'grid',cols:2,items:[{type:'card',title:'草稿',items:[{type:'input',id:'draft',label:'备注'}]},{type:'card',title:'阅读提示',items:[{type:'text',content:'保留草稿并按原顺序提交'}]}]},
    {type:'grid',cols:2,items:[{type:'card',title:'图表',items:[{type:'chart',data:[{label:'A',value:1}]}]},{type:'card',title:'图表说明',items:[{type:'text',content:'图表原有布局'}]}]},
    {type:'submit',label:'提交草稿',action:'submit_layout'},
  ] }
  await evaluate(`window.genuiPresentation.mount(${JSON.stringify(resizeSpec)}, {width:960,hostFontSize:17})`)
  await evaluate(`(() => {
    const input = document.querySelector('input')
    window.layoutInput = input
    input.focus()
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '保留的草稿')
    input.dispatchEvent(new Event('input', {bubbles:true}))
  })()`)
  for (const width of [640, 960]) {
    await evaluate(`window.genuiPresentation.mount(${JSON.stringify(resizeSpec)}, {width:${width},hostFontSize:22,reset:false})`)
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
    assert.equal(await evaluate("document.querySelector('input') === window.layoutInput && document.activeElement === window.layoutInput && window.layoutInput.value === '保留的草稿'"), true, 'Resize preserves input identity, focus and draft')
    assert.deepEqual(await evaluate('window.genuiPresentation.events'), [], 'Resize emits no action')
  }
  const layoutInteractions = await evaluate(`(() => {
    const title = text => [...document.querySelectorAll('div')].find(element => element.textContent === text)
    const bounds = text => title(text).parentElement.getBoundingClientRect().toJSON()
    return {draft:window.layoutInput.value, form:[bounds('草稿'),bounds('阅读提示')], graphics:[bounds('图表'),bounds('图表说明')]}
  })()`)
  for (const pair of [layoutInteractions.form, layoutInteractions.graphics]) assert.ok(Math.abs(pair[0].top - pair[1].top) <= 1 && Math.abs(pair[0].width - pair[1].width) <= 1 && pair[0].width < 600, 'Interactive and graphical card layouts retain their existing columns')
  await evaluate("[...document.querySelectorAll('button')].find(button => button.textContent === '提交草稿').click()")
  layoutInteractions.events = await evaluate('window.genuiPresentation.events')
  assert.equal(layoutInteractions.events.length, 1, 'One submit dispatches one action')
  assert.equal(layoutInteractions.events[0].action, 'submit_layout')
  assert.equal(layoutInteractions.events[0].payload.fields.draft, '保留的草稿')
  const extreme = modelCards.cases.find(input => input.expectedNumericOverflow === true)
  await evaluate(`window.genuiPresentation.mount(${JSON.stringify(extreme.spec)}, {width:640,hostFontSize:22})`)
  await evaluate(`document.querySelector('[role="region"][tabindex="0"]').focus()`)
  for (const key of ['ArrowRight','ArrowLeft']) {
    for (let repeat = 0; repeat < 80; repeat++) {
      await command('Input.dispatchKeyEvent', {type:'keyDown',key,code:key,windowsVirtualKeyCode:key === 'ArrowRight' ? 39 : 37})
      await command('Input.dispatchKeyEvent', {type:'keyUp',key,code:key,windowsVirtualKeyCode:key === 'ArrowRight' ? 39 : 37})
    }
    await pause(300)
    const scroll = await evaluate(`(() => {const region=document.activeElement;return {left:region.scrollLeft,max:region.scrollWidth-region.clientWidth}})()`)
    assert.ok(key === 'ArrowRight' ? scroll.left >= scroll.max - 1 : scroll.left <= 1, 'Keyboard reaches both ends of the complete numeric value')
  }
  layoutInteractions.extremeKeyboardScroll = true
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
  const failures = [...results, ...modelCardResults].flatMap(result => result.failures.map(failure => ({ id:result.id, width:result.width, hostFontSize:result.hostFontSize, ...failure })))
  await writeFile(join(out, 'result.json'), JSON.stringify({ passed:failures.length === 0, browser:version, dataScope:fixtures.dataScope, provenance:fixtures.provenance, results, modelCardProvenance:{dataScope:modelCards.dataScope, ...modelCards.provenance}, modelCardResults, compatibility, layoutInteractions, deltaResults, tableBadges, failures }, null, 2) + '\n')
  console.log(JSON.stringify({ passed:failures.length === 0, cells:results.length + modelCardResults.length, failures:failures.length, criteria:[...new Set(failures.map(failure => failure.criterion))], out }))
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

function measureCards({ spec, expectedCards, expectedTexts, expectedCardLayout, expectedKeyValueLayout, expectedNumericOverflow, expectedStatLayout }) {
  const root = document.querySelector('#root')
  const failures = []
  const titles = []
  const collect = node => {
    if (!node || typeof node !== 'object') return
    if (node.type === 'card' && node.title && node.items?.length) titles.push(node.title)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(collect)
      else if (value && typeof value === 'object') collect(value)
    }
  }
  collect(spec)
  const compact = text => text.replace(/[\s,]/g, '')
  for (const expected of expectedTexts) {
    if (!compact(root.textContent).includes(compact(expected))) failures.push({ criterion:'model-card-content', expected })
  }
  if (titles.length !== expectedCards) failures.push({ criterion:'model-card-count', expected:expectedCards, actual:titles.length })
  const cardElements = []
  const cards = titles.map(title => {
    const label = [...root.querySelectorAll('*')].find(element => element.textContent === title && !element.children.length)
    let card = label?.parentElement
    while (card && card !== root && !(getComputedStyle(card).display === 'flex' && parseFloat(getComputedStyle(card).borderTopWidth) > 0)) card = card.parentElement
    if (!card || card === root) {
      failures.push({ criterion:'model-card-missing', title })
      return { title }
    }
    cardElements.push(card)
    const bounds = card.getBoundingClientRect()
    if (card.scrollWidth > card.clientWidth + 1) failures.push({ criterion:'model-card-overflow', title, scroll:card.scrollWidth, client:card.clientWidth })
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(walker.currentNode)
      const region = walker.currentNode.parentElement.closest('[role="region"][tabindex="0"]')
      const localNumericOverflow = expectedNumericOverflow === true && region?.scrollWidth > region?.clientWidth
        && region.getAttribute('aria-label') === spec.items[0].items[0].items[0].value
      for (const rect of range.getClientRects()) {
        if (localNumericOverflow) continue
        if (rect.left < bounds.left - 1 || rect.right > bounds.right + 1 || rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1) failures.push({ criterion:'model-card-text-containment', title })
        for (let parent = walker.currentNode.parentElement; parent && parent !== card; parent = parent.parentElement) {
          const clip = parent.getBoundingClientRect()
          if (['hidden', 'clip', 'auto', 'scroll'].includes(getComputedStyle(parent).overflowX) && (rect.left < clip.left - 1 || rect.right > clip.right + 1)) {
            failures.push({ criterion:'model-card-clipped-text', title })
            break
          }
        }
      }
    }
    return { title, bounds:bounds.toJSON(), scrollWidth:card.scrollWidth, clientWidth:card.clientWidth, text:card.textContent }
  })
  if (expectedStatLayout === 'metric-rows') {
    for (const stat of spec.items[0].items) {
      const label = [...root.querySelectorAll('span')].find(element => element.textContent === stat.label)
      const card = label.parentElement
      const value = label.nextElementSibling
      cardElements.push(card)
      cards.push({title:stat.label,bounds:card.getBoundingClientRect().toJSON()})
      if (value.scrollWidth > value.clientWidth + 1) failures.push({ criterion:'ordinary-numeric-needs-fullwidth', label:stat.label })
    }
  }
  let readingFlow
  if (expectedCardLayout === 'full-width-reading-flow' && cardElements.length === expectedCards) {
    let group = cardElements[0].parentElement
    while (group && !cardElements.every(card => group.contains(card))) group = group.parentElement
    const style = getComputedStyle(group)
    const availableWidth = group.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
    const fullWidth = cards.every(card => Math.abs(card.bounds.width - availableWidth) <= 1)
    const sequential = cards.every((card, index) => index === 0 || card.bounds.top >= cards[index - 1].bounds.bottom - 1)
    readingFlow = { availableWidth, fullWidth, sequential }
    if (!fullWidth || !sequential) failures.push({ criterion:'model-card-reading-flow', ...readingFlow, cards:cards.map(({ title, bounds }) => ({ title, bounds })) })
  }
  if (expectedCardLayout === 'metric-rows' && cards.every(card => card.bounds)) {
    const group = cardElements[0].parentElement
    for (let index = 0; index < cards.length; index++) {
      const card = cards[index]
      if (card.bounds.right > group.getBoundingClientRect().right + 1) failures.push({ criterion:'metric-implicit-track', title:card.title })
      for (const other of cards.slice(index + 1)) if (Math.abs(card.bounds.top - other.bounds.top) <= 1) {
        if (Math.abs(card.bounds.width - other.bounds.width) > 1 || Math.abs(card.bounds.bottom - other.bounds.bottom) > 1) failures.push({ criterion:'metric-row-alignment', title:card.title })
      }
      const stat = expectedStatLayout === 'metric-rows' ? spec.items[0].items[index] : spec.items[0].items[index].items[0]
      const label = [...cardElements[index].querySelectorAll('span')].find(element => element.textContent === stat.label)
      const value = label.nextElementSibling
      const walker = document.createTreeWalker(value, NodeFilter.SHOW_TEXT)
      walker.nextNode()
      const range = document.createRange()
      range.selectNodeContents(walker.currentNode)
      if (range.getClientRects().length !== 1) failures.push({ criterion:'metric-numeric-body', title:card.title })
    }
    const firstStat = expectedStatLayout === 'metric-rows' ? spec.items[0].items[0] : spec.items[0].items[0].items[0]
    if (firstStat.value === '12 箱' && group.clientWidth >= 600 && cards[0].bounds.top !== cards[1].bounds.top) failures.push({ criterion:'compact-metrics-share-row' })
    if (cards[0].bounds.width > group.clientWidth + 1) failures.push({ criterion:'metric-group-containment' })
  }
  if (expectedNumericOverflow === true) {
    const region = root.querySelector('[role="region"][tabindex="0"]')
    if (!region || region.scrollWidth <= region.clientWidth || getComputedStyle(region).overflowX !== 'auto' || parseFloat(getComputedStyle(region).fontSize) < 22) failures.push({ criterion:'extreme-accessible-local-scroll' })
    if (region) {
      const range = document.createRange()
      range.selectNodeContents(region)
      getSelection().removeAllRanges()
      getSelection().addRange(range)
      if (getSelection().toString() !== region.textContent) failures.push({ criterion:'extreme-complete-copy-selection' })
      getSelection().removeAllRanges()
    }
  }
  if (expectedKeyValueLayout === 'responsive') {
    const rows = [...root.querySelectorAll('dl > div')]
    const shortKey = rows[0].querySelector('dt').getBoundingClientRect()
    if (shortKey.width >= 100) failures.push({ criterion:'keyvalue-short-label-width', width:shortKey.width })
    for (const row of rows) {
      const key = row.querySelector('dt').getBoundingClientRect()
      const value = row.querySelector('dd').getBoundingClientRect()
      if (row.clientWidth < 300 && value.top < key.bottom - 1) failures.push({ criterion:'keyvalue-narrow-stack' })
    }
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) failures.push({ criterion:'model-card-page-overflow' })
  return { cards, readingFlow, failures }
}
