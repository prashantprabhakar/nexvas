import { describe, it, expect, vi } from 'vitest'
import { makeEffectPaint, effectsCacheKey } from '../../src/renderer/paint.js'
import { Rect } from '../../src/objects/Rect.js'
import { Circle } from '../../src/objects/Circle.js'
import { createMockCK, createMockCanvas } from '../__mocks__/canvaskit.js'
import type { DropShadowEffect, BlurEffect, Effect, RenderContext } from '../../src/types.js'
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

const shadowEffect: DropShadowEffect = {
  type: 'drop-shadow',
  offsetX: 4,
  offsetY: 4,
  blur: 8,
  color: { r: 0, g: 0, b: 0, a: 0.5 },
}

const blurEffect: BlurEffect = { type: 'blur', radius: 5 }

// ---------------------------------------------------------------------------
// Type shape tests
// ---------------------------------------------------------------------------

describe('Effect types', () => {
  it('DropShadowEffect is assignable to Effect union', () => {
    const effect: Effect = shadowEffect
    expect(effect.type).toBe('drop-shadow')
  })

  it('BlurEffect is assignable to Effect union', () => {
    const effect: Effect = blurEffect
    expect(effect.type).toBe('blur')
  })

  it('DropShadowEffect has required fields', () => {
    expect(shadowEffect.offsetX).toBe(4)
    expect(shadowEffect.offsetY).toBe(4)
    expect(shadowEffect.blur).toBe(8)
    expect(shadowEffect.color).toEqual({ r: 0, g: 0, b: 0, a: 0.5 })
  })

  it('BlurEffect has required radius field', () => {
    expect(blurEffect.radius).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// effectsCacheKey
// ---------------------------------------------------------------------------

describe('effectsCacheKey', () => {
  it('returns same key for identical effects array', () => {
    const effects: Effect[] = [shadowEffect]
    expect(effectsCacheKey(effects)).toBe(effectsCacheKey(effects))
  })

  it('differs when offset changes', () => {
    const k1 = effectsCacheKey([{ type: 'drop-shadow', offsetX: 2, offsetY: 2, blur: 4, color: { r: 0, g: 0, b: 0, a: 1 } }])
    const k2 = effectsCacheKey([{ type: 'drop-shadow', offsetX: 8, offsetY: 8, blur: 4, color: { r: 0, g: 0, b: 0, a: 1 } }])
    expect(k1).not.toBe(k2)
  })

  it('differs between drop-shadow and blur', () => {
    expect(effectsCacheKey([shadowEffect])).not.toBe(effectsCacheKey([blurEffect]))
  })

  it('returns stable key for empty array', () => {
    expect(effectsCacheKey([])).toBe('[]')
  })
})

// ---------------------------------------------------------------------------
// makeEffectPaint — drop-shadow
// ---------------------------------------------------------------------------

describe('makeEffectPaint — drop-shadow', () => {
  it('calls ImageFilter.MakeDropShadow with correct args', () => {
    const { ck } = makeCtx()
    const spy = vi.spyOn(ck.ImageFilter, 'MakeDropShadow')
    makeEffectPaint(ck, [shadowEffect])
    expect(spy).toHaveBeenCalledOnce()
    const [dx, dy, sx, sy] = spy.mock.calls[0] as [number, number, number, number]
    expect(dx).toBe(4)
    expect(dy).toBe(4)
    expect(sx).toBe(8)
    expect(sy).toBe(8)
  })

  it('encodes shadow color correctly', () => {
    const { ck } = makeCtx()
    const colorSpy = vi.spyOn(ck, 'Color4f')
    makeEffectPaint(ck, [shadowEffect])
    // Color4f called once for the shadow color
    const shadowColorCall = colorSpy.mock.calls.find(
      ([r, g, b, a]) => r === 0 && g === 0 && b === 0 && a === 0.5,
    )
    expect(shadowColorCall).toBeDefined()
  })
})

// ---------------------------------------------------------------------------
// makeEffectPaint — blur
// ---------------------------------------------------------------------------

describe('makeEffectPaint — blur', () => {
  it('calls ImageFilter.MakeBlur with equal sigma on both axes', () => {
    const { ck } = makeCtx()
    const spy = vi.spyOn(ck.ImageFilter, 'MakeBlur')
    makeEffectPaint(ck, [blurEffect])
    expect(spy).toHaveBeenCalledOnce()
    const [sx, sy] = spy.mock.calls[0] as [number, number]
    expect(sx).toBe(5)
    expect(sy).toBe(5)
  })
})

// ---------------------------------------------------------------------------
// makeEffectPaint — multiple effects
// ---------------------------------------------------------------------------

describe('makeEffectPaint — multiple effects', () => {
  it('calls MakeCompose when two effects are present', () => {
    const { ck } = makeCtx()
    const composeSpy = vi.spyOn(ck.ImageFilter, 'MakeCompose')
    makeEffectPaint(ck, [shadowEffect, blurEffect])
    expect(composeSpy).toHaveBeenCalledOnce()
  })

  it('does NOT call MakeCompose for a single effect', () => {
    const { ck } = makeCtx()
    const composeSpy = vi.spyOn(ck.ImageFilter, 'MakeCompose')
    makeEffectPaint(ck, [shadowEffect])
    expect(composeSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Rect render — effects via saveLayer
// ---------------------------------------------------------------------------

describe('Rect — effects save-layer', () => {
  it('calls saveLayer when effects are set', () => {
    const { ctx, canvas } = makeCtx()
    const rect = new Rect({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
      effects: [shadowEffect],
    })
    rect.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'saveLayer')).toBe(true)
  })

  it('does NOT call saveLayer when effects is empty', () => {
    const { ctx, canvas } = makeCtx()
    const rect = new Rect({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
    })
    rect.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'saveLayer')).toBe(false)
  })

  it('save/saveLayer count matches restore count', () => {
    const { ctx, canvas } = makeCtx()
    const rect = new Rect({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
      effects: [shadowEffect],
    })
    rect.render(ctx)
    const saves = canvas.calls.filter((c) => c.method === 'save').length
    const saveLayerCount = canvas.calls.filter((c) => c.method === 'saveLayer').length
    const restores = canvas.calls.filter((c) => c.method === 'restore').length
    expect(restores).toBe(saves + saveLayerCount)
  })

  it('reuses effect paint cache on second render', () => {
    const { ctx, ck } = makeCtx()
    const spy = vi.spyOn(ck.ImageFilter, 'MakeDropShadow')
    const rect = new Rect({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
      effects: [shadowEffect],
    })
    rect.render(ctx)
    rect.render(ctx)
    // Paint built once, reused on second call
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('rebuilds effect paint when effects change', () => {
    const { ctx, ck } = makeCtx()
    const spy = vi.spyOn(ck.ImageFilter, 'MakeDropShadow')
    const rect = new Rect({
      x: 0, y: 0, width: 100, height: 100,
      fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
      effects: [shadowEffect],
    })
    rect.render(ctx)
    rect.effects = [{ type: 'drop-shadow', offsetX: 10, offsetY: 10, blur: 16, color: { r: 0, g: 0, b: 0, a: 1 } }]
    rect.render(ctx)
    expect(spy).toHaveBeenCalledTimes(2)
  })
})

// ---------------------------------------------------------------------------
// Circle render — effects
// ---------------------------------------------------------------------------

describe('Circle — effects save-layer', () => {
  it('calls saveLayer when effects are set', () => {
    const { ctx, canvas } = makeCtx()
    const circle = new Circle({
      cx: 50, cy: 50, radius: 50,
      fill: { type: 'solid', color: { r: 0, g: 0, b: 1, a: 1 } },
      effects: [blurEffect],
    })
    circle.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'saveLayer')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// BaseObject — effects serialization
// ---------------------------------------------------------------------------

describe('BaseObject — effects serialization', () => {
  it('serializes effects in toJSON when non-empty', () => {
    const effects: Effect[] = [shadowEffect]
    const rect = new Rect({ effects })
    const json = rect.toJSON()
    expect(json['effects']).toEqual(effects)
  })

  it('omits effects from toJSON when empty', () => {
    const rect = new Rect()
    const json = rect.toJSON()
    expect('effects' in json).toBe(false)
  })

  it('restores drop-shadow effect from fromJSON round-trip', () => {
    const effects: Effect[] = [shadowEffect]
    const rect = new Rect({ effects })
    const restored = Rect.fromJSON(rect.toJSON())
    expect(restored.effects).toEqual(effects)
  })

  it('restores blur effect from fromJSON round-trip', () => {
    const effects: Effect[] = [blurEffect]
    const circle = new Circle({ effects })
    const restored = Circle.fromJSON(circle.toJSON())
    expect(restored.effects).toEqual(effects)
  })

  it('defaults to empty effects array when not in JSON', () => {
    const rect = new Rect()
    const restored = Rect.fromJSON(rect.toJSON())
    expect(restored.effects).toEqual([])
  })

  it('restores multiple effects in order', () => {
    const effects: Effect[] = [shadowEffect, blurEffect]
    const rect = new Rect({ effects })
    const restored = Rect.fromJSON(rect.toJSON())
    expect(restored.effects).toHaveLength(2)
    expect(restored.effects[0]!.type).toBe('drop-shadow')
    expect(restored.effects[1]!.type).toBe('blur')
  })
})
