import { setLocale } from '../src/client/i18n/index.ts'

setLocale('zh')

if (typeof globalThis.requestAnimationFrame !== 'function') {

  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number

  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id)
}

if (typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerId: number
    readonly pointerType: string
    constructor(type: string, params: PointerEventInit = {}) {
      super(type, params)
      this.pointerId = params.pointerId ?? 1
      this.pointerType = params.pointerType ?? 'mouse'
    }
  }

  window.PointerEvent = PointerEventPolyfill

  globalThis.PointerEvent = PointerEventPolyfill
}
