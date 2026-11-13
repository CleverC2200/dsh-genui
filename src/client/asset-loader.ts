const PLUGIN_ID = '@changfenhuang/dsh-genui'

const ASSET_DIR = `/plugins/${PLUGIN_ID}/assets`
let embeddedAssetBase: string | undefined

export function setGenuiAssetBase(baseURL: string): void {
  embeddedAssetBase = new URL(baseURL, document.baseURI).href.replace(/\/?$/, '/')
}

interface BootGraphLike {
  entries?: Array<{ id?: string; rev?: string }>
}

interface AssetGlobal {
  __GenuiAssets__?: Record<string, unknown>
}

function preloadedAsset(name: string): unknown {
  const key = name.replace(/-(\w)/g, (_match, char: string) => char.toUpperCase())
  return (window as unknown as AssetGlobal).__GenuiAssets__?.[key]
}

export function assetUrl(file: string): string {
  if (embeddedAssetBase !== undefined) return new URL(file, embeddedAssetBase).href
  const graph = (window as unknown as { __DSH_BOOT__?: BootGraphLike }).__DSH_BOOT__
  const rev = graph?.entries?.find(entry => entry.id === PLUGIN_ID)?.rev
  return `${ASSET_DIR}/${file}${rev === undefined ? '' : `?rev=${rev}`}`
}

const pending = new Map<string, Promise<Record<string, unknown>>>()

export function loadGenuiAsset<T>(name: 'mermaid' | 'three' | 'echarts-core' | 'echarts-full' | 'icons' | 'maplibre'): Promise<T> {
  const preloaded = preloadedAsset(name)
  if (preloaded !== undefined) return Promise.resolve(preloaded as T)
  const file = `${name}.js`
  const existing = pending.get(file)
  if (existing !== undefined) return existing as Promise<T>
  const task = new Promise<T>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = assetUrl(file)
    script.async = true
    script.onload = () => {
      const global = (window as unknown as AssetGlobal).__GenuiAssets__ ?? {}

      const key = name.replace(/-(\w)/g, (_m, ch: string) => ch.toUpperCase())
      const api = global[key]
      if (api === undefined) {
        reject(new Error(`genui asset '${file}' loaded but registered no '${name}' engine`))
        return
      }
      resolve(api as T)
    }
    script.onerror = () => {
      reject(new Error(`genui asset '${file}' failed to load (host asset route missing?)`))
    }
    document.head.appendChild(script)
  })
  pending.set(file, task as unknown as Promise<Record<string, unknown>>)
  return task
}
