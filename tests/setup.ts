/** Browser API polyfills for the test environment. */
import { setLocale } from '../src/client/i18n/index.ts'

// Locale pin: jsdom reports an English navigator, so the renderer would
// default to `en` anyway. The pin is kept explicit so suite expectations
// stay deterministic and independent of the host browser's language list.
// This fork ships English only; tests assert the English dictionary wording.
setLocale('en')

// jsdom lacks rAF: the reveal animation uses it per item; manual tick below.
if (typeof globalThis.requestAnimationFrame !== 'function') {
  // @ts-expect-error test-only stub
  globalThis.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number
  // @ts-expect-error test-only stub
  globalThis.cancelAnimationFrame = (id: number) => clearTimeout(id)
}

// Some Node/jsdom combos expose no window.localStorage at all, which makes
// every durable-state test die in its beforeEach hook. Minimal in-memory
// storage API, installed only when jsdom did not provide one.
if (typeof window.localStorage === 'undefined') {
  const backing = new Map<string, string>()
  const storage: Storage = {
    get length() { return backing.size },
    clear: () => { backing.clear() },
    getItem: (key: string) => backing.has(key) ? backing.get(key)! : null,
    key: (index: number) => [...backing.keys()][index] ?? null,
    removeItem: (key: string) => { backing.delete(key) },
    setItem: (key: string, value: string) => { backing.set(key, String(value)) },
  }
  // @ts-expect-error test-only polyfill
  window.localStorage = storage
  // @ts-expect-error test-only polyfill
  globalThis.localStorage = storage
}

// jsdom lacks PointerEvent: the panel resize drag and pointer interactions
// in general rely on it. A MouseEvent subclass carries pointerId/pointerType
// so fireEvent.pointerDown/pointerMove/pointerUp behave like the browser.
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
  // @ts-expect-error test-only polyfill
  window.PointerEvent = PointerEventPolyfill
  // @ts-expect-error test-only polyfill
  globalThis.PointerEvent = PointerEventPolyfill
}
