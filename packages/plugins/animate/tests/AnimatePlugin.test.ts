import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  AnimatePlugin,
  AnimateController,
  Tween,
  SequenceAnimation,
  ParallelAnimation,
  Easing,
  type AnimatePluginAPI,
} from '../src/AnimatePlugin.js'
import { Rect, Layer, BoundingBox } from '@nexvas/core'
import type { StageInterface, Viewport, FontManager, RenderPass } from '@nexvas/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStage(): StageInterface {
  const layer = new Layer()
  const handlers = new Map<string, Set<(e: unknown) => void>>()
  const passes: RenderPass[] = []

  const stage: StageInterface = {
    id: 'test-stage',
    canvasKit: {},
    get layers() { return [layer] as unknown as readonly Layer[] },
    viewport: { x: 0, y: 0, scale: 1, width: 800, height: 600 } as unknown as Viewport,
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
  } as unknown as StageInterface

  return stage
}

function makeRect(x = 0, y = 0, w = 100, h = 100): Rect {
  return new Rect({ x, y, width: w, height: h })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AnimatePlugin', () => {
  let plugin: AnimatePlugin
  let stage: StageInterface

  beforeEach(() => {
    plugin = new AnimatePlugin()
    stage = makeStage()
    plugin.install(stage)
  })

  afterEach(() => {
    // Ensure cleanup even if a test forgets
    try { plugin.uninstall(stage) } catch { /* already uninstalled */ }
  })

  // --- lifecycle ------------------------------------------------------------

  it('installs without throwing', () => {
    const s = makeStage()
    expect(() => new AnimatePlugin().install(s)).not.toThrow()
  })

  it('exposes animate controller after install', () => {
    expect((stage as unknown as AnimatePluginAPI).animate).toBeDefined()
  })

  it('uninstalls cleanly — removes animate from stage', () => {
    plugin.uninstall(stage)
    expect((stage as unknown as Partial<AnimatePluginAPI>).animate).toBeUndefined()
  })

  it('install → uninstall → re-install works correctly', () => {
    plugin.uninstall(stage)
    const s2 = makeStage()
    expect(() => plugin.install(s2)).not.toThrow()
    expect((s2 as unknown as AnimatePluginAPI).animate).toBeDefined()
    plugin.uninstall(s2)
    expect((s2 as unknown as Partial<AnimatePluginAPI>).animate).toBeUndefined()
  })

  // --- Easing ---------------------------------------------------------------

  describe('Easing', () => {
    it('linear maps t=0→0, t=1→1, t=0.5→0.5', () => {
      expect(Easing.linear(0)).toBe(0)
      expect(Easing.linear(1)).toBe(1)
      expect(Easing.linear(0.5)).toBe(0.5)
    })

    it('easeInOutCubic is symmetric: f(t) + f(1-t) ≈ 1', () => {
      const t = 0.3
      expect(Easing.easeInOutCubic(t) + Easing.easeInOutCubic(1 - t)).toBeCloseTo(1)
    })

    it('easeOutBounce returns 1 at t=1', () => {
      expect(Easing.easeOutBounce(1)).toBe(1)
    })

    it('spring returns 0 at t=0 and 1 at t=1', () => {
      expect(Easing.spring(0)).toBe(0)
      expect(Easing.spring(1)).toBe(1)
    })

    it('easeInExpo returns 0 at t=0', () => {
      expect(Easing.easeInExpo(0)).toBe(0)
    })

    it('easeOutExpo returns 1 at t=1', () => {
      expect(Easing.easeOutExpo(1)).toBe(1)
    })
  })

  // --- Tween.tick -----------------------------------------------------------

  describe('Tween', () => {
    it('interpolates x toward target on tick', () => {
      const rect = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, { to: { x: 100 }, duration: 100, easing: Easing.linear })
      tween.play()
      tween.tick(50)
      expect(rect.x).toBeCloseTo(50)
    })

    it('reaches target exactly at end of duration', () => {
      const rect = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, { to: { x: 200 }, duration: 200, easing: Easing.linear })
      tween.play()
      tween.tick(200)
      expect(rect.x).toBeCloseTo(200)
      expect(tween.isDone).toBe(true)
    })

    it('calls onUpdate on each tick', () => {
      const rect = makeRect(0)
      const onUpdate = vi.fn()
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, { to: { x: 100 }, duration: 100, onUpdate })
      tween.play()
      tween.tick(50)
      expect(onUpdate).toHaveBeenCalledOnce()
    })

    it('calls onComplete when tween ends', () => {
      const rect = makeRect(0)
      const onComplete = vi.fn()
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, { to: { x: 100 }, duration: 100, onComplete })
      tween.play()
      tween.tick(150)
      expect(onComplete).toHaveBeenCalledOnce()
    })

    it('pause stops interpolation mid-tween', () => {
      const rect = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, { to: { x: 100 }, duration: 100, easing: Easing.linear })
      tween.play()
      tween.tick(50)
      expect(rect.x).toBeCloseTo(50)
      tween.pause()
      tween.tick(50)
      expect(rect.x).toBeCloseTo(50) // no change after pause
    })

    it('stop sets isDone=true', () => {
      const rect = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, { to: { x: 100 }, duration: 100 })
      tween.play()
      tween.tick(30)
      tween.stop()
      expect(tween.isDone).toBe(true)
    })

    it('does not tick when idle (not yet played)', () => {
      const rect = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, { to: { x: 100 }, duration: 100, easing: Easing.linear })
      tween.tick(50) // no play() call
      expect(rect.x).toBe(0) // unchanged
    })

    it('tweens opacity', () => {
      const rect = makeRect()
      rect.opacity = 1
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, { to: { opacity: 0 }, duration: 100, easing: Easing.linear })
      tween.play()
      tween.tick(50)
      expect(rect.opacity).toBeCloseTo(0.5)
    })

    it('tweens fill color on solid fills', () => {
      const rect = makeRect()
      rect.fill = { type: 'solid', color: { r: 0, g: 0, b: 0, a: 1 } }
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, {
        to: { fillColor: { r: 1 } },
        duration: 100,
        easing: Easing.linear,
      })
      tween.play()
      tween.tick(50)
      const fill = rect.fill as { type: string; color: { r: number } }
      expect(fill.color.r).toBeCloseTo(0.5)
    })

    it('calls markDirty on each frame', () => {
      const rect = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, { to: { x: 100 }, duration: 100 })
      tween.play()
      tween.tick(20)
      expect((stage.markDirty as ReturnType<typeof vi.fn>)).toHaveBeenCalled()
    })

    it('play after done restarts from scratch', () => {
      const rect = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const tween = animate.tween(rect, { to: { x: 100 }, duration: 100, easing: Easing.linear })
      tween.play()
      tween.tick(100)
      expect(tween.isDone).toBe(true)
      // Reset rect and replay
      rect.x = 0
      tween.play()
      tween.tick(50)
      expect(rect.x).toBeCloseTo(50)
    })
  })

  // --- sequence -------------------------------------------------------------

  describe('sequence', () => {
    it('plays tweens one after another', () => {
      const r1 = makeRect(0)
      const r2 = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const t1 = animate.tween(r1, { to: { x: 100 }, duration: 100, easing: Easing.linear })
      const t2 = animate.tween(r2, { to: { x: 100 }, duration: 100, easing: Easing.linear })
      const seq = animate.sequence([t1, t2])
      seq.play()

      // tick t1 to completion
      seq.tick(100)
      expect(r1.x).toBeCloseTo(100)
      expect(r2.x).toBe(0) // not yet started

      // tick t2
      seq.tick(50)
      expect(r2.x).toBeCloseTo(50)
    })

    it('isDone after all tweens complete', () => {
      const r1 = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const t1 = animate.tween(r1, { to: { x: 100 }, duration: 100 })
      const seq = animate.sequence([t1])
      seq.play()
      seq.tick(200)
      expect(seq.isDone).toBe(true)
    })

    it('stop halts the sequence', () => {
      const r1 = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const t1 = animate.tween(r1, { to: { x: 100 }, duration: 100, easing: Easing.linear })
      const seq = animate.sequence([t1])
      seq.play()
      seq.tick(30)
      seq.stop()
      seq.tick(70)
      expect(r1.x).toBeCloseTo(30) // frozen at 30
    })
  })

  // --- parallel -------------------------------------------------------------

  describe('parallel', () => {
    it('plays all tweens simultaneously', () => {
      const r1 = makeRect(0)
      const r2 = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const t1 = animate.tween(r1, { to: { x: 100 }, duration: 100, easing: Easing.linear })
      const t2 = animate.tween(r2, { to: { y: 200 }, duration: 100, easing: Easing.linear })
      const par = animate.parallel([t1, t2])
      par.play()
      par.tick(50)
      expect(r1.x).toBeCloseTo(50)
      expect(r2.y).toBeCloseTo(100)
    })

    it('isDone when all tweens complete', () => {
      const r1 = makeRect(0)
      const { animate } = stage as unknown as AnimatePluginAPI
      const t1 = animate.tween(r1, { to: { x: 100 }, duration: 100 })
      const par = animate.parallel([t1])
      par.play()
      par.tick(200)
      expect(par.isDone).toBe(true)
    })
  })

  // --- stopAll --------------------------------------------------------------

  it('stopAll cancels all active animations', () => {
    const r1 = makeRect(0)
    const { animate } = stage as unknown as AnimatePluginAPI
    const tween = animate.tween(r1, { to: { x: 100 }, duration: 100, easing: Easing.linear })
    tween.play()
    tween.tick(30)
    animate.stopAll()
    // All internal tracking should be cleared; tween is done
    expect(tween.isDone).toBe(true)
  })
})
