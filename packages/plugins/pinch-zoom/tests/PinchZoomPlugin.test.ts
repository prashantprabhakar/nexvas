import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { PinchZoomPlugin } from '../src/PinchZoomPlugin.js'
import { Layer, BoundingBox } from '@nexvas/core'
import type { StageInterface, Viewport, FontManager, RenderPass } from '@nexvas/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal Viewport stub tracking pan/zoom calls. */
function makeViewport(initialScale = 1): Viewport & {
  _x: number; _y: number; _scale: number
  minScale: number; maxScale: number
} {
  const vp = {
    _x: 0,
    _y: 0,
    _scale: initialScale,
    minScale: 0.01,
    maxScale: 64,
    getState() { return { x: vp._x, y: vp._y, scale: vp._scale, width: 800, height: 600 } },
    pan(dx: number, dy: number) { vp._x += dx; vp._y += dy },
    panTo(x: number, y: number) { vp._x = x; vp._y = y },
    zoom(factor: number, _ox: number, _oy: number) {
      vp._scale = Math.min(vp.maxScale, Math.max(vp.minScale, vp._scale * factor))
    },
    setScale(scale: number, ox?: number, oy?: number) { vp.zoom(scale / vp._scale, ox ?? 400, oy ?? 300) },
    reset() { vp._x = 0; vp._y = 0; vp._scale = 1 },
    setState(s: { x?: number; y?: number; scale?: number }) {
      if (s.x !== undefined) vp._x = s.x
      if (s.y !== undefined) vp._y = s.y
      if (s.scale !== undefined) vp._scale = s.scale
    },
    setOptions(o: { minScale?: number; maxScale?: number }) {
      if (o.minScale !== undefined) vp.minScale = o.minScale
      if (o.maxScale !== undefined) vp.maxScale = o.maxScale
    },
    setOnChange() {},
    setSize() {},
    fitToRect() {},
    animateTo() {},
    cancelAnimation() {},
  }
  vi.spyOn(vp, 'zoom')
  vi.spyOn(vp, 'pan')
  return vp as unknown as Viewport & { _x: number; _y: number; _scale: number; minScale: number; maxScale: number }
}

/** Minimal canvas stub with event listener tracking. */
function makeCanvas() {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>()
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 } as DOMRect),
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, _opts?: unknown) {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(listener)
    },
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      listeners.get(type)?.delete(listener)
    },
    _dispatch(type: string, event: Event) {
      listeners.get(type)?.forEach((l) => {
        if (typeof l === 'function') l(event)
        else l.handleEvent(event)
      })
    },
    _listenerCount(type: string) { return listeners.get(type)?.size ?? 0 },
  }
  return canvas
}

function makeStage(viewport?: ReturnType<typeof makeViewport>) {
  const layer = new Layer()
  const handlers = new Map<string, Set<(e: unknown) => void>>()
  const passes: RenderPass[] = []
  const vp = viewport ?? makeViewport()
  const canvas = makeCanvas()

  const stage = {
    id: 'test-stage',
    canvasKit: {},
    canvas,
    get layers() { return [layer] as unknown as readonly Layer[] },
    viewport: vp,
    fonts: {} as unknown as FontManager,
    on(event: string, handler: (e: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    },
    off(event: string, handler: (e: unknown) => void) {
      handlers.get(event)?.delete(handler)
    },
    emit(event: string, data: unknown) {
      handlers.get(event)?.forEach((h) => h(data))
    },
    addRenderPass(pass: RenderPass) { passes.push(pass) },
    removeRenderPass(pass: RenderPass) {
      const i = passes.indexOf(pass)
      if (i !== -1) passes.splice(i, 1)
    },
    getBoundingBox() { return new BoundingBox(0, 0, 800, 600) },
    render() {},
    markDirty: vi.fn(),
    resize() {},
    find: () => [],
    findByType: () => [],
    getObjectById: () => undefined,
    registerObject: () => {},
    getObjectLayer: () => null,
    bringToFront: () => {},
    sendToBack: () => {},
    bringForward: () => {},
    sendBackward: () => {},
    groupObjects: () => { throw new Error('not implemented') },
    ungroupObject: () => [],
    batch(fn: () => void) { fn() },
  } as unknown as StageInterface & { canvas: ReturnType<typeof makeCanvas>; viewport: ReturnType<typeof makeViewport> }

  return { stage, vp, canvas }
}

/** Build a minimal synthetic TouchEvent. */
function makeTouchEvent(
  type: string,
  touches: Array<{ id: number; clientX: number; clientY: number }>,
): TouchEvent & { _prevented: boolean } {
  const touchList = touches.map((t) =>
    ({ identifier: t.id, clientX: t.clientX, clientY: t.clientY } as unknown as Touch),
  )
  const tl = Object.assign(touchList, {
    length: touchList.length,
    item: (i: number) => touchList[i] ?? null,
  }) as unknown as TouchList

  let _prevented = false
  const event = {
    type,
    touches: tl,
    preventDefault: () => { _prevented = true },
    _prevented,
  } as unknown as TouchEvent & { _prevented: boolean }

  // Keep _prevented in sync via Object.defineProperty
  Object.defineProperty(event, '_prevented', {
    get: () => _prevented,
    set: (v: boolean) => { _prevented = v },
  })
  ;(event as unknown as { preventDefault: () => void }).preventDefault = () => { _prevented = true }

  return event
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PinchZoomPlugin', () => {
  let plugin: PinchZoomPlugin
  let stage: ReturnType<typeof makeStage>['stage']
  let vp: ReturnType<typeof makeViewport>
  let canvas: ReturnType<typeof makeCanvas>

  beforeEach(() => {
    plugin = new PinchZoomPlugin()
    const s = makeStage()
    stage = s.stage
    vp = s.vp
    canvas = s.canvas
  })

  afterEach(() => {
    plugin.uninstall(stage)
  })

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  it('installs without throwing', () => {
    expect(() => plugin.install(stage)).not.toThrow()
  })

  it('attaches touch listeners on install', () => {
    plugin.install(stage)
    expect(canvas._listenerCount('touchstart')).toBe(1)
    expect(canvas._listenerCount('touchmove')).toBe(1)
    expect(canvas._listenerCount('touchend')).toBe(1)
    expect(canvas._listenerCount('touchcancel')).toBe(1)
  })

  it('removes all listeners on uninstall', () => {
    plugin.install(stage)
    plugin.uninstall(stage)
    expect(canvas._listenerCount('touchstart')).toBe(0)
    expect(canvas._listenerCount('touchmove')).toBe(0)
    expect(canvas._listenerCount('touchend')).toBe(0)
    expect(canvas._listenerCount('touchcancel')).toBe(0)
  })

  it('install → uninstall → re-install works correctly', () => {
    plugin.install(stage)
    plugin.uninstall(stage)
    plugin.install(stage)
    expect(canvas._listenerCount('touchstart')).toBe(1)
    expect(canvas._listenerCount('touchmove')).toBe(1)
  })

  // -------------------------------------------------------------------------
  // Pinch to zoom
  // -------------------------------------------------------------------------

  it('calls viewport.zoom() during a two-finger pinch', () => {
    plugin.install(stage)

    // Start with two fingers 100px apart.
    canvas._dispatch('touchstart', makeTouchEvent('touchstart', [
      { id: 0, clientX: 350, clientY: 300 },
      { id: 1, clientX: 450, clientY: 300 },
    ]))

    // Move fingers to 200px apart — 2× scale.
    canvas._dispatch('touchmove', makeTouchEvent('touchmove', [
      { id: 0, clientX: 300, clientY: 300 },
      { id: 1, clientX: 500, clientY: 300 },
    ]))

    expect(vp.zoom).toHaveBeenCalled()
    expect(vp._scale).toBeCloseTo(2, 1)
  })

  it('does not call viewport.zoom() with a single touch', () => {
    plugin.install(stage)

    canvas._dispatch('touchstart', makeTouchEvent('touchstart', [
      { id: 0, clientX: 400, clientY: 300 },
    ]))
    canvas._dispatch('touchmove', makeTouchEvent('touchmove', [
      { id: 0, clientX: 420, clientY: 300 },
    ]))

    expect(vp.zoom).not.toHaveBeenCalled()
  })

  it('resets pinch state when fingers lift', () => {
    plugin.install(stage)

    canvas._dispatch('touchstart', makeTouchEvent('touchstart', [
      { id: 0, clientX: 350, clientY: 300 },
      { id: 1, clientX: 450, clientY: 300 },
    ]))

    expect(plugin.isPinching()).toBe(true)

    canvas._dispatch('touchend', makeTouchEvent('touchend', []))
    expect(plugin.isPinching()).toBe(false)
  })

  // -------------------------------------------------------------------------
  // Two-finger pan
  // -------------------------------------------------------------------------

  it('pans the viewport when two-finger midpoint moves', () => {
    plugin.install(stage)

    canvas._dispatch('touchstart', makeTouchEvent('touchstart', [
      { id: 0, clientX: 300, clientY: 300 },
      { id: 1, clientX: 500, clientY: 300 },
    ]))

    // Move both fingers 50px to the right without changing distance.
    canvas._dispatch('touchmove', makeTouchEvent('touchmove', [
      { id: 0, clientX: 350, clientY: 300 },
      { id: 1, clientX: 550, clientY: 300 },
    ]))

    expect(vp.pan).toHaveBeenCalled()
    expect(vp._x).toBeCloseTo(50, 0)
  })

  // -------------------------------------------------------------------------
  // One-finger pan (opt-in)
  // -------------------------------------------------------------------------

  it('does not pan with one finger when panWithOneFinger is false (default)', () => {
    plugin.install(stage)

    canvas._dispatch('touchstart', makeTouchEvent('touchstart', [
      { id: 0, clientX: 400, clientY: 300 },
    ]))
    canvas._dispatch('touchmove', makeTouchEvent('touchmove', [
      { id: 0, clientX: 450, clientY: 300 },
    ]))

    expect(vp.pan).not.toHaveBeenCalled()
  })

  it('pans with one finger when panWithOneFinger: true', () => {
    plugin.uninstall(stage)
    plugin = new PinchZoomPlugin({ panWithOneFinger: true })
    plugin.install(stage)

    canvas._dispatch('touchstart', makeTouchEvent('touchstart', [
      { id: 0, clientX: 400, clientY: 300 },
    ]))
    canvas._dispatch('touchmove', makeTouchEvent('touchmove', [
      { id: 0, clientX: 450, clientY: 300 },
    ]))

    expect(vp.pan).toHaveBeenCalled()
    expect(vp._x).toBeCloseTo(50, 0)
  })

  // -------------------------------------------------------------------------
  // Scale clamping
  // -------------------------------------------------------------------------

  it('respects maxScale option', () => {
    plugin.uninstall(stage)
    plugin = new PinchZoomPlugin({ maxScale: 1.5 })
    const s = makeStage()
    stage = s.stage
    vp = s.vp
    canvas = s.canvas
    plugin.install(stage)

    // Spread fingers very far apart — would produce 4× zoom without clamp.
    canvas._dispatch('touchstart', makeTouchEvent('touchstart', [
      { id: 0, clientX: 390, clientY: 300 },
      { id: 1, clientX: 410, clientY: 300 },
    ]))
    canvas._dispatch('touchmove', makeTouchEvent('touchmove', [
      { id: 0, clientX: 200, clientY: 300 },
      { id: 1, clientX: 600, clientY: 300 },
    ]))

    expect(vp._scale).toBeLessThanOrEqual(1.5 + 0.01)
  })

  // -------------------------------------------------------------------------
  // State helpers
  // -------------------------------------------------------------------------

  it('isPinching() returns false before any gesture', () => {
    plugin.install(stage)
    expect(plugin.isPinching()).toBe(false)
  })

  it('isPanning() returns false with default options', () => {
    plugin.install(stage)
    canvas._dispatch('touchstart', makeTouchEvent('touchstart', [
      { id: 0, clientX: 400, clientY: 300 },
    ]))
    expect(plugin.isPanning()).toBe(false)
  })
})
