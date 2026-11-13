import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, extname, relative, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { UserConfig } from 'tsdown'
import { Rolldown } from 'tsdown'
import { transform } from 'lightningcss'

const ID = '@changfenhuang/dsh-genui'
const PROJECT_ROOT = dirname(fileURLToPath(import.meta.url))

const EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom/client', '@deepseek-ai/cordis', '@deepseek-ai/dsh-client-ui-primitives',
]

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

function cssModulesPlugin(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-css-modules-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.module.css')) return null

      const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
      const stableId = relative(PROJECT_ROOT, abs).replaceAll('\\', '/')
      return CSS_VIRTUAL_PREFIX + stableId + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const stableId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      const fileId = resolvePath(PROJECT_ROOT, stableId)
      this.addWatchFile(fileId)
      const source = await readFile(fileId)
      const { code, exports: cssExports } = transform({
        filename: stableId,
        code: source,
        cssModules: { pattern: '[hash]_[local]' },
        minify: true,
      })

      const entries = Object.entries(cssExports ?? {})
        .map(([local, exp]) => [local, exp.name] as const)
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      const classMap = Object.fromEntries(entries)
      const tagId = `${ID}/${basename(fileId)}`
      return [
        `const css = ${JSON.stringify(code.toString())};`,
        `const tagId = ${JSON.stringify(tagId)};`,
        `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
        `  const tag = document.createElement('style');`,
        `  tag.dataset.plugin = ${JSON.stringify(ID)};`,
        '  tag.dataset.pluginCss = tagId;',
        '  tag.textContent = css;',
        '  document.head.appendChild(tag);',
        '}',
        `export default ${JSON.stringify(classMap)};`,
      ].join('\n')
    },
  }
}

const MAPLIBRE_VERSION = '6.16.0'
const MAPLIBRE_MAIN_SHA256 = 'fbbdf8ddd9a48e49059a4be6795a4f214a711314bb5809f72d3730b48e7897e3'
const MAPLIBRE_WORKER_SHA256 = '0bf06492bdb7ba3d4132b78e435621bfba60d5250967991c02b1a73affea8cd5'
const WORKER_FACTORY_PREFIX = 'async function al(){let e=kn.WORKER_URL||el(),t=!tl(e);'

export function adaptMaplibreWorkerFactory(code: string, version: string, ownershipModule: string): string {
  if (version !== MAPLIBRE_VERSION || createHash('sha256').update(code).digest('hex') !== MAPLIBRE_MAIN_SHA256
    || code.split(WORKER_FACTORY_PREFIX).length !== 2) throw new Error('MapLibre worker adapter requires the audited 6.16.0 main distribution')
  return `import { isOwnedMapWorkerUrl as __genuiOwnsWorker } from ${JSON.stringify(ownershipModule)};\n`
    + code.replace(WORKER_FACTORY_PREFIX, WORKER_FACTORY_PREFIX
      + 'if(globalThis.location?.protocol==="file:"&&e.startsWith("blob:")&&__genuiOwnsWorker(e))return new Worker(e);')
}

export async function buildMaplibreClassicWorker(workerFile: string): Promise<string> {
  const source = await readFile(workerFile, 'utf8')
  if (createHash('sha256').update(source).digest('hex') !== MAPLIBRE_WORKER_SHA256) throw new Error('MapLibre worker adapter requires the audited 6.16.0 worker distribution')
  const bundle = await Rolldown.rolldown({

    input: '\0genui-maplibre-worker', platform: 'browser', treeshake: false,
    plugins: [{
      name: 'genui-maplibre-worker-entry',
      resolveId(id) { if (id === '\0genui-maplibre-worker') return id },
      load(id) { if (id === '\0genui-maplibre-worker') return `import ${JSON.stringify(workerFile)};` },
    }],
  })
  try {
    const { output } = await bundle.generate({ format: 'iife', minify: true, codeSplitting: false })
    const [chunk] = output
    if (output.length !== 1 || chunk?.type !== 'chunk' || chunk.imports.length !== 0 || chunk.dynamicImports.length !== 0) throw new Error('MapLibre worker must be a self-contained classic script')
    return chunk.code
  } finally { await bundle.close() }
}

function maplibreResourcesPlugin(): NonNullable<UserConfig['plugins']>[number] {
  const source = resolvePath(PROJECT_ROOT, 'src/client/maplibre-resources.ts')
  const virtualId = '\0dsh-genui-maplibre-resources'
  return {
    name: 'dsh-genui-maplibre-resources',
    async transform(code, id) {
      if (!id.endsWith('/maplibre-gl/dist/maplibre-gl.mjs')) return null
      const main = resolvePath(PROJECT_ROOT, 'node_modules/maplibre-gl/dist/maplibre-gl.mjs')
      if (await realpath(id) !== await realpath(main)) throw new Error('Unexpected MapLibre main distribution')
      const pkg = JSON.parse(await readFile(resolvePath(main, '../../package.json'), 'utf8')) as { version: string }
      return adaptMaplibreWorkerFactory(code, pkg.version, resolvePath(PROJECT_ROOT, 'src/client/map-worker-ownership.ts'))
    },
    resolveId(id: string, importer: string | undefined) {
      return importer !== undefined && resolvePath(dirname(importer), id) === source ? virtualId : null
    },
    async load(id: string) {
      if (id !== virtualId) return null
      const dist = resolvePath(PROJECT_ROOT, 'node_modules/maplibre-gl/dist')
      const cssFile = resolvePath(dist, 'maplibre-gl.css')
      const workerFile = resolvePath(dist, 'maplibre-gl-worker.mjs')
      this.addWatchFile(cssFile)
      this.addWatchFile(workerFile)
      const css = await readFile(cssFile, 'utf8')
      const worker = await buildMaplibreClassicWorker(workerFile)
      return `export const maplibreCss = ${JSON.stringify(css)}; export const maplibreWorker = ${JSON.stringify(worker)};`
    },
  }
}

function purityGate(): NonNullable<UserConfig['plugins']>[number] {
  return {
    name: 'dsh-client-bundle-purity',
    resolveId(source: string) {
      if (!source.startsWith('@deepseek-ai/')) return null
      if (EXTERNALS.includes(source)) return null
      throw new Error(
        `client bundle purity: "${source}" is not in the module table (EXTERNALS) — `
        + 'cross-plugin value imports are forbidden; collaborate through cordis services',
      )
    },
  }
}

function standaloneAliasPlugin(): NonNullable<UserConfig['plugins']>[number] {
  const adapterPath = resolvePath(PROJECT_ROOT, 'src/client/primitive-adapter.ts')
  const standaloneAdapterPath = resolvePath(PROJECT_ROOT, 'src/client/standalone/primitive-adapter.tsx')
  const assetLoaderPath = resolvePath(PROJECT_ROOT, 'src/client/asset-loader.ts')
  const standaloneAssetLoaderPath = resolvePath(PROJECT_ROOT, 'src/client/standalone/asset-loader.ts')
  return {
    name: 'dsh-genui-standalone-primitives',
    resolveId(source: string, importer: string | undefined) {
      if (importer === undefined) return null
      const resolved = resolvePath(dirname(importer), source)
      if (resolved === adapterPath) return standaloneAdapterPath
      return resolved === assetLoaderPath ? standaloneAssetLoaderPath : null
    },
  }
}

function standaloneKatexCssPlugin(): NonNullable<UserConfig['plugins']>[number] {
  const sourcePath = resolvePath(PROJECT_ROOT, 'src/client/standalone/katex-style.ts')
  const virtualId = '\0dsh-genui-standalone-katex'
  const cssPath = resolvePath(PROJECT_ROOT, 'node_modules/katex/dist/katex.min.css')
  return {
    name: 'dsh-genui-standalone-katex',
    resolveId(source: string, importer: string | undefined) {
      if (importer !== undefined && resolvePath(dirname(importer), source) === sourcePath) return virtualId
      return null
    },
    async load(id: string) {
      if (id !== virtualId) return null
      const transformed = transform({
        filename: cssPath,
        code: await readFile(cssPath),
        analyzeDependencies: true,
        visitor: {
          Rule: {

            'font-face'(rule) {
              const source = rule.value.properties.find(property => property.type === 'source')
              if (source === undefined) throw new Error('KaTeX font face has no source')
              const woff2 = source.value.filter(entry => entry.type === 'url' && entry.value.format?.type === 'woff2')
              if (woff2.length !== 1) throw new Error('KaTeX font face must have exactly one WOFF2 source')
              source.value = woff2
              return rule
            },
          },
        },
      })
      let css = transformed.code.toString()
      for (const dependency of transformed.dependencies ?? []) {
        if (dependency.type !== 'url' || dependency.url.startsWith('data:') || dependency.url.startsWith('#')) continue
        const fontPath = resolvePath(dirname(cssPath), dependency.url)
        const extension = extname(new URL(dependency.url, 'https://genui.invalid/').pathname)
        if (extension !== '.woff2') throw new Error(`unsupported KaTeX asset: ${dependency.url}`)
        const font = await readFile(fontPath)
        css = css.replaceAll(dependency.placeholder, `data:font/woff2;base64,${font.toString('base64')}`)
      }
      return `const style = document.createElement('style'); style.dataset.genuiStandaloneKatex = ''; style.textContent = ${JSON.stringify(css)}; document.head.appendChild(style);`
    },
  }
}

const clientConfig: UserConfig = {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,

  minify: true,

  sourcemap: false,
  clean: false,
  deps: {
    neverBundle: [...EXTERNALS],
    alwaysBundle: (id: string) => !EXTERNALS.includes(id),
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [purityGate(), cssModulesPlugin()],
  outputOptions: {
    entryFileNames: 'client.js',

    codeSplitting: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}

const standaloneConfig: UserConfig = {
  name: `${ID}/standalone`,
  entry: { 'assets/standalone-runtime': 'src/client/standalone/runtime.tsx' },
  outDir: 'lib',
  format: 'iife',
  platform: 'browser',
  dts: false,
  minify: true,
  sourcemap: false,
  clean: false,
  deps: { alwaysBundle: () => true },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
    'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
  },
  plugins: [standaloneAliasPlugin(), cssModulesPlugin(), standaloneKatexCssPlugin()],
  outputOptions: { entryFileNames: '[name].js', codeSplitting: false },
}

function assetConfig(name: 'mermaid' | 'three' | 'echarts' | 'echarts-core' | 'echarts-full' | 'icons' | 'maplibre', entry: string): UserConfig {
  return {
    name: `${ID}/assets/${name}`,
    entry: { [`assets/${name}`]: entry },
    outDir: 'lib',
    format: 'iife',
    platform: 'browser',
    dts: false,

    minify: true,
    sourcemap: false,
    clean: false,
    deps: {
      neverBundle: [...EXTERNALS],
      alwaysBundle: (id: string) => !EXTERNALS.includes(id),
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),

      ...(name === 'maplibre' ? { 'import.meta.url': 'undefined' } : {}),
    },
    plugins: [purityGate(), maplibreResourcesPlugin()],
    outputOptions: {
      entryFileNames: '[name].js',
    },
  }
}

const libConfig: UserConfig = {
  name: ID,

  entry: { index: 'src/index.ts' },
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,

  outputOptions: { entryFileNames: '[name].js' },

  clean: false,
}

export default [
  libConfig,
  clientConfig,
  standaloneConfig,
  assetConfig('mermaid', 'src/client/asset-mermaid.ts'),
  assetConfig('three', 'src/client/asset-three.ts'),
  assetConfig('maplibre', 'src/client/asset-maplibre.ts'),
  assetConfig('echarts-core', 'src/client/asset-echarts-core.ts'),
  assetConfig('echarts-full', 'src/client/asset-echarts.ts'),

  assetConfig('icons', 'src/client/icons/asset-icons.ts'),
]
