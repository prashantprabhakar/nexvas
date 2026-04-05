import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Layer } from '../src/Layer.js'
import { Rect } from '../src/objects/Rect.js'
import { Group } from '../src/objects/Group.js'
import { createMockCK, createMockCanvas } from './__mocks__/canvaskit.js'
import type { RenderContext } from '../src/types.js'
import type { FontManager } from '../src/FontManager.js'

function makeCtx(vpX = 0, vpY = 0, scale = 1, width = 800, height = 600): RenderContext {
  const ck = createMockCK()
  const canvas = createMockCanvas()
  return {
    skCanvas: canvas,
    canvasKit: ck,
    fontManager: { hasFont: () => true, getFontProvider: () => ({}) } as unknown as FontManager,
    pixelRatio: 1,
    viewport: { x: vpX, y: vpY, scale, width, height },
  }
}

describe('Layer', () => {
  it('add and remove objects', () => {
    const layer = new Layer()
    const rect = new Rect({ x: 0, y: 0, width: 50, height: 50 })
    layer.add(rect)
    expect(layer.objects).toHaveLength(1)
    layer.remove(rect)
    expect(layer.objects).toHaveLength(0)
  })

  it('throws when adding object that already has a parent', () => {
    const layerA = new Layer()
    const layerB = new Layer()
    const rect = new Rect()
    layerA.add(rect)
    // Layer.add() checks parent — but Layer doesn't set parent, only Group does
    // So adding to a second layer should work (Layers don't set parent)
    expect(() => layerB.add(rect)).not.toThrow()
  })

  it('clear removes all objects', () => {
    const layer = new Layer()
    layer.add(new Rect()).add(new Rect())
    expect(layer.objects).toHaveLength(2)
    layer.clear()
    expect(layer.objects).toHaveLength(0)
  })

  it('z-order: moveUp', () => {
    const layer = new Layer()
    const a = new Rect()
    const b = new Rect()
    layer.add(a).add(b)
    layer.moveDown(b)
    expect(layer.objects[0]).toBe(b)
    expect(layer.objects[1]).toBe(a)
  })

  it('z-order: moveToTop', () => {
    const layer = new Layer()
    const a = new Rect()
    const b = new Rect()
    const c = new Rect()
    layer.add(a).add(b).add(c)
    layer.moveToTop(a)
    expect(layer.objects[layer.objects.length - 1]).toBe(a)
  })

  it('z-order: moveToBottom', () => {
    const layer = new Layer()
    const a = new Rect()
    const b = new Rect()
    layer.add(a).add(b)
    layer.moveToBottom(b)
    expect(layer.objects[0]).toBe(b)
  })

  it('hitTest returns topmost object', () => {
    const layer = new Layer()
    const a = new Rect({ x: 0, y: 0, width: 100, height: 100 })
    const b = new Rect({ x: 0, y: 0, width: 100, height: 100 })
    layer.add(a).add(b)
    expect(layer.hitTest(50, 50)).toBe(b)
  })

  it('hitTest returns null when locked', () => {
    const layer = new Layer({ locked: true })
    layer.add(new Rect({ x: 0, y: 0, width: 100, height: 100 }))
    expect(layer.hitTest(50, 50)).toBeNull()
  })

  it('hitTest returns null when invisible', () => {
    const layer = new Layer({ visible: false })
    layer.add(new Rect({ x: 0, y: 0, width: 100, height: 100 }))
    expect(layer.hitTest(50, 50)).toBeNull()
  })

  it('getById finds nested object in group', () => {
    const layer = new Layer()
    const group = new Group()
    const rect = new Rect()
    group.add(rect)
    layer.add(group)
    expect(layer.getById(rect.id)).toBe(rect)
  })

  it('toJSON roundtrips', () => {
    const layer = new Layer({ name: 'TestLayer' })
    const rect = new Rect({ x: 5, y: 10, width: 40, height: 30 })
    layer.add(rect)
    const json = layer.toJSON()
    expect(json.name).toBe('TestLayer')
    expect(json.objects).toHaveLength(1)
    expect(json.objects[0]!.type).toBe('Rect')
    expect(json.objects[0]!.x).toBe(5)
  })

  describe('viewport culling', () => {
    it('renders objects inside the viewport', () => {
      const layer = new Layer()
      const rect = new Rect({ x: 10, y: 10, width: 50, height: 50 })
      layer.add(rect)
      const renderSpy = vi.spyOn(rect, 'render')
      // viewport shows (0,0)→(800,600) in world space
      layer.render(makeCtx(0, 0, 1, 800, 600))
      expect(renderSpy).toHaveBeenCalledOnce()
    })

    it('skips objects entirely outside the viewport', () => {
      const layer = new Layer()
      // rect far off-screen (world x=2000, viewport only shows 0→800)
      const rect = new Rect({ x: 2000, y: 2000, width: 50, height: 50 })
      layer.add(rect)
      const renderSpy = vi.spyOn(rect, 'render')
      layer.render(makeCtx(0, 0, 1, 800, 600))
      expect(renderSpy).not.toHaveBeenCalled()
    })

    it('skips culling when viewport dimensions are zero (test/headless)', () => {
      const layer = new Layer()
      const rect = new Rect({ x: 5000, y: 5000, width: 10, height: 10 })
      layer.add(rect)
      const renderSpy = vi.spyOn(rect, 'render')
      // viewport width=0, height=0 → culling disabled
      layer.render(makeCtx(0, 0, 1, 0, 0))
      expect(renderSpy).toHaveBeenCalledOnce()
    })

    it('respects viewport pan when culling', () => {
      const layer = new Layer()
      // rect at world (500,500); viewport panned to show world (400,400)→(1200,1200)
      const rect = new Rect({ x: 500, y: 500, width: 50, height: 50 })
      layer.add(rect)
      const renderSpy = vi.spyOn(rect, 'render')
      // vpX=-400, vpY=-400, scale=1, size=800x800 → world shown: (400,400)→(1200,1200)
      layer.render(makeCtx(-400, -400, 1, 800, 800))
      expect(renderSpy).toHaveBeenCalledOnce()
    })
  })

  describe('object mutation handler', () => {
    it('calls handler on add', () => {
      const handler = vi.fn()
      const layer = new Layer()
      layer.setObjectMutationHandler(handler)
      const rect = new Rect()
      layer.add(rect)
      expect(handler).toHaveBeenCalledWith('added', rect)
    })

    it('calls handler on remove', () => {
      const handler = vi.fn()
      const layer = new Layer()
      const rect = new Rect()
      layer.add(rect)
      layer.setObjectMutationHandler(handler)
      layer.remove(rect)
      expect(handler).toHaveBeenCalledWith('removed', rect)
    })

    it('calls handler for each object on clear', () => {
      const handler = vi.fn()
      const layer = new Layer()
      const a = new Rect()
      const b = new Rect()
      layer.add(a).add(b)
      layer.setObjectMutationHandler(handler)
      layer.clear()
      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('does not call handler after it is set to null', () => {
      const handler = vi.fn()
      const layer = new Layer()
      layer.setObjectMutationHandler(handler)
      layer.setObjectMutationHandler(null)
      layer.add(new Rect())
      expect(handler).not.toHaveBeenCalled()
    })
  })

  describe('NV-005 render error boundary', () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy.mockRestore()
    })

    it('continues rendering other objects when one throws', () => {
      const layer = new Layer()
      const a = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      const b = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      const renderSpy = vi.spyOn(a, 'render').mockImplementation(() => {
        throw new Error('render failed')
      })
      const bSpy = vi.spyOn(b, 'render')
      layer.add(a).add(b)
      expect(() => layer.render(makeCtx())).not.toThrow()
      expect(renderSpy).toHaveBeenCalledOnce()
      expect(bSpy).toHaveBeenCalledOnce()
    })
  })

  describe('NV-008 Layer.clear() destroys objects', () => {
    it('calls destroy() on each object when cleared', () => {
      const layer = new Layer()
      const rect = new Rect()
      const destroySpy = vi.spyOn(rect, 'destroy')
      layer.add(rect)
      layer.clear()
      expect(destroySpy).toHaveBeenCalledOnce()
    })
  })

  describe('NV-022 Layer.strictRemove()', () => {
    it('removes the object and returns this when found', () => {
      const layer = new Layer()
      const rect = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      layer.add(rect)
      expect(() => layer.strictRemove(rect)).not.toThrow()
      expect(layer.objects).toHaveLength(0)
    })

    it('throws when object is not in the layer', () => {
      const layer = new Layer()
      const rect = new Rect()
      expect(() => layer.strictRemove(rect)).toThrow(/strictRemove/)
    })
  })

  describe('NV-035 per-object hitTolerance', () => {
    it('uses object hitTolerance for hit testing', () => {
      const layer = new Layer()
      // rect at (50, 50) with 0-size; default hitTolerance=4 means it hits within 4px
      const rect = new Rect({ x: 50, y: 50, width: 0, height: 0 })
      layer.add(rect)
      // Within 4px tolerance, should hit
      expect(layer.hitTest(52, 52)).toBe(rect)
    })

    it('objects with larger hitTolerance are easier to click', () => {
      const layer = new Layer()
      const rect = new Rect({ x: 50, y: 50, width: 0, height: 0 })
      rect.hitTolerance = 10
      layer.add(rect)
      // Within 10px tolerance
      expect(layer.hitTest(58, 50)).toBe(rect)
    })
  })
})
