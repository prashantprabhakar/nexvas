import { describe, it, expect } from 'vitest'
import { Group } from '../../src/objects/Group.js'
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
    fontManager: {} as unknown as FontManager,
    pixelRatio: 1,
    viewport: { x: 0, y: 0, scale: 1, width: 800, height: 600 },
  }
  return { ctx, canvas, ck }
}

describe('Group', () => {
  it('add/remove child', () => {
    const g = new Group()
    const r = new Rect()
    g.add(r)
    expect(g.children).toHaveLength(1)
    expect(r.parent).toBe(g)
    g.remove(r)
    expect(g.children).toHaveLength(0)
    expect(r.parent).toBeNull()
  })

  it('throws when adding child with existing parent', () => {
    const g1 = new Group()
    const g2 = new Group()
    const r = new Rect()
    g1.add(r)
    expect(() => g2.add(r)).toThrow()
  })

  it('clear removes all children', () => {
    const g = new Group()
    g.add(new Rect()).add(new Rect())
    g.clear()
    expect(g.children).toHaveLength(0)
  })

  it('getById finds nested child', () => {
    const g = new Group()
    const inner = new Group()
    const r = new Rect()
    inner.add(r)
    g.add(inner)
    expect(g.getById(r.id)).toBe(r)
  })

  it('render calls save/restore and concat for transform', () => {
    const { ctx, canvas } = makeCtx()
    const g = new Group({ x: 50, y: 50, width: 200, height: 200 })
    g.add(
      new Rect({
        x: 0,
        y: 0,
        width: 50,
        height: 50,
        fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
      }),
    )
    g.render(ctx)
    expect(canvas.calls[0]!.method).toBe('save')
    expect(canvas.calls.some((c) => c.method === 'concat')).toBe(true)
    expect(canvas.calls[canvas.calls.length - 1]!.method).toBe('restore')
  })

  it('render with clip=true calls clipRect', () => {
    const { ctx, canvas } = makeCtx()
    const g = new Group({ x: 0, y: 0, width: 100, height: 100, clip: true })
    g.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'clipRect')).toBe(true)
  })

  it('render without clip does not call clipRect', () => {
    const { ctx, canvas } = makeCtx()
    const g = new Group({ x: 0, y: 0, width: 100, height: 100, clip: false })
    g.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'clipRect')).toBe(false)
  })

  it('hitTest returns true when child is hit', () => {
    const g = new Group()
    g.add(new Rect({ x: 10, y: 10, width: 80, height: 80 }))
    expect(g.hitTest(50, 50)).toBe(true)
    expect(g.hitTest(200, 200)).toBe(false)
  })

  it('hitTestChild returns correct child', () => {
    const g = new Group()
    const a = new Rect({ x: 0, y: 0, width: 100, height: 100 })
    const b = new Rect({ x: 0, y: 0, width: 100, height: 100 })
    g.add(a).add(b)
    expect(g.hitTestChild(50, 50)).toBe(b) // topmost
  })

  it('getWorldBoundingBox unions children', () => {
    const g = new Group({ x: 10, y: 10 })
    g.add(new Rect({ x: 0, y: 0, width: 50, height: 50 }))
    g.add(new Rect({ x: 40, y: 40, width: 50, height: 50 }))
    const bb = g.getWorldBoundingBox()
    expect(bb.width).toBe(90) // from x=10 to x=100
    expect(bb.height).toBe(90)
  })

  it('nested transforms compose correctly', () => {
    const outer = new Group({ x: 100, y: 0 })
    const inner = new Rect({ x: 50, y: 0, width: 10, height: 10 })
    outer.add(inner)
    const bb = inner.getWorldBoundingBox()
    expect(bb.x).toBeCloseTo(150) // 100 + 50
  })

  it('toJSON includes children', () => {
    const g = new Group()
    g.add(new Rect({ x: 5, y: 5, width: 10, height: 10 }))
    const json = g.toJSON()
    expect(json['children']).toHaveLength(1)
    expect(json['clip']).toBe(false)
  })

  it('destroy cleans up children', () => {
    const g = new Group()
    const r = new Rect()
    g.add(r)
    g.destroy()
    expect(g.children).toHaveLength(0)
    expect(r.parent).toBeNull()
  })

  // NV-027 — getLocalBoundingBox must be computed from children, not from
  // Group's own x/y/width/height fields (which are semantically meaningless
  // for a Group that simply contains other objects).
  describe('getLocalBoundingBox (NV-027)', () => {
    it('returns zero-size box for an empty group', () => {
      const g = new Group()
      const bbox = g.getLocalBoundingBox()
      expect(bbox.width).toBe(0)
      expect(bbox.height).toBe(0)
    })

    it('returns the union of children local bboxes', () => {
      const g = new Group()
      g.add(new Rect({ x: 10, y: 10, width: 50, height: 30 }))
      g.add(new Rect({ x: 70, y: 20, width: 40, height: 20 }))
      // children span x∈[10,110], y∈[10,40] in group-local space
      const bbox = g.getLocalBoundingBox()
      expect(bbox.x).toBe(10)
      expect(bbox.y).toBe(10)
      expect(bbox.right).toBe(110)
      expect(bbox.bottom).toBe(40)
    })

    it('ignores invisible children', () => {
      const g = new Group()
      g.add(new Rect({ x: 10, y: 10, width: 50, height: 30 }))
      g.add(new Rect({ x: 200, y: 200, width: 50, height: 50, visible: false }))
      const bbox = g.getLocalBoundingBox()
      expect(bbox.right).toBeLessThan(200)
    })

    it('accounts for child local transforms', () => {
      const g = new Group()
      // Child is offset by (20, 30) in the group's local space
      g.add(new Rect({ x: 20, y: 30, width: 60, height: 40 }))
      const bbox = g.getLocalBoundingBox()
      expect(bbox.x).toBe(20)
      expect(bbox.y).toBe(30)
      expect(bbox.right).toBe(80)
      expect(bbox.bottom).toBe(70)
    })
  })
})
