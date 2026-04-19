import { describe, it, expect } from 'vitest'
import { Star } from '../../src/objects/Star.js'
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

describe('Star — construction', () => {
  it('defaults to 5 points and 0.4 innerRadius', () => {
    const s = new Star({ x: 0, y: 0, width: 100, height: 100 })
    expect(s.points).toBe(5)
    expect(s.innerRadius).toBeCloseTo(0.4)
    expect(s.getType()).toBe('Star')
  })

  it('accepts explicit points and innerRadius', () => {
    const s = new Star({ points: 6, innerRadius: 0.5 })
    expect(s.points).toBe(6)
    expect(s.innerRadius).toBeCloseTo(0.5)
  })

  it('clamps points to minimum 3', () => {
    const s = new Star({ points: 1 })
    expect(s.points).toBe(3)
  })

  it('rounds fractional points', () => {
    const s = new Star({ points: 4.7 })
    expect(s.points).toBe(5)
  })

  it('clamps innerRadius to [0, 1]', () => {
    expect(new Star({ innerRadius: -0.1 }).innerRadius).toBeCloseTo(0)
    expect(new Star({ innerRadius: 1.5 }).innerRadius).toBeCloseTo(1)
  })
})

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

describe('Star — bounding box', () => {
  it('getLocalBoundingBox returns (0, 0, width, height)', () => {
    const s = new Star({ x: 50, y: 100, width: 80, height: 60 })
    const bb = s.getLocalBoundingBox()
    expect(bb.x).toBe(0)
    expect(bb.y).toBe(0)
    expect(bb.width).toBe(80)
    expect(bb.height).toBe(60)
  })

  it('world bounding box accounts for position', () => {
    const s = new Star({ x: 20, y: 30, width: 100, height: 100 })
    const bb = s.getWorldBoundingBox()
    expect(bb.x).toBeCloseTo(20)
    expect(bb.y).toBeCloseTo(30)
    expect(bb.width).toBeCloseTo(100)
    expect(bb.height).toBeCloseTo(100)
  })
})

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

describe('Star — hitTest', () => {
  it('returns false when invisible', () => {
    const s = new Star({ x: 0, y: 0, width: 100, height: 100, visible: false })
    expect(s.hitTest(50, 50)).toBe(false)
  })

  it('returns true for center point before render (bbox fallback)', () => {
    const s = new Star({ x: 0, y: 0, width: 100, height: 100 })
    expect(s.hitTest(50, 50)).toBe(true)
  })

  it('returns false outside bbox before render', () => {
    const s = new Star({ x: 0, y: 0, width: 100, height: 100 })
    expect(s.hitTest(200, 200)).toBe(false)
  })

  it('uses path-based hit test after render', () => {
    const { ctx } = makeCtx()
    const s = new Star({ x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } })
    s.render(ctx)
    // Mock path.contains always returns false — confirms path-based branch is taken
    expect(s.hitTest(50, 50)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('Star — render', () => {
  it('calls drawPath with fill', () => {
    const { ctx, canvas } = makeCtx()
    const s = new Star({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
    })
    s.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawPath')).toBe(true)
  })

  it('calls drawPath with stroke', () => {
    const { ctx, canvas } = makeCtx()
    const s = new Star({
      x: 0, y: 0, width: 100, height: 100,
      stroke: { color: { r: 0, g: 0, b: 1, a: 1 }, width: 2 },
    })
    s.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawPath')).toBe(true)
  })

  it('calls drawPath twice with both fill and stroke', () => {
    const { ctx, canvas } = makeCtx()
    const s = new Star({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
      stroke: { color: { r: 0, g: 0, b: 0, a: 1 }, width: 2 },
    })
    s.render(ctx)
    expect(canvas.calls.filter((c) => c.method === 'drawPath')).toHaveLength(2)
  })

  it('skips render when invisible', () => {
    const { ctx, canvas } = makeCtx()
    const s = new Star({ visible: false, fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } })
    s.render(ctx)
    expect(canvas.calls.filter((c) => c.method === 'drawPath')).toHaveLength(0)
  })

  it('wraps draw in save/restore', () => {
    const { ctx, canvas } = makeCtx()
    const s = new Star({
      x: 0, y: 0, width: 80, height: 80,
      fill: { type: 'solid', color: { r: 1, g: 1, b: 1, a: 1 } },
    })
    s.render(ctx)
    expect(canvas.calls[0]!.method).toBe('save')
    expect(canvas.calls[canvas.calls.length - 1]!.method).toBe('restore')
  })

  it('applies concat (local transform)', () => {
    const { ctx, canvas } = makeCtx()
    const s = new Star({
      x: 50, y: 50, width: 80, height: 80,
      fill: { type: 'solid', color: { r: 1, g: 1, b: 1, a: 1 } },
    })
    s.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'concat')).toBe(true)
  })

  it('calls saveLayer when effects are present', () => {
    const { ctx, canvas } = makeCtx()
    const s = new Star({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
      effects: [{ type: 'drop-shadow', offsetX: 2, offsetY: 2, blur: 4, color: { r: 0, g: 0, b: 0, a: 0.5 } }],
    })
    s.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'saveLayer')).toBe(true)
  })

  it('path cache is reused on second render (same key)', () => {
    const { ctx, canvas } = makeCtx()
    const s = new Star({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
    })
    s.render(ctx)
    const firstDrawCount = canvas.calls.filter((c) => c.method === 'drawPath').length
    canvas.calls.length = 0
    s.render(ctx)
    expect(canvas.calls.filter((c) => c.method === 'drawPath').length).toBe(firstDrawCount)
  })
})

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

describe('Star — ports', () => {
  it('returns points + 1 default ports (outer tips + center)', () => {
    const s = new Star({ points: 5, width: 100, height: 100 })
    const ports = s.getDefaultPorts()
    expect(ports).toHaveLength(6) // 5 outer tips + center
  })

  it('outer port ids are point-0 through point-N', () => {
    const s = new Star({ points: 3, width: 100, height: 100 })
    const ports = s.getDefaultPorts()
    expect(ports[0]!.id).toBe('point-0')
    expect(ports[1]!.id).toBe('point-1')
    expect(ports[2]!.id).toBe('point-2')
    expect(ports[3]!.id).toBe('center')
  })

  it('center port is at (0.5, 0.5)', () => {
    const s = new Star({ points: 5, width: 100, height: 100 })
    const center = s.getDefaultPorts().find((pt) => pt.id === 'center')!
    expect(center.relX).toBeCloseTo(0.5)
    expect(center.relY).toBeCloseTo(0.5)
  })

  it('top outer tip of 5-point star is at relY ≈ 0', () => {
    const s = new Star({ points: 5, width: 100, height: 100 })
    const top = s.getDefaultPorts()[0]!
    expect(top.relX).toBeCloseTo(0.5)
    expect(top.relY).toBeCloseTo(0)
  })

  it('getPortWorldPosition returns null for unknown port', () => {
    const s = new Star({ points: 5, width: 100, height: 100 })
    expect(s.getPortWorldPosition('nonexistent')).toBeNull()
  })

  it('getPortWorldPosition resolves center port', () => {
    const s = new Star({ x: 0, y: 0, points: 5, width: 100, height: 100 })
    const pos = s.getPortWorldPosition('center')
    expect(pos).not.toBeNull()
    expect(pos!.x).toBeCloseTo(50)
    expect(pos!.y).toBeCloseTo(50)
  })
})

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

describe('Star — serialization', () => {
  it('toJSON includes points and innerRadius', () => {
    const s = new Star({ x: 10, y: 20, width: 80, height: 80, points: 6, innerRadius: 0.5 })
    const json = s.toJSON()
    expect(json.type).toBe('Star')
    expect(json['points']).toBe(6)
    expect(json['innerRadius']).toBeCloseTo(0.5)
    expect(json.x).toBe(10)
  })

  it('fromJSON roundtrip preserves all props', () => {
    const s = new Star({ x: 5, y: 15, width: 60, height: 60, points: 7, innerRadius: 0.3,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } })
    const restored = Star.fromJSON(s.toJSON())
    expect(restored.points).toBe(7)
    expect(restored.innerRadius).toBeCloseTo(0.3)
    expect(restored.x).toBe(5)
    expect(restored.y).toBe(15)
    expect(restored.width).toBe(60)
    expect(restored.fill).not.toBeNull()
  })

  it('fromJSON clamps points < 3', () => {
    const s = new Star({ points: 5 })
    const json = { ...s.toJSON(), points: 1 }
    const restored = Star.fromJSON(json)
    expect(restored.points).toBe(3)
  })

  it('fromJSON clamps innerRadius outside [0, 1]', () => {
    const s = new Star()
    const jsonOver = { ...s.toJSON(), innerRadius: 2 }
    expect(Star.fromJSON(jsonOver).innerRadius).toBeCloseTo(1)
    const jsonUnder = { ...s.toJSON(), innerRadius: -0.5 }
    expect(Star.fromJSON(jsonUnder).innerRadius).toBeCloseTo(0)
  })

  it('objectFromJSON dispatches to Star', () => {
    const s = new Star({ points: 6, innerRadius: 0.45, width: 80, height: 80 })
    const restored = objectFromJSON(s.toJSON())
    expect(restored).toBeInstanceOf(Star)
    expect((restored as Star).points).toBe(6)
    expect((restored as Star).innerRadius).toBeCloseTo(0.45)
  })
})

// ---------------------------------------------------------------------------
// Transform
// ---------------------------------------------------------------------------

describe('Star — transform', () => {
  it('rotation does not change local bounding box', () => {
    const s = new Star({ x: 0, y: 0, width: 100, height: 100, rotation: Math.PI / 4 })
    const bb = s.getLocalBoundingBox()
    expect(bb.width).toBe(100)
    expect(bb.height).toBe(100)
  })

  it('world bbox accounts for position after translation', () => {
    const s = new Star({ x: 100, y: 200, width: 50, height: 50 })
    const bb = s.getWorldBoundingBox()
    expect(bb.x).toBeCloseTo(100)
    expect(bb.y).toBeCloseTo(200)
  })
})

// ---------------------------------------------------------------------------
// points / innerRadius setters
// ---------------------------------------------------------------------------

describe('Star — property setters', () => {
  it('updating points invalidates path cache', () => {
    const { ctx } = makeCtx()
    const s = new Star({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
    })
    s.render(ctx)
    s.points = 3
    expect(s.points).toBe(3)
    const { ctx: ctx2 } = makeCtx()
    expect(() => s.render(ctx2)).not.toThrow()
  })

  it('updating innerRadius invalidates path cache', () => {
    const { ctx } = makeCtx()
    const s = new Star({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
    })
    s.render(ctx)
    s.innerRadius = 0.7
    expect(s.innerRadius).toBeCloseTo(0.7)
    const { ctx: ctx2 } = makeCtx()
    expect(() => s.render(ctx2)).not.toThrow()
  })

  it('clamps points below 3', () => {
    const s = new Star({ points: 6 })
    s.points = 2
    expect(s.points).toBe(3)
  })

  it('clamps innerRadius above 1', () => {
    const s = new Star({ innerRadius: 0.4 })
    s.innerRadius = 1.5
    expect(s.innerRadius).toBeCloseTo(1)
  })

  it('clamps innerRadius below 0', () => {
    const s = new Star({ innerRadius: 0.4 })
    s.innerRadius = -0.1
    expect(s.innerRadius).toBeCloseTo(0)
  })

  it('no-op when same points value', () => {
    const s = new Star({ points: 5 })
    s.points = 5
    expect(s.points).toBe(5)
  })
})
