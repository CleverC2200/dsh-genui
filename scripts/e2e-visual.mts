#!/usr/bin/env node

import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, readdirSync } from 'node:fs'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { createServer } from 'node:net'

import { gallerySpec } from '../src/client/gallery.ts'

const SCRIPT_PATH = resolve(process.argv[1] ?? '')
const REPO_ROOT = dirname(SCRIPT_PATH).endsWith('scripts')
  ? resolve(dirname(SCRIPT_PATH), '..')
  : resolve(process.cwd())

function resolveDshBin(): string {
  if (process.env.DSH_BIN !== undefined && process.env.DSH_BIN !== '') return process.env.DSH_BIN
  const found = spawnSync('which', ['dsh'], { encoding: 'utf8' }).stdout?.trim()
  return found !== undefined && found !== '' ? found : 'dsh'
}
const DSH_BIN = resolveDshBin()
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i === -1 ? undefined : process.argv[i + 1]
}
const PORT = Number(arg('--port') ?? 3098)
const KEEP = process.argv.includes('--keep')
const OUT_DIR = resolve(arg('--out') ?? join(REPO_ROOT, '.e2e-artifacts'))

const PLUGIN_SPEC = process.env.E2E_PLUGIN_SPEC ?? `link:${REPO_ROOT}`

const fail = (msg: string): never => { console.error(`✗ ${msg}`); process.exit(1) }
const log = (msg: string): void => console.log(`· ${msg}`)

function findDshWebUrl(output: string): string | undefined {
  return output.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+(?:\/\?token=[A-Za-z0-9_-]+)?)/u)?.[1]
}

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fail(`非法端口: ${PORT}`)
await new Promise(res => {
  const probe = createServer()
  probe.once('error', () => fail(`端口 ${PORT} 已被占用，请用 --port 换一个`))
  probe.listen(PORT, '127.0.0.1', () => probe.close(res))
})

async function loadPlaywright(): Promise<{ chromium: any }> {
  const candidates = [
    process.env.PLAYWRIGHT_PATH,
    join(homedir(), '.nvm/versions/node', `v${process.versions.node}`, 'lib/node_modules/agent-browser/node_modules/playwright-core/index.mjs'),
    join(REPO_ROOT, 'node_modules/playwright-core/index.mjs'),
    join(REPO_ROOT, 'node_modules/playwright/index.mjs'),
  ].filter((p): p is string => p !== undefined)
  for (const p of candidates) {
    try {
      return await import(p)
    } catch (e) {
      console.error(`· playwright 候选失败 ${p} → ${(e as Error).message}`)
    }
  }
  throw new Error('未找到 playwright-core（可设 PLAYWRIGHT_PATH 指定 index.mjs）')
}

function discoverCachedChromium(): string | undefined {
  const bases = process.platform === 'darwin'
    ? [join(homedir(), 'Library/Caches/ms-playwright')]
    : [join(homedir(), '.cache/ms-playwright')]
  for (const base of bases) {
    if (!existsSync(base)) continue
    const builds = readdirSync(base)
      .filter(n => /^chromium-\d+$/.test(n))
      .sort((a, b) => Number(b.slice('chromium-'.length)) - Number(a.slice('chromium-'.length)))
    for (const build of builds) {
      const dir = join(base, build)
      const binaries = [
        join(dir, 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        join(dir, 'chrome-mac/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
        join(dir, 'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium'),
        join(dir, 'chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
        join(dir, 'chrome-linux/chrome'),
      ]
      const hit = binaries.find(p => existsSync(p))
      if (hit !== undefined) return hit
    }
  }
  return undefined
}

async function launchBrowser(chromium: any) {
  const exe = process.env.E2E_CHROMIUM
  if (exe !== undefined && exe !== '') {
    log(`浏览器：E2E_CHROMIUM → ${exe}`)
    return chromium.launch({ executablePath: exe, headless: true })
  }
  try {
    return await chromium.launch({ channel: 'chrome', headless: true })
  } catch {                       }
  try {
    return await chromium.launch({ headless: true })
  } catch {                          }
  const cached = discoverCachedChromium()
  if (cached === undefined) fail('系统无 Chrome，ms-playwright 缓存里也没有可用的 chromium-* 构建（可设 E2E_CHROMIUM 指定可执行文件）')
  log(`使用 ms-playwright 缓存构建：${cached}`)
  return chromium.launch({ executablePath: cached, headless: true })
}

async function dismissHostOverlays(page: any): Promise<void> {
  const onboarding = page.getByRole('button', { name: /继续|我知道了|开始使用|进入/ })
  if (await onboarding.count() > 0) {
    await onboarding.first().click().catch(() => {})
    await page.waitForTimeout(500)
  }
  const masks = await page.evaluate(() => {
    const found = document.querySelectorAll('[class*="_mask_"], [role="presentation"]')
    for (const el of found) el.remove()
    return found.length
  })
  if (masks > 0) log(`已移除 ${masks} 个遮罩节点`)
}

const DSH_HOME = await mkdtemp(join(tmpdir(), 'dsh-visual-'))
const env = { ...process.env, DSH_HOME }
const webLog = join(DSH_HOME, 'web.log')
let webChild: ReturnType<typeof spawn> | null = null

let browser: any = null

const killWeb = (): void => {
  if (webChild === null) return
  try { process.kill(-webChild.pid!, 'SIGTERM') } catch {            }
  try { process.kill(webChild.pid!, 'SIGTERM') } catch {            }
  webChild = null
}
const cleanup = async (): Promise<void> => {
  killWeb()
  if (!KEEP) await rm(DSH_HOME, { recursive: true, force: true })
  else log(`保留临时环境: ${DSH_HOME}`)
}

try {
  await mkdir(OUT_DIR, { recursive: true })

  log(`安装插件（${PLUGIN_SPEC}）...`)
  const add = spawnSync(DSH_BIN, ['plugin', '--profile', 'web', 'add', PLUGIN_SPEC], { env, stdio: 'inherit' })
  if (add.status !== 0) throw new Error('插件安装失败（见上方输出）')

  log(`启动 dsh web (port ${PORT})...`)
  const logStream = createWriteStream(webLog, { flags: 'a' })
  webChild = spawn(DSH_BIN, ['--profile', 'web', '--port', String(PORT), '--no-open'], {
    env, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  })
  const BASE = `http://127.0.0.1:${PORT}`

  let webOutput = ''
  webChild.stdout!.on('data', (chunk: Buffer) => { webOutput += String(chunk) })
  webChild.stdout!.pipe(logStream)
  webChild.stderr!.pipe(logStream)

  let ready = false
  let launchUrl = BASE
  let sessionCookie: string | undefined
  for (let i = 0; i < 120; i++) {
    if (webChild.exitCode !== null) break
    const found = findDshWebUrl(webOutput)
    if (found !== undefined) {
      launchUrl = found
      try {
        const res = await fetch(found, { redirect: 'manual' })
        if (res.status === 303 || res.ok) {
          sessionCookie = res.headers.get('set-cookie')?.split(';')[0]
          ready = true
          break
        }
      } catch {               }
    }
    await new Promise(r => setTimeout(r, 1000))
  }
  if (!ready) {
    const tail = await (await import('node:fs/promises')).readFile(webLog, 'utf8').catch(() => '')
    console.error(tail.split('\n').slice(-30).join('\n'))
    throw new Error(`dsh web 120s 内未就绪（日志: ${webLog}）`)
  }
  log('dsh web 就绪')

  const indexRes = await fetch(`${BASE}/`, { headers: sessionCookie === undefined ? {} : { cookie: sessionCookie } })
  if (!indexRes.ok) throw new Error(`index 返回 ${indexRes.status}`)
  const indexHtml = await indexRes.text()
  if (!indexHtml.includes('@changfenhuang/dsh-genui/client.js')) {
    throw new Error('genui 客户端 bundle 未出现在 boot graph 中（插件未注册 client 半边？）')
  }
  log('✓ 客户端 bundle 已在 boot graph 中')

  const { chromium } = await loadPlaywright()
  browser = await launchBrowser(chromium)

  const page = await browser.newPage({ viewport: { width: 1440, height: 3000 }, locale: 'zh-CN' })
  const pageErrors: string[] = []
  page.on('pageerror', e => pageErrors.push(String(e)))

  const assetRequests: string[] = []
  page.on('request', req => {
    const url = req.url()
    const match = /\/assets\/([a-z-]+\.js)/.exec(url)
    if (match !== null) assetRequests.push(match[1]!)
  })
  const consoleLines: string[] = []
  page.on('console', msg => consoleLines.push(`${msg.type()}: ${msg.text()}`))

  await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await page.waitForTimeout(5000)
  await dismissHostOverlays(page)

  const visualSpec = {
    ...gallerySpec,
    items: [...gallerySpec.items, {
      type: 'chart' as const,
      kind: 'bars' as const,
      data: [],
      stacked: true,
      series: [
        { label: 'Issue 206 A', data: [{ label: '回归最大值', value: 30 }, { label: '回归一半', value: 10 }] },
        { label: 'Issue 206 B', data: [{ label: '回归最大值', value: 10 }, { label: '回归一半', value: 10 }] },
      ],
    }],
  }
  await page.evaluate((specJson: string) => {
    const host = document.createElement('div')
    host.className = 'md-code-block'
    host.setAttribute('data-visual-inject', '1')
    const label = document.createElement('div')
    label.textContent = 'dsh-ui'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = specJson
    pre.appendChild(code)
    host.append(label, pre)
    const mount = document.querySelector('[data-chat-flow]') ?? document.body
    mount.appendChild(host)
  }, JSON.stringify(visualSpec))

  let blocks = 0
  for (let i = 0; i < 30; i++) {
    blocks = await page.evaluate(() => document.querySelectorAll('[data-genui]').length)
    if (blocks > 0) break
    await new Promise(r => setTimeout(r, 1000))
  }
  if (blocks === 0) {
    await page.screenshot({ path: join(OUT_DIR, 'visual-fail.png'), fullPage: true })
    const genuiLog = consoleLines.filter(l => l.includes('genui')).slice(0, 6).join(' | ')
    const otherLog = consoleLines.slice(-14).join('\n    ')
    const diag = await page.evaluate(() => ({
      injected: document.querySelectorAll('[data-visual-inject]').length,
      containers: document.querySelectorAll('.genui-dom-fence').length,
      genuiRoots: document.querySelectorAll('[data-genui]').length,
      hidden: document.querySelectorAll('.md-code-block[style*="display: none"]').length,
      containerHtml: document.querySelector('.genui-dom-fence')?.innerHTML.slice(0, 300) ?? 'none',
      processed: document.querySelector('[data-visual-inject]')?.hasAttribute('data-genui-rendered') ?? null,
      codeBlocks: document.querySelectorAll('.md-code-block').length,
    }))
    throw new Error(`30s 内画廊未渲染（pageerrors: ${pageErrors.slice(0, 3).join(' | ') || '无'}；genui: ${genuiLog || '无'}；其他 console: ${otherLog || '无'}；diag: ${JSON.stringify(diag)}）`)
  }
  log(`✓ 画廊渲染成功（${blocks} 个 data-genui 块）`)

  await page.waitForTimeout(6000)
  await page.screenshot({ path: join(OUT_DIR, 'gallery.png'), fullPage: true })
  log(`✓ 截图 gallery.png`)

  async function captureMatrixShot(name: string, dark: boolean, width: number): Promise<void> {
    await page.setViewportSize({ width, height: 3000 })
    await page.evaluate((isDark: boolean) => {
      if (isDark) document.body.setAttribute('data-ds-dark-theme', '')
      else document.body.removeAttribute('data-ds-dark-theme')
    }, dark)
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(OUT_DIR, name), fullPage: true })
    log(`✓ 截图 ${name}`)
  }
  await captureMatrixShot('gallery-dark.png', true, 1440)
  await captureMatrixShot('gallery-narrow.png', false, 560)
  await captureMatrixShot('gallery-dark-narrow.png', true, 560)
  await page.setViewportSize({ width: 1440, height: 3000 })
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await page.waitForTimeout(400)

  const parts: Array<[string, string]> = [
    ['steps', '[class*="steps"]'],
    ['timeline', '[class*="timeline"]'],
    ['mermaid', '[data-genui] svg[id^="mermaid"], [class*="mermaid"] svg'],
    ['diagram', '[class*="diagram"]'],
    ['quiz', '[class*="quiz"]'],
    ['media', '[class*="media"]'],
    ['kv', '[class*="kvRow"]'],
    ['controls', '[class*="input"], [class*="select"], [class*="textarea"]'],
  ]
  for (const [name, selector] of parts) {
    const el = await page.$(selector)
    if (el === null) continue
    await el.scrollIntoViewIfNeeded()
    await page.waitForTimeout(250)
    await el.screenshot({ path: join(OUT_DIR, `part-${name}.png`) }).catch(() => {})
  }
  log(`✓ 组件逐个截图：${parts.map(p => p[0]).join(' / ')}`)

  await page.evaluate(() => {
    const row = document.createElement('div')
    row.setAttribute('data-chat-anchor-key', 'e2e-skeleton:0')
    row.setAttribute('data-chat-flow-kind', 'assistant-step')
    row.setAttribute('data-streaming', '')
    const block = document.createElement('div')
    block.className = 'md-code-block'
    block.setAttribute('data-visual-skeleton', '1')
    const label = document.createElement('div')
    label.textContent = 'dsh-ui'
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    code.textContent = '{"items":[{"type":"stat","label":"CPU","value":"42%'
    pre.appendChild(code)
    block.append(label, pre)
    row.appendChild(block)
    ;(document.querySelector('[data-chat-flow]') ?? document.body).appendChild(row)
  })
  await page.waitForTimeout(2500)
  const skeleton = await page.evaluate(() => ({
    skeleton: document.querySelectorAll('.genui-dom-fence [class*="skeleton"]').length,
    rawVisible: document.querySelector('[data-visual-skeleton]')?.getAttribute('style') ?? '',
  }))
  if (skeleton.skeleton === 0) throw new Error(`流式骨架未出现（${JSON.stringify(skeleton)}）`)
  await page.evaluate(() => { document.querySelector('[data-chat-anchor-key="e2e-skeleton:0"]')?.removeAttribute('data-streaming') })
  await page.waitForTimeout(1800)

  const restored = await page.evaluate(() => {
    const block = document.querySelector('[data-visual-skeleton]')
    const container = document.querySelector('.genui-dom-fence')
    return {
      skeletons: document.querySelectorAll('.genui-dom-fence [class*="skeleton"]').length,
      hidden: block?.getAttribute('style')?.includes('display: none') ?? false,
      text: container?.textContent ?? '',
    }
  })
  if (restored.skeletons !== 0 || !restored.hidden || !restored.text.includes('CPU')) {
    throw new Error(`骨架未在 settle 后换成真组件（${JSON.stringify(restored)}）`)
  }
  log('✓ 流式骨架：出现 → settle 后换成真组件')

  if (assetRequests.includes('echarts-core.js')) {
    if (!assetRequests.includes('echarts-full.js')) {
      throw new Error(`radar/sankey 采样在场却没拉完整引擎（请求：${assetRequests.join(', ')}）`)
    }
    log(`✓ 引擎按需：${[...new Set(assetRequests)].join(' + ')}`)
  }

  const filterInput = page.getByPlaceholder('输入关键字即时过滤下表')
  if (await filterInput.count() > 0) {
    const before = await page.locator('table tbody tr').count()
    await filterInput.fill('搜索')
    await page.waitForTimeout(400)
    const after = await page.locator('table tbody tr').count()
    if (!(after < before)) throw new Error(`绑定筛选未生效（${before} → ${after} 行）`)
    await filterInput.fill('')
    await page.waitForTimeout(300)
    const restored = await page.locator('table tbody tr').count()
    if (restored !== before) throw new Error(`清空筛选后未恢复（期望 ${before}，实际 ${restored}）`)
    log(`✓ 本地筛选：${before} → ${after} → ${restored} 行`)
  }

  const treeCheck = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('[class*="ftRow"]')] as HTMLElement[]
    if (rows.length < 2) return { ok: false, reason: `只有 ${rows.length} 行` }
    const [first, second] = rows as [HTMLElement, HTMLElement]
    const a = first.getBoundingClientRect()
    const b = second.getBoundingClientRect()
    return {
      ok: b.top >= a.bottom - 1,
      reason: `parent.top=${Math.round(a.top)} parent.bottom=${Math.round(a.bottom)} child.top=${Math.round(b.top)}`,
      rows: rows.length,
      guides: document.querySelectorAll('[class*="ftGuide"]').length,
      glyphs: document.querySelectorAll('[class*="ftGlyph"] svg').length,
    }
  })
  if (!treeCheck.ok) throw new Error(`文件树没有纵向堆叠（${treeCheck.reason}）`)
  log(`✓ 文件树：${treeCheck.rows} 行纵向堆叠 · ${treeCheck.guides} 条层级引导线 · ${treeCheck.glyphs} 个图标`)

  const accentSurface = await page.evaluate(() => {

    const accentEl = document.querySelector('[style*="--dsl-card-accent"]') as HTMLElement | null
    const row = accentEl?.parentElement ?? null
    const plainEl = row === null
      ? null
      : [...row.children].find(child => child !== accentEl
        && !(child.getAttribute('style') ?? '').includes('--dsl-card-accent')) as HTMLElement | undefined
    if (accentEl === null || plainEl === undefined || plainEl === null) return { ok: true, skipped: true }
    const accent = accentEl
    const plain = plainEl

    return {
      ok: getComputedStyle(accent).backgroundColor === getComputedStyle(plain).backgroundColor,
      skipped: false,
      accent: getComputedStyle(accent).backgroundColor,
      plain: getComputedStyle(plain).backgroundColor,
      border: getComputedStyle(accent).borderTopColor,
    }
  })
  if (!accentSurface.ok) {
    throw new Error(`accent 卡片表面被染色（accent=${accentSurface.accent} / 普通=${accentSurface.plain}）`)
  }
  if (!accentSurface.skipped) {
    log(`✓ accent 卡片：表面 ${accentSurface.accent}（与普通卡片一致）· 描边 ${accentSurface.border}`)
  }

  const surfaces = await page.evaluate(() => {

    const candidates = [...document.querySelectorAll('[class*="_stat"]')] as HTMLElement[]
    const stat = candidates.find(el => [...el.classList].some(name => name.endsWith('_stat'))) ?? null
    if (stat === null) return { ok: false as const, reason: '画廊里没有 stat 卡片' }

    let el: HTMLElement | null = stat.parentElement
    let pageEl: HTMLElement | null = null
    while (el !== null) {
      const bg = getComputedStyle(el).backgroundColor
      if (bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') pageEl = el
      el = el.parentElement
    }
    const wasDark = document.body.hasAttribute('data-ds-dark-theme')
    document.body.removeAttribute('data-ds-dark-theme')
    const lightCard = getComputedStyle(stat).backgroundColor
    const lightPage = pageEl === null ? 'rgb(255, 255, 255)' : getComputedStyle(pageEl).backgroundColor
    document.body.setAttribute('data-ds-dark-theme', '')
    const darkCard = getComputedStyle(stat).backgroundColor
    const darkPage = pageEl === null ? 'rgb(21, 21, 23)' : getComputedStyle(pageEl).backgroundColor
    if (!wasDark) document.body.removeAttribute('data-ds-dark-theme')
    return {
      ok: true as const,
      className: stat.className,
      lightCard,
      lightPage,
      darkCard,
      darkPage,
      border: getComputedStyle(stat).borderTopColor,
    }
  })
  if (!surfaces.ok) throw new Error(`表面方向检查无法执行：${surfaces.reason}`)

  const meanChannel = (value: string): number => {
    const numbers = (value.match(/[\d.]+/g) ?? []).map(Number)
    const scale = value.startsWith('color(') ? 255 : 1
    return ((numbers[0] ?? 0) + (numbers[1] ?? 0) + (numbers[2] ?? 0)) / 3 * scale
  }

  const alphaOf = (value: string): number => {
    const numbers = (value.match(/[\d.]+/g) ?? []).map(Number)
    return numbers.length >= 4 ? (numbers[3] ?? 1) : 1
  }
  for (const [theme, colour] of [['浅色', surfaces.lightCard], ['深色', surfaces.darkCard]] as const) {
    if (alphaOf(colour) < 1) {
      throw new Error(`${theme}量到的不是卡片本体（背景半透明 ${colour}，选中 ${surfaces.className}）—— 选择器命中了嵌套元素`)
    }
  }
  const lightStep = meanChannel(surfaces.lightCard) - meanChannel(surfaces.lightPage)
  const darkStep = meanChannel(surfaces.darkCard) - meanChannel(surfaces.darkPage)
  if (lightStep < 0) {
    throw new Error(`浅色卡片比页面暗 ${(-lightStep).toFixed(1)} 级（卡面 ${surfaces.lightCard} / 页面 ${surfaces.lightPage}）—— 抬升必须靠描边与阴影，不许把白卡压灰（issue #159）`)
  }
  if (darkStep <= 8) {
    throw new Error(`深色卡片抬升不足（卡面 ${surfaces.darkCard} / 页面 ${surfaces.darkPage}）`)
  }
  log(`✓ 表面方向：浅色 ${lightStep >= 0 ? '+' : ''}${lightStep.toFixed(1)} 级（卡面 ${surfaces.lightCard} / 页面 ${surfaces.lightPage}）· 深色 +${darkStep.toFixed(1)} 级（卡面 ${surfaces.darkCard} / 页面 ${surfaces.darkPage}）· 描边 ${surfaces.border}`)

  const hueCheck = await page.evaluate(() => {
    const canvases = [...document.querySelectorAll('[data-genui-echart] canvas')] as HTMLCanvasElement[]
    const target = canvases[1] ?? canvases[0]
    if (target === undefined) return { ok: false, reason: '没有 canvas' }
    const ctx = target.getContext('2d')
    if (ctx === null) return { ok: false, reason: '没有 2d 上下文' }
    const { data } = ctx.getImageData(0, 0, target.width, target.height)
    const hues = new Set<string>()
    let saturated = 0
    for (let i = 0; i < data.length; i += 4 * 37) {
      const r = data[i] ?? 0
      const g = data[i + 1] ?? 0
      const b = data[i + 2] ?? 0
      if ((data[i + 3] ?? 0) < 200) continue

      if (Math.max(r, g, b) - Math.min(r, g, b) < 40) continue
      saturated += 1
      hues.add(`${r >> 5}-${g >> 5}-${b >> 5}`)
    }

    return { ok: hues.size >= 2 && saturated >= 20, hues: hues.size, saturated, canvases: canvases.length }
  })
  if (!hueCheck.ok) throw new Error(`ECharts 配色异常（${JSON.stringify(hueCheck)}）`)
  log(`✓ ECharts 配色：${hueCheck.canvases} 张画布，雷达图 ${hueCheck.hues} 种饱和色（${hueCheck.saturated} 像素）`)

  await dismissHostOverlays(page)
  const stackSeg = page.locator('[class*="stackSeg"]').first()
  if (await stackSeg.count() > 0) {
    await stackSeg.hover()
    await page.waitForTimeout(300)
    const tipText = await page.locator('[class*="chartTip"]').first().textContent().catch(() => null)
    if (tipText === null || !tipText.includes('合计')) {
      throw new Error(`堆叠段 hover 未弹出明细 tooltip（${String(tipText)}）`)
    }
    log(`✓ 图表 tooltip：${tipText.replace(/\s+/g, ' ').trim()}`)
  }

  await dismissHostOverlays(page)
  const regressionChart = page.locator('[data-genui-chart="bars"]').filter({ hasText: 'Issue 206' }).first()
  const regressionStacks = regressionChart.locator('[class*="barCol"] > [class*="stack"]:not([class*="stackSeg"]):not([class*="stackValue"])')
  if (await regressionStacks.count() !== 2) throw new Error('Issue #206 回归图表未渲染出两根堆叠柱')
  const regressionPlot = regressionChart.locator('[class*="chartPlot"]')
  const plotBox = await regressionPlot.boundingBox()
  for (const stack of await regressionStacks.all()) {
    const stackBox = await stack.boundingBox()
    if (stackBox === null || plotBox === null) throw new Error('Issue #206 回归图表缺少绘图区几何信息')
    if (stackBox.y < plotBox.y - 1) {
      throw new Error(`堆叠柱越出绘图区：stack top=${stackBox.y}, plot top=${plotBox.y}`)
    }
    if (stackBox.y + stackBox.height > plotBox.y + plotBox.height + 1) {
      throw new Error('堆叠柱越出绘图区底部')
    }
  }
  log('✓ Issue #206 堆叠柱均处于绘图区范围内')

  const clicked = await page.evaluate(() => {
    const out: string[] = []

    const ths = [...document.querySelectorAll('[data-genui] thead th button')]
    const q1 = ths.find(b => b.textContent?.includes('Q1'))
    if (q1) { (q1 as HTMLButtonElement).click(); out.push('sort-clicked=Q1') }

    const quizBtns = [...document.querySelectorAll('[data-genui-quiz] button')]
    const correct = quizBtns.find(b => b.textContent?.includes('2') && !b.textContent?.includes('二进制'))
    if (correct) { (correct as HTMLButtonElement).click(); out.push('quiz-clicked=2') }

    const dirBtn = [...document.querySelectorAll<HTMLElement>('[data-genui] button[aria-expanded="true"]')]
      .find(b => b.textContent?.includes('src'))
    if (dirBtn) { dirBtn.click(); out.push('tree-clicked=src') }
    return out
  })
  await page.waitForTimeout(600)
  const interacted = await page.evaluate(() => {
    const out: string[] = []

    const rows = [...document.querySelectorAll('[data-genui] tbody tr')].map(tr => tr.textContent ?? '')
    const firstRow = rows[0] ?? ''
    out.push(`sort-first=${firstRow.includes('错误率') ? '错误率' : '?'}`)
    const q1th = document.querySelectorAll('[data-genui] thead th')[1]
    out.push(`sort-aria=${q1th?.getAttribute('aria-sort') ?? '?'}`)

    out.push('quiz-correct=' + String(document.querySelector('[data-genui-quiz]')?.textContent?.includes('回答正确')))

    const srcDir = [...document.querySelectorAll<HTMLElement>('[data-genui] button[aria-expanded]')]
      .find(b => b.textContent?.includes('src'))
    out.push('tree-collapsed=' + String(srcDir?.getAttribute('aria-expanded') === 'false'))

    out.push('tdNum=' + String(document.querySelectorAll('[data-genui] td[class*="tdNum"]').length))
    return out
  })
  log(`交互检查: ${interacted.join(' · ')}`)

  const mustPass = [
    ['sort-first=错误率', '数值感知排序'],
    ['sort-aria=ascending', '排序 aria 标记'],
    ['quiz-correct=true', '本地判题'],
    ['tree-collapsed=true', '目录折叠'],
  ]
  for (const [expectation, label] of mustPass) {
    if (!interacted.includes(expectation)) throw new Error(`交互断言失败: ${label}（期望 ${expectation}，实际 ${interacted.join(' · ')}）`)
  }
  if (!interacted.some(s => s.startsWith('tdNum=') && Number(s.slice(6)) > 0)) throw new Error('交互断言失败: 数值列右对齐类名缺失')
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT_DIR, 'interactions.png'), fullPage: true })
  log(`✓ 截图 interactions.png`)

  if (pageErrors.length > 0) throw new Error(`页面异常: ${pageErrors.slice(0, 3).join(' | ')}`)
  await browser.close()
  await cleanup()
  console.log('PASS 视觉 e2e：画廊渲染 + 本地交互 + 无页面异常')
  process.exit(0)
} catch (e) {
  console.error('✗ e2e 异常:', e)
  await browser?.close().catch(() => {})
  await cleanup()
  process.exit(1)
}
