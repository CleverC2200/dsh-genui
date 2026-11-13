import { loadGenuiAsset } from './asset-loader.ts'
import type { GenuiScene3D } from './spec.ts'

interface ThreeAssetApi {
  mountScene: (container: HTMLElement, scene: GenuiScene3D) => Promise<() => void>
}

export async function mountScene(container: HTMLElement, scene: GenuiScene3D): Promise<() => void> {
  const api = await loadGenuiAsset<ThreeAssetApi>('three')
  return api.mountScene(container, scene)
}
