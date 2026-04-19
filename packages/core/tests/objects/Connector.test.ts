import { describe, it, expect } from 'vitest'
import { Connector } from '../../src/objects/Connector.js'
import { Rect } from '../../src/objects/Rect.js'
import { createMockCK, createMockCanvas } from '../__mocks__/canvaskit.js'
import { objectFromJSON } from '../../src/objects/objectFromJSON.js'
import type { RenderContext, StageInterface } from '../../src/types.js'
import type { FontManager } from '../../src/FontManager.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStage(objects: Rect[] = []): StageInterface {
  return {
    getObjectById: (id: string) => objects.find((o) => o.id === id),
    find: (pred: (o: unknown) => boolean) => objects.filter(pred as (o: Rect) => boolean),
    findByType: () => [],
    layers: [],
    viewport: {} as StageInterface['viewport'],
    fonts: {} as FontManager,
    canvasKit: {} as StageInterface['canvasKit'],
    id: 'mock-stage',
    on: () => {},
    off: () => {},
    emit: () => {},
    addRenderPass: () => {},
    removeRenderPass: () => {},
    getBoundingBox: () => ({ x: 0, y: 0, width: 0, height: 0 }) as never,
    render: () => {},
    markDirty: () => {},
    resize: () => {},
    registerObject: () => {},
    getObjectLayer: () => null,
    bringToFront: () => {},
    sendToBack: () => {},
    bringForward: () => {},
    sendBackward: () => {},
    groupObjects: () => ({}) as never,
    ungroupObject: () => [],
    batch: (fn: () => void) => fn(),
  } as unknown as StageInterface
}

function makeCtx(stage?: StageInterface) {
  const ck = createMockCK()
  const canvas = createMockCanvas()
  const ctx: RenderContext = {
    skCanvas: canvas,
    canvasKit: ck,
    fontManager: null,
    pixelRatio: 1,
    viewport: { x: 0, y: 0, scale: 1, width: 800, height: 600 },
    stage: stage ?? makeStage(),
  }
  return { ctx, canvas, ck }
}

// ---------------------------------------------------------------------------
// Construction & defaults
// ---------------------------------------------------------------------------

describe('Connector — construction', () => {
  it('creates with fixed endpoints and defaults', () => {
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 100 } })
    expect(c.getType()).toBe('Connector')
    expect(c.routing).toBe('straight')
    expect(c.label).toBe('')
    expect(c.labelOffset).toBe(0.5)
    expect(c.waypoints).toEqual([])
  })

  it('accepts all routing modes', () => {
    const straight = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 }, routing: 'straight' })
    const ortho = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 }, routing: 'orthogonal' })
    const curved = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 }, routing: 'curved' })
    expect(straight.routing).toBe('straight')
    expect(ortho.routing).toBe('orthogonal')
    expect(curved.routing).toBe('curved')
  })

  it('sets label and labelOffset', () => {
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 }, label: 'Yes', labelOffset: 0.3 })
    expect(c.label).toBe('Yes')
    expect(c.labelOffset).toBe(0.3)
  })
})

// ---------------------------------------------------------------------------
// Render — fixed endpoints
// ---------------------------------------------------------------------------

describe('Connector — render (fixed endpoints)', () => {
  it('renders straight connector — calls drawPath', () => {
    const { ctx, canvas } = makeCtx()
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 } })
    c.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawPath')).toBe(true)
  })

  it('renders orthogonal connector', () => {
    const { ctx, canvas } = makeCtx()
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 100 }, routing: 'orthogonal' })
    c.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawPath')).toBe(true)
  })

  it('renders curved connector', () => {
    const { ctx, canvas } = makeCtx()
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 100 }, routing: 'curved' })
    c.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawPath')).toBe(true)
  })

  it('does not render when invisible', () => {
    const { ctx, canvas } = makeCtx()
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 }, visible: false })
    c.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawPath')).toBe(false)
  })

  it('uses save/restore around draw', () => {
    const { ctx, canvas } = makeCtx()
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 } })
    c.render(ctx)
    const saves = canvas.calls.filter((c) => c.method === 'save').length
    const restores = canvas.calls.filter((c) => c.method === 'restore').length
    expect(saves).toBe(restores)
    expect(saves).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Render — object port references
// ---------------------------------------------------------------------------

describe('Connector — render (port references)', () => {
  it('resolves source and target from object ports', () => {
    const rect1 = new Rect({ id: 'r1', x: 0, y: 0, width: 100, height: 60 })
    const rect2 = new Rect({ id: 'r2', x: 300, y: 0, width: 100, height: 60 })
    const stage = makeStage([rect1, rect2])
    const { ctx, canvas } = makeCtx(stage)

    const c = new Connector({
      source: { objectId: 'r1', portId: 'right' },
      target: { objectId: 'r2', portId: 'left' },
    })
    c.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawPath')).toBe(true)
  })

  it('skips render when objectId not found', () => {
    const { ctx, canvas } = makeCtx(makeStage([]))
    const c = new Connector({
      source: { objectId: 'missing', portId: 'right' },
      target: { x: 200, y: 0 },
    })
    c.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawPath')).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Bounding box
// ---------------------------------------------------------------------------

describe('Connector — getLocalBoundingBox', () => {
  it('returns bbox from fixed endpoints before first render', () => {
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 200, y: 100 } })
    const bb = c.getLocalBoundingBox()
    expect(bb.width).toBeGreaterThan(0)
    expect(bb.height).toBeGreaterThan(0)
  })

  it('updates bbox after render', () => {
    const { ctx } = makeCtx()
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 200, y: 0 }, routing: 'straight' })
    c.render(ctx)
    const bb = c.getLocalBoundingBox()
    // bbox must span at least the full x range of the straight line
    expect(bb.x).toBeLessThanOrEqual(0)
    expect(bb.x + bb.width).toBeGreaterThanOrEqual(200)
  })
})

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

describe('Connector — hitTest', () => {
  it('returns false before first render (no cached route)', () => {
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 } })
    expect(c.hitTest(50, 0)).toBe(false)
  })

  it('hits on a straight horizontal line', () => {
    const { ctx } = makeCtx()
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 } })
    c.render(ctx)
    expect(c.hitTest(50, 0, 8)).toBe(true)
  })

  it('misses far from the line', () => {
    const { ctx } = makeCtx()
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 } })
    c.render(ctx)
    expect(c.hitTest(50, 100, 8)).toBe(false)
  })

  it('hits on orthogonal connector corners', () => {
    const { ctx } = makeCtx()
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 100 }, routing: 'orthogonal' })
    c.render(ctx)
    // midpoint column x=50 should be hit
    expect(c.hitTest(50, 50, 8)).toBe(true)
  })

  it('returns false when invisible', () => {
    const { ctx } = makeCtx()
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 }, visible: false })
    c.render(ctx)
    expect(c.hitTest(50, 0)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Serialization round-trip
// ---------------------------------------------------------------------------

describe('Connector — serialization', () => {
  it('round-trips via toJSON / fromJSON', () => {
    const c = new Connector({
      source: { x: 10, y: 20 },
      target: { objectId: 'rect-1', portId: 'left' },
      routing: 'orthogonal',
      label: 'Yes',
      labelOffset: 0.3,
      waypoints: [{ x: 50, y: 50 }],
    })

    const json = c.toJSON()
    expect(json.type).toBe('Connector')
    expect(json.sourceRef).toEqual({ x: 10, y: 20 })
    expect(json.targetRef).toEqual({ objectId: 'rect-1', portId: 'left' })
    expect(json.routing).toBe('orthogonal')
    expect(json.label).toBe('Yes')
    expect(json.labelOffset).toBe(0.3)
    expect(json.waypoints).toEqual([{ x: 50, y: 50 }])

    const restored = Connector.fromJSON(json)
    expect(restored.routing).toBe('orthogonal')
    expect(restored.label).toBe('Yes')
    expect(restored.labelOffset).toBe(0.3)
    expect(restored.waypoints).toEqual([{ x: 50, y: 50 }])
    const src = restored.source as { x: number; y: number }
    expect(src.x).toBe(10)
    expect(src.y).toBe(20)
  })

  it('objectFromJSON dispatches to Connector', () => {
    const c = new Connector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 } })
    const restored = objectFromJSON(c.toJSON())
    expect(restored).toBeInstanceOf(Connector)
  })

  it('round-trips ref endpoints', () => {
    const c = new Connector({
      source: { objectId: 'a', portId: 'right' },
      target: { objectId: 'b', portId: 'left' },
    })
    const restored = Connector.fromJSON(c.toJSON())
    const src = restored.source as { objectId: string; portId: string }
    expect(src.objectId).toBe('a')
    expect(src.portId).toBe('right')
  })
})

// ---------------------------------------------------------------------------
// Waypoints
// ---------------------------------------------------------------------------

describe('Connector — waypoints', () => {
  it('straight routing with waypoint passes through it', () => {
    const { ctx } = makeCtx()
    const c = new Connector({
      source: { x: 0, y: 0 },
      target: { x: 100, y: 0 },
      routing: 'straight',
      waypoints: [{ x: 50, y: 30 }],
    })
    c.render(ctx)
    // Should hit near the waypoint
    expect(c.hitTest(50, 30, 4)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Path caching
// ---------------------------------------------------------------------------

describe('Connector — path caching', () => {
  it('renders drawPath on each frame', () => {
    const { ctx } = makeCtx()
    const canvas = ctx.skCanvas as ReturnType<typeof createMockCanvas>
    const c = new Connector({
      source: { x: 0, y: 0 },
      target: { x: 100, y: 0 },
      stroke: { color: { r: 0, g: 0, b: 0, a: 1 }, width: 2 }, // no arrowheads
    })
    c.render(ctx)
    const after1 = canvas.calls.filter((x) => x.method === 'drawPath').length
    c.render(ctx)
    const after2 = canvas.calls.filter((x) => x.method === 'drawPath').length
    expect(after1).toBeGreaterThan(0)
    expect(after2).toBe(after1 * 2)
  })
})
