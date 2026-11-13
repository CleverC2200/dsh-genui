type StandaloneAssets = { __GenuiAssets__?: Record<string, unknown> }

export function loadGenuiAsset<T>(name: 'mermaid' | 'three' | 'echarts-core' | 'echarts-full' | 'icons' | 'maplibre'): Promise<T> {
  const key = name.replace(/-(\w)/g, (_match, character: string) => character.toUpperCase())
  const asset = (window as unknown as StandaloneAssets).__GenuiAssets__?.[key]
  if (asset === undefined) return Promise.reject(new Error(`standalone asset '${name}' was not preloaded`))
  return Promise.resolve(asset as T)
}
