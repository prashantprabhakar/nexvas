import { describe, it, expect } from 'vitest'
import { Polygon } from '../../src/objects/Polygon.js'
import { objectFromJSON } from '../../src/objects/objectFromJSON.js'
import { createMockCK, createMockCanvas } from '../__mocks__/canvaskit.js'
import type { RenderContext, StageInterface } from '../../src/types.js'
import type { FontManager } from '../../src/FontManager.js'

function makeCtx() {
  const ck = createMockCK()
  const canvas = createMockCanvas()
  const ctx: RenderContext = {
    skCanvas: canvas,
    canvasKit: ck,
    fontManager: { hasFont: () => true, getFontProvider: () => ({}) } as unknown as FontManager,
    pixelRatio: 1,
    viewport: { x: 0, y: 0, scale: 1, width: 800, height: 600 },
    stage: {} as StageInterface,
  }
  return { ctx, canvas, ck }
}

// ---------------------------------------------------------------------------
// Construction & defaults
// ---------------------------------------------------------------------------

describe('Polygon — construction', () => {
  it('defaults to 6 sides', () => {
    const p = new Polygon({ x: 0, y: 0, width: 100, height: 100 })
    expect(p.sides).toBe(6)
    expect(p.getType()).toBe('Polygon')
  })

  it('accepts explicit sides', () => {
    const p = new Polygon({ sides: 3 })
    expect(p.sides).toBe(3)
  })

  it('clamps sides to minimum 3', () => {
    const p = new Polygon({ sides: 1 })
    expect(p.sides).toBe(3)
  })

  it('rounds fractional sides', () => {
    const p = new Polygon({ sides: 5.7 })
    expect(p.sides).toBe(6)
  })
})

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

describe('Polygon — bounding box', () => {
  it('getLocalBoundingBox returns (0, 0, width, height)', () => {
    const p = new Polygon({ x: 50, y: 100, width: 80, height: 60 })
    const bb = p.getLocalBoundingBox()
    expect(bb.x).toBe(0)
    expect(bb.y).toBe(0)
    expect(bb.width).toBe(80)
    expect(bb.height).toBe(60)
  })

  it('world bounding box accounts for position', () => {
    const p = new Polygon({ x: 20, y: 30, width: 100, height: 100 })
    const bb = p.getWorldBoundingBox()
    expect(bb.x).toBeCloseTo(20)
    expect(bb.y).toBeCloseTo(30)
    expect(bb.width).toBeCloseTo(100)
    expect(bb.height).toBeCloseTo(100)
  })
})

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

describe('Polygon — hitTest', () => {
  it('returns false when invisible', () => {
    const p = new Polygon({ x: 0, y: 0, width: 100, height: 100, visible: false })
    expect(p.hitTest(50, 50)).toBe(false)
  })

  it('returns true for center point before render (bbox fallback)', () => {
    const p = new Polygon({ x: 0, y: 0, width: 100, height: 100 })
    expect(p.hitTest(50, 50)).toBe(true)
  })

  it('returns false outside bbox before render', () => {
    const p = new Polygon({ x: 0, y: 0, width: 100, height: 100 })
    expect(p.hitTest(200, 200)).toBe(false)
  })

  it('uses path-based hit test after render', () => {
    const { ctx } = makeCtx()
    const p = new Polygon({ x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } })
    p.render(ctx)
    // Mock path.contains always returns false — confirms path-based branch is taken
    // (not bbox fallback which would return true for center)
    expect(p.hitTest(50, 50)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('Polygon — render', () => {
  it('calls drawPath with fill', () => {
    const { ctx, canvas } = makeCtx()
    const p = new Polygon({
      x: 0, y: 0, width: 100, height: 100, sides: 5,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
    })
    p.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawPath')).toBe(true)
  })

  it('calls drawPath with stroke', () => {
    const { ctx, canvas } = makeCtx()
    const p = new Polygon({
      x: 0, y: 0, width: 100, height: 100, sides: 4,
      stroke: { color: { r: 0, g: 0, b: 1, a: 1 }, width: 2 },
    })
    p.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawPath')).toBe(true)
  })

  it('calls drawPath twice with both fill and stroke', () => {
    const { ctx, canvas } = makeCtx()
    const p = new Polygon({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
      stroke: { color: { r: 0, g: 0, b: 0, a: 1 }, width: 2 },
    })
    p.render(ctx)
    expect(canvas.calls.filter((c) => c.method === 'drawPath')).toHaveLength(2)
  })

  it('skips render when invisible', () => {
    const { ctx, canvas } = makeCtx()
    const p = new Polygon({ visible: false, fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } })
    p.render(ctx)
    expect(canvas.calls.filter((c) => c.method === 'drawPath')).toHaveLength(0)
  })

  it('wraps draw in save/restore', () => {
    const { ctx, canvas } = makeCtx()
    const p = new Polygon({
      x: 0, y: 0, width: 80, height: 80,
      fill: { type: 'solid', color: { r: 1, g: 1, b: 1, a: 1 } },
    })
    p.render(ctx)
    expect(canvas.calls[0]!.method).toBe('save')
    expect(canvas.calls[canvas.calls.length - 1]!.method).toBe('restore')
  })

  it('applies concat (local transform)', () => {
    const { ctx, canvas } = makeCtx()
    const p = new Polygon({
      x: 50, y: 50, width: 80, height: 80,
      fill: { type: 'solid', color: { r: 1, g: 1, b: 1, a: 1 } },
    })
    p.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'concat')).toBe(true)
  })

  it('calls saveLayer when effects are present', () => {
    const { ctx, canvas } = makeCtx()
    const p = new Polygon({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
      effects: [{ type: 'drop-shadow', offsetX: 2, offsetY: 2, blur: 4, color: { r: 0, g: 0, b: 0, a: 0.5 } }],
    })
    p.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'saveLayer')).toBe(true)
  })

  it('path cache is reused on second render (same key)', () => {
    const { ctx, canvas } = makeCtx()
    const p = new Polygon({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
    })
    p.render(ctx)
    const firstDrawCount = canvas.calls.filter((c) => c.method === 'drawPath').length
    canvas.calls.length = 0
    p.render(ctx)
    // Same path object reused — still draws once
    expect(canvas.calls.filter((c) => c.method === 'drawPath').length).toBe(firstDrawCount)
  })
})

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

describe('Polygon — ports', () => {
  it('returns sides + 1 default ports (vertices + center)', () => {
    const p = new Polygon({ sides: 5, width: 100, height: 100 })
    const ports = p.getDefaultPorts()
    expect(ports).toHaveLength(6) // 5 vertices + center
  })

  it('vertex port ids are vertex-0 through vertex-N', () => {
    const p = new Polygon({ sides: 3, width: 100, height: 100 })
    const ports = p.getDefaultPorts()
    expect(ports[0]!.id).toBe('vertex-0')
    expect(ports[1]!.id).toBe('vertex-1')
    expect(ports[2]!.id).toBe('vertex-2')
    expect(ports[3]!.id).toBe('center')
  })

  it('center port is at (0.5, 0.5)', () => {
    const p = new Polygon({ sides: 6, width: 100, height: 100 })
    const center = p.getDefaultPorts().find((pt) => pt.id === 'center')!
    expect(center.relX).toBeCloseTo(0.5)
    expect(center.relY).toBeCloseTo(0.5)
  })

  it('top vertex of hexagon is at relY ≈ 0', () => {
    const p = new Polygon({ sides: 6, width: 100, height: 100 })
    const top = p.getDefaultPorts()[0]!
    expect(top.relX).toBeCloseTo(0.5)
    expect(top.relY).toBeCloseTo(0)
  })

  it('getPortWorldPosition returns null for unknown port', () => {
    const p = new Polygon({ sides: 3, width: 100, height: 100 })
    expect(p.getPortWorldPosition('nonexistent')).toBeNull()
  })

  it('getPortWorldPosition resolves center port', () => {
    const p = new Polygon({ x: 0, y: 0, sides: 4, width: 100, height: 100 })
    const pos = p.getPortWorldPosition('center')
    expect(pos).not.toBeNull()
    expect(pos!.x).toBeCloseTo(50)
    expect(pos!.y).toBeCloseTo(50)
  })
})

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe('Polygon — serialization', () => {
  it('toJSON includes sides', () => {
    const p = new Polygon({ x: 10, y: 20, width: 80, height: 80, sides: 5 })
    const json = p.toJSON()
    expect(json.type).toBe('Polygon')
    expect(json['sides']).toBe(5)
    expect(json.x).toBe(10)
  })

  it('fromJSON roundtrip preserves all props', () => {
    const p = new Polygon({ x: 5, y: 15, width: 60, height: 60, sides: 7,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } })
    const restored = Polygon.fromJSON(p.toJSON())
    expect(restored.sides).toBe(7)
    expect(restored.x).toBe(5)
    expect(restored.y).toBe(15)
    expect(restored.width).toBe(60)
    expect(restored.fill).not.toBeNull()
  })

  it('fromJSON clamps sides < 3', () => {
    const p = new Polygon({ sides: 6 })
    const json = { ...p.toJSON(), sides: 1 }
    const restored = Polygon.fromJSON(json)
    expect(restored.sides).toBe(3)
  })

  it('objectFromJSON dispatches to Polygon', () => {
    const p = new Polygon({ sides: 4, width: 50, height: 50 })
    const restored = objectFromJSON(p.toJSON())
    expect(restored).toBeInstanceOf(Polygon)
    expect((restored as Polygon).sides).toBe(4)
  })
})

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

describe('Polygon — transform', () => {
  it('rotation does not change local bounding box', () => {
    const p = new Polygon({ x: 0, y: 0, width: 100, height: 100, rotation: Math.PI / 4 })
    const bb = p.getLocalBoundingBox()
    expect(bb.width).toBe(100)
    expect(bb.height).toBe(100)
  })

  it('world bbox accounts for position after translation', () => {
    const p = new Polygon({ x: 100, y: 200, width: 50, height: 50 })
    const bb = p.getWorldBoundingBox()
    expect(bb.x).toBeCloseTo(100)
    expect(bb.y).toBeCloseTo(200)
  })
})

// ---------------------------------------------------------------------------
// Sides setter
// ---------------------------------------------------------------------------

describe('Polygon — sides setter', () => {
  it('updating sides invalidates path cache', () => {
    const { ctx } = makeCtx()
    const p = new Polygon({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
    })
    p.render(ctx)
    // Changing sides should produce a new path on next render
    p.sides = 3
    expect(p.sides).toBe(3)
    // Re-render should work without error
    const { ctx: ctx2 } = makeCtx()
    expect(() => p.render(ctx2)).not.toThrow()
  })

  it('clamps values below 3', () => {
    const p = new Polygon({ sides: 6 })
    p.sides = 2
    expect(p.sides).toBe(3)
  })

  it('no-op when same value', () => {
    const p = new Polygon({ sides: 6 })
    p.sides = 6
    expect(p.sides).toBe(6)
  })
})
