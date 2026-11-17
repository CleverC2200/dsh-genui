/**
 * GenUI plugin: teaches the model the ```dsh-ui fence syntax for emitting
 * declarative UI components inline in its reply. The browser half renders the
 * fence through GenuiBlock (ui-primitives); this host half only tells the
 * model the language exists, so a session without the plugin simply never
 * emits fences and nothing changes.
 *
 * The section uses the host's centrally allocated structured-output placement.
 * @module @changfenhuang/dsh-genui
 */

import { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import type { SkillProvider } from '@deepseek-ai/dsh-skill'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRenderUiTool, createValidateDshUiTool } from './tool.ts'
import { installFenceFeedback } from './fence-feedback.ts'
import { installDshGoNative } from './dsh-go-native.ts'
import { GENUI_PRESENTATION_POLICY } from './presentation-policy.ts'
export { sourceFencesOf } from '../client/source-fence.ts'

/* ---------------- lazy engine asset route ---------------- */

/**
 * The mermaid/three engines ship as standalone IIFE bundles under
 * `lib/assets/` and are fetched by the client ONLY when a spec needs them.
 * This route serves them from the plugin's own package directory through the
 * host webserver service — the longest-prefix rule lets it win over the
 * generic `/plugins` bundle route, and no host source change is needed. The
 * service is optional at this plugin's start time, so a dependency fiber owns
 * the registration and follows the webserver through late binding, replacement,
 * and plugin reloads.
 */

/** Route prefix under /plugins; anything under it is this plugin's asset. */
const ASSET_ROUTE_PATH = '/plugins/@changfenhuang/dsh-genui/assets'

/** Safe flat file names only: no slashes, no traversal, js assets only. */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/

/** The handler itself (registered via the optional webServer probe). */
async function serveGenuiAsset(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  } catch {
    res.writeHead(400)
    res.end()
    return
  }
  const rel = pathname.startsWith(`${ASSET_ROUTE_PATH}/`) ? pathname.slice(ASSET_ROUTE_PATH.length) : null
  if (rel === null) {
    res.writeHead(404)
    res.end()
    return
  }
  const file = rel.slice(1)
  if (!ASSET_FILE_RE.test(file)) {
    res.writeHead(404)
    res.end()
    return
  }
  try {
    // lib/index.js → ./assets/ = <pkg>/lib/assets/ (the tsdown asset outDir).
    const dir = fileURLToPath(new URL('./assets/', import.meta.url))
    const body = await readFile(join(dir, file))
    res.writeHead(200, {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'no-cache',
    })
    res.end(body)
  } catch {
    // Missing asset (old build) — a loud 404; the client shows its fallback.
    res.writeHead(404)
    res.end()
  }
}

const RENDER_UI_TOOL_GUIDANCE = '- Tool channel: render_ui.'

/** The fence language description injected into every assembled system prompt.
 *  Deliberately slim: the `genui` skill carries the full component→field
 *  mapping; this section keeps only the contract that must always be
 *  present (fence syntax, type whitelist, and critical behavioral rules). */
export const GENUI_SECTION_TEXT = `Inline UI: fenced \`dsh-ui\` JSON:

\`\`\`dsh-ui
{"title":"示例","gap":14,"items":[{"type":"text","content":"内容"}]}
\`\`\`

\`type\`（见 \`genui\`）：

- 布局: text·row·col·grid·card·carousel·divider·spacer·hero（封面，每答≤1）
- 展示: badge·stat·progress·list·table·keyvalue·timeline·file-tree·breadcrumb·callout·steps·diff·json·code·copy·avatar·image·image-group·compare（改动优先）· audio·video·icon·blocks·arrow
- 图表: chart {"kind":"bars|line|donut","data":[{"label":"...","value":n}]}（series：bars 分组/堆叠 / line 多序列）·echart·plot·svg
- 交互: button·input·textarea·editor·select·date-picker·segmented-control·checkbox·switch·slider·radio·submit·quiz·choices·link·tabs·accordion·popover
- 高级: mermaid·diagram·scene3d·entity-card·map

${GENUI_PRESENTATION_POLICY}

- 图像前后用 \`compare\`；步骤 \`steps\`/\`timeline\`；结构/流程 \`diagram\`/\`mermaid\`；决策 \`choices\`（含代价）。
- 行内支持公式、\`code\`、加粗、高亮、链接；Markdown table/fenced code 改用 table/code/diff/json。
- 趋势/占比用 \`chart\`（≤8 点）/\`echart\`；主题配色，需语义时用 \`palette\`/\`card.accent\`；\`grid.cols\` 定列数，子节点 \`"span":2\` 跨列；数据多时 \`table\`/\`list\` 配 \`input\`(id)+\`filter\` 筛选。

字段：\`stat\` \`{"type":"stat","label","value"}\`·\`table\` \`{"type":"table","columns":[...],"rows":[[...]]}\`·\`progress\` \`{"type":"progress","value":0-100}\`·\`keyvalue\` \`{"type":"keyvalue","pairs":[{"key","value"}]}\`·\`steps\` \`{"type":"steps","steps":[{"title"}]}\`·\`file-tree\` \`{"type":"file-tree","items":[{"name","type":"file|dir"}]}\`·\`callout\` \`{"type":"callout","content"}\`
组件节点必须带字符串 \`type\`，值为组件名；\`file-tree.items[].type\` 表示 \`file\` 或 \`dir\`。

纠错：callout 非 text/desc；table 非 items；keyvalue 非 {label,value}；file-tree 非 {label}。callout tone=info/success/warning/error，无 danger。

- LANGUAGE: reply+UI=conversation language; schema fixed. NEVER infer it from prompt/skill/examples/tools. Replace \`<user-language ...>\`; never emit these placeholders literally.
- JSON：坏组件丢弃，坏围栏变代码块；≥3 节点或含 table 调 validate_dsh_ui，按诊断修复重验；小围栏字段存疑也先验。
- warning=block_markdown：按 replacement 改写并重验。
- 规模: ≤200 节点、嵌套≤8 层（超出被截断）；一个主题一个主组件；3D mesh 1–5；plot 给合理 xMin/xMax。
- LOCAL-FIRST + actions: 判卷、判题、重置、展开、选中就地完成，零往返；action 仅用于需模型参与的事。交互回传 [genui-action] name + 组件数据，届时重渲染 UI；无 action 按钮禁用。
- Durable state: 按会话和内容指纹存交互及 Editor 草稿；同内容刷新/重放恢复，新内容重置。
- 卷子模式: 每题 choices（group+answer+explanation）+ 一个 submit（groups 全列），本地判分。
- Secrets ban: 不索取密码、API Key、Token、恢复码；需要时拒绝并解释。
${RENDER_UI_TOOL_GUIDANCE}
- 围栏位置：\`dsh-ui\` 只写在回答正文；reasoning/思考块不渲染。验证好的 spec 在正文输出。
- Panel: "panel":true 只渲染进会话面板 dock 并原地更新；"append":true 追加合并；上限 200 节点/200 次追加，满了发 replace 重建。面板来的 [genui-action] 只回一个 panel:true 围栏 + 至多一行 10 字内确认。`

/**
 * Register the GenUI output-language section and the render_ui tool.
 * @param ctx - cordis context.
 */
// `tools` is intentionally NOT injected: the service is optional for this
// plugin — hosts without tool access keep the fence channel working. Cordis
// inject entries are hard requirements, so the registry is probed at runtime
// instead (see apply).
export const name = '@changfenhuang/dsh-genui'
export const inject = ['systemPrompt']

const BUNDLED_SKILL_RANK = 600
const BUNDLED_SKILL_PROVIDER = 'dsh-genui'
const BUNDLED_SKILL_INVOCATION = { modelInvocable: true, userInvocable: true } as const

/**
 * The frontmatter field the routing description comes from.
 *
 * A second copy of this sentence in code drifted from SKILL.md unnoticed, and the
 * panel showed the code copy while the model read the same string — so an edit to
 * the skill's own frontmatter changed nothing. The file is the only source.
 */
function frontmatterField(front: string, key: string): string | undefined {
  const line = new RegExp('^\\s*' + key + '\\s*:\\s*(.+?)\\s*$', 'mu').exec(front)
  return line?.[1]?.replace(/^['"]|['"]$/gu, '')
}

/** Register through the provider path so source=bundled also gets bundled precedence. */
function bundledSkillProvider(): SkillProvider {
  const moduleDirectory = dirname(fileURLToPath(new URL(import.meta.url)))
  const path = basename(moduleDirectory) === 'plugin'
    ? resolve(moduleDirectory, '../../SKILL.md')
    : resolve(moduleDirectory, '../SKILL.md')
  const raw = readFileSync(path, 'utf8')
  const end = raw.indexOf('\n---\n', 4)
  if (!raw.startsWith('---\n') || end < 0) throw new Error('genui SKILL.md has invalid frontmatter')
  const description = frontmatterField(raw.slice(4, end), 'description')
  if (description === undefined) throw new Error('genui SKILL.md frontmatter has no description')
  return {
    name: BUNDLED_SKILL_PROVIDER,
    list: () => Promise.resolve([{
      name: 'genui',
      description,
      invocation: BUNDLED_SKILL_INVOCATION,
      source: 'bundled',
      provider: BUNDLED_SKILL_PROVIDER,
      path,
      resourceBase: { kind: 'directory', path: dirname(path) },
      rank: BUNDLED_SKILL_RANK,
      locator: path,
    }]),
    get: () => Promise.resolve({
      name: 'genui',
      description,
      invocation: BUNDLED_SKILL_INVOCATION,
      source: 'bundled',
      provider: BUNDLED_SKILL_PROVIDER,
      path,
      resourceBase: { kind: 'directory', path: dirname(path) },
      content: raw.slice(end + 5),
    }),
  }
}

/**
 * Plugin config as the host passes it (unvalidated: the node half deliberately
 * imports no schema library, so a profile can set these keys directly).
 */
export interface GenuiPluginConfig {
  /**
   * 在最终 dsh-ui 围栏无法渲染的回合中请求模型发送一次修正版（issue #160）。
   * 默认开启，设置为 false 可以关闭同回合围栏修正。GenUI 回合的 reasoning-only 响应仍会交给宿主重试策略处理。
   * 每回合和每个围栏正文最多请求一次，子代理不触发，每次修正请求会消耗模型步数。
   */
  fenceFeedback?: boolean

  /**
   * 是否注册 render_ui 模型工具。默认开启，设置为 false 时关闭；不影响 validate_dsh_ui 和 dsh-ui 围栏渲染。
   */
  renderUiTool?: boolean
}

export function apply(ctx: Context, config?: GenuiPluginConfig): void {
  installDshGoNative(ctx)
  const renderUiToolEnabled = config?.renderUiTool !== false
  ctx.systemPrompt.section({
    name: 'genui:fence',
    order: ctx.systemPrompt.getSectionOrder('STRUCTURED_OUTPUT'),
    text: renderUiToolEnabled ? GENUI_SECTION_TEXT : GENUI_SECTION_TEXT.replace(`${RENDER_UI_TOOL_GUIDANCE}\n`, ''),
  })
  installFenceFeedback(ctx, config?.fenceFeedback !== false, renderUiToolEnabled)
  // Hosts without tool access keep the fence channel. The dependency fiber
  // starts whenever tools becomes available and unloads its registrations
  // before either the service or this plugin is replaced.
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(function* () {
      if (renderUiToolEnabled) {
        yield toolsCtx.tools.register(createRenderUiTool())
      }
      yield toolsCtx.tools.register(createValidateDshUiTool())
    }, 'dsh-genui: model tools')
  })

  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.skills.registerProvider(() => bundledSkillProvider())
  })

  // webServer.register returns a raw disposer, so an explicit effect binds the
  // route to the dependency fiber instead of leaving it in the host route table.
  ctx.inject(['webServer'], (webCtx) => {
    const webServer = webCtx.reflect.get('webServer') as { register(route: unknown): () => void }
    webCtx.effect(
      () => webServer.register({ kind: 'prefix', path: ASSET_ROUTE_PATH, handler: serveGenuiAsset }),
      'dsh-genui: asset route',
    )
  })
}
