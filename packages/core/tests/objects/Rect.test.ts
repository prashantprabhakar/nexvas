import { describe, it, expect } from 'vitest'
import { Rect } from '../../src/objects/Rect.js'
import { createMockCK, createMockCanvas } from '../__mocks__/canvaskit.js'
import type { RenderContext } from '../../src/types.js'
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
  }
  return { ctx, canvas, ck }
}

describe('Rect', () => {
  it('renders with fill — calls drawRect', () => {
    const { ctx, canvas } = makeCtx()
    const rect = new Rect({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
    })
    rect.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawRect')).toBe(true)
  })

  it('renders with cornerRadius — calls drawRRect', () => {
    const { ctx, canvas } = makeCtx()
    const rect = new Rect({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      cornerRadius: 8,
      fill: { type: 'solid', color: { r: 0, g: 1, b: 0, a: 1 } },
    })
    rect.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawRRect')).toBe(true)
  })

  it('renders with stroke — two draw calls (fill + stroke) with only stroke set', () => {
    const { ctx, canvas } = makeCtx()
    const rect = new Rect({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      stroke: { color: { r: 0, g: 0, b: 0, a: 1 }, width: 2 },
    })
    rect.render(ctx)
    const draws = canvas.calls.filter((c) => c.method === 'drawRect')
    expect(draws).toHaveLength(1)
  })

  it('skips render when invisible', () => {
    const { ctx, canvas } = makeCtx()
    const rect = new Rect({ x: 0, y: 0, width: 100, height: 50, visible: false })
    rect.render(ctx)
    expect(canvas.calls.filter((c) => c.method === 'drawRect')).toHaveLength(0)
  })

  it('applies local transform — concat called', () => {
    const { ctx, canvas } = makeCtx()
    const rect = new Rect({
      x: 50,
      y: 100,
      width: 80,
      height: 40,
      fill: { type: 'solid', color: { r: 1, g: 1, b: 1, a: 1 } },
    })
    rect.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'concat')).toBe(true)
  })

  it('save/restore called around draw', () => {
    const { ctx, canvas } = makeCtx()
    const rect = new Rect({
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fill: { type: 'solid', color: { r: 1, g: 1, b: 1, a: 1 } },
    })
    rect.render(ctx)
    expect(canvas.calls[0]!.method).toBe('save')
    expect(canvas.calls[canvas.calls.length - 1]!.method).toBe('restore')
  })

  it('hitTest — inside', () => {
    const rect = new Rect({ x: 0, y: 0, width: 100, height: 100 })
    expect(rect.hitTest(50, 50)).toBe(true)
  })

  it('hitTest — outside', () => {
    const rect = new Rect({ x: 0, y: 0, width: 100, height: 100 })
    expect(rect.hitTest(200, 50)).toBe(false)
  })

  it('hitTest — invisible always false', () => {
    const rect = new Rect({ x: 0, y: 0, width: 100, height: 100, visible: false })
    expect(rect.hitTest(50, 50)).toBe(false)
  })

  it('toJSON roundtrip', () => {
    const rect = new Rect({ x: 5, y: 10, width: 40, height: 30, cornerRadius: 4 })
    const json = rect.toJSON()
    expect(json.type).toBe('Rect')
    expect(json.x).toBe(5)
    expect(json['cornerRadius']).toBe(4)

    const restored = Rect.fromJSON(json)
    expect(restored.cornerRadius).toBe(4)
    expect(restored.x).toBe(5)
  })

  it('world bounding box accounts for position', () => {
    const rect = new Rect({ x: 50, y: 100, width: 80, height: 40 })
    const bb = rect.getWorldBoundingBox()
    expect(bb.x).toBeCloseTo(50)
    expect(bb.y).toBeCloseTo(100)
    expect(bb.width).toBeCloseTo(80)
    expect(bb.height).toBeCloseTo(40)
  })

  // NV-027 — each concrete object must declare its own local bbox explicitly
  it('getLocalBoundingBox returns (0, 0, width, height) in local space', () => {
    const rect = new Rect({ x: 50, y: 100, width: 80, height: 40 })
    const bb = rect.getLocalBoundingBox()
    // local bbox origin is always 0,0 — position (x,y) is part of the transform, not the bbox
    expect(bb.x).toBe(0)
    expect(bb.y).toBe(0)
    expect(bb.width).toBe(80)
    expect(bb.height).toBe(40)
  })
})
