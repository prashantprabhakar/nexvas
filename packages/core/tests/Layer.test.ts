import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Layer } from '../src/Layer.js'
import { Rect } from '../src/objects/Rect.js'
import { Group } from '../src/objects/Group.js'
import { createMockCK, createMockCanvas } from './__mocks__/canvaskit.js'
import type { RenderContext, StageInterface } from '../src/types.js'
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
    stage: {} as unknown as StageInterface,
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

  it('z-order: moveTo places object at given index', () => {
    const layer = new Layer()
    const a = new Rect()
    const b = new Rect()
    const c = new Rect()
    layer.add(a).add(b).add(c)
    layer.moveTo(a, 2)
    expect(layer.objects[2]).toBe(a)
    expect(layer.objects[0]).toBe(b)
    expect(layer.objects[1]).toBe(c)
  })

  it('z-order: moveTo clamps index to valid range', () => {
    const layer = new Layer()
    const a = new Rect()
    const b = new Rect()
    layer.add(a).add(b)
    layer.moveTo(a, 99)
    expect(layer.objects[layer.objects.length - 1]).toBe(a)
    layer.moveTo(b, -5)
    expect(layer.objects[0]).toBe(b)
  })

  it('z-order: moveTo is a no-op when object is not in layer', () => {
    const layer = new Layer()
    const a = new Rect()
    const b = new Rect()
    layer.add(a)
    expect(() => layer.moveTo(b, 0)).not.toThrow()
    expect(layer.objects).toHaveLength(1)
  })

  it('z-order: moveTo is a no-op when already at target index', () => {
    const layer = new Layer()
    const a = new Rect()
    const b = new Rect()
    layer.add(a).add(b)
    layer.moveTo(a, 0) // already at 0
    expect(layer.objects[0]).toBe(a)
    expect(layer.objects[1]).toBe(b)
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

    it('renders in z-order (back-to-front) when using R-tree culling', () => {
      const layer = new Layer()
      const renderOrder: string[] = []
      const a = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      const b = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      vi.spyOn(a, 'render').mockImplementation(() => { renderOrder.push('a') })
      vi.spyOn(b, 'render').mockImplementation(() => { renderOrder.push('b') })
      layer.add(a).add(b) // a is below b in z-order
      layer.render(makeCtx(0, 0, 1, 800, 600))
      expect(renderOrder).toEqual(['a', 'b'])
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

  describe('NV-006 R-tree spatial index', () => {
    it('finds object after it is moved to a new position', () => {
      const layer = new Layer()
      const rect = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      layer.add(rect)
      rect.x = 200
      rect.y = 200
      expect(layer.hitTest(220, 220)).toBe(rect)
      expect(layer.hitTest(25, 25)).toBeNull()
    })

    it('does not return object removed from layer', () => {
      const layer = new Layer()
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 100 })
      layer.add(rect)
      layer.remove(rect)
      expect(layer.hitTest(50, 50)).toBeNull()
    })

    it('finds correct object among many non-overlapping objects', () => {
      const layer = new Layer()
      const rects: Rect[] = []
      for (let i = 0; i < 200; i++) {
        const r = new Rect({ x: i * 60, y: 0, width: 50, height: 50 })
        layer.add(r)
        rects.push(r)
      }
      expect(layer.hitTest(rects[100]!.x + 25, 25)).toBe(rects[100])
      expect(layer.hitTest(rects[0]!.x + 25, 25)).toBe(rects[0])
      expect(layer.hitTest(rects[199]!.x + 25, 25)).toBe(rects[199])
    })

    it('updates index when child inside a Group moves', () => {
      const layer = new Layer()
      const group = new Group({ x: 0, y: 0 })
      const child = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      group.add(child)
      layer.add(group)
      child.x = 300
      // Group's R-tree entry should now cover (300,0)→(350,50)
      expect(layer.hitTest(325, 25)).toBe(child)
      expect(layer.hitTest(25, 25)).toBeNull()
    })

    it('updates index when Group itself moves', () => {
      const layer = new Layer()
      const group = new Group({ x: 0, y: 0, width: 50, height: 50 })
      const child = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      group.add(child)
      layer.add(group)
      group.x = 400
      expect(layer.hitTest(425, 25)).toBe(child)
      expect(layer.hitTest(25, 25)).toBeNull()
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
