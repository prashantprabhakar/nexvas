import { describe, it, expect, vi } from 'vitest'
import { Text } from '../../src/objects/Text.js'
import { createMockCK, createMockCanvas } from '../__mocks__/canvaskit.js'
import type { RenderContext } from '../../src/types.js'
import type { FontManager } from '../../src/FontManager.js'

function makeFontManager(hasFont = true): FontManager {
  return {
    hasFont: () => hasFont,
    getFontProvider: () => ({}),
  } as unknown as FontManager
}

function makeCtx(hasFont = true) {
  const ck = createMockCK()
  const canvas = createMockCanvas()
  const ctx: RenderContext = {
    skCanvas: canvas,
    canvasKit: ck,
    fontManager: makeFontManager(hasFont),
    pixelRatio: 1,
    viewport: { x: 0, y: 0, scale: 1, width: 800, height: 600 },
  }
  return { ctx, canvas, ck }
}

describe('Text', () => {
  it('renders — calls drawParagraph when font loaded', () => {
    const { ctx, canvas } = makeCtx(true)
    const text = new Text({ text: 'Hello', x: 0, y: 0, width: 200, height: 50 })
    text.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawParagraph')).toBe(true)
  })

  it('skips render when font not loaded — warns', () => {
    const { ctx, canvas } = makeCtx(false)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const text = new Text({ text: 'Hello', x: 0, y: 0, width: 200, height: 50 })
    text.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawParagraph')).toBe(false)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('skips render when text is empty', () => {
    const { ctx, canvas } = makeCtx(true)
    const text = new Text({ text: '', x: 0, y: 0, width: 200, height: 50 })
    text.render(ctx)
    expect(canvas.calls.some((c) => c.method === 'drawParagraph')).toBe(false)
  })

  it('toJSON roundtrip', () => {
    const text = new Text({
      text: 'Hi',
      fontFamily: 'Roboto',
      fontSize: 24,
      align: 'center',
      baseline: 'middle',
    })
    const json = text.toJSON()
    expect(json['text']).toBe('Hi')
    expect(json['fontFamily']).toBe('Roboto')
    expect(json['fontSize']).toBe(24)
    const restored = Text.fromJSON(json)
    expect(restored.text).toBe('Hi')
    expect(restored.align).toBe('center')
  })

  it('invalidate clears cached paragraph', () => {
    const { ctx, canvas } = makeCtx(true)
    const text = new Text({ text: 'Hello', x: 0, y: 0, width: 200, height: 50 })
    text.render(ctx)
    const callsAfterFirst = canvas.calls.length
    text.invalidate()
    text.text = 'World'
    text.render(ctx)
    expect(canvas.calls.length).toBeGreaterThan(callsAfterFirst)
  })

  describe('auto-invalidation on property set (NV-014)', () => {
    function countBuilds(ctx: RenderContext, ck: ReturnType<typeof createMockCK>) {
      const buildSpy = vi.spyOn(ck.ParagraphBuilder, 'MakeFromFontProvider')
      return buildSpy
    }

    it('rebuilds paragraph when .text is set without calling invalidate()', () => {
      const { ctx, ck } = makeCtx(true)
      const spy = countBuilds(ctx, ck)
      const text = new Text({ text: 'Hello', x: 0, y: 0, width: 200, height: 50 })
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(1)
      text.text = 'World'
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('rebuilds paragraph when .fontSize is set without calling invalidate()', () => {
      const { ctx, ck } = makeCtx(true)
      const spy = countBuilds(ctx, ck)
      const text = new Text({ text: 'Hi', x: 0, y: 0, width: 200, height: 50 })
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(1)
      text.fontSize = 32
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('rebuilds paragraph when .fontFamily is set without calling invalidate()', () => {
      const { ctx, ck } = makeCtx(true)
      const spy = countBuilds(ctx, ck)
      const text = new Text({ text: 'Hi', x: 0, y: 0, width: 200, height: 50 })
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(1)
      text.fontFamily = 'Roboto'
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('rebuilds paragraph when .fontWeight is set without calling invalidate()', () => {
      const { ctx, ck } = makeCtx(true)
      const spy = countBuilds(ctx, ck)
      const text = new Text({ text: 'Hi', x: 0, y: 0, width: 200, height: 50 })
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(1)
      text.fontWeight = 700
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('rebuilds paragraph when .fontStyle is set without calling invalidate()', () => {
      const { ctx, ck } = makeCtx(true)
      const spy = countBuilds(ctx, ck)
      const text = new Text({ text: 'Hi', x: 0, y: 0, width: 200, height: 50 })
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(1)
      text.fontStyle = 'italic'
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('rebuilds paragraph when .align is set without calling invalidate()', () => {
      const { ctx, ck } = makeCtx(true)
      const spy = countBuilds(ctx, ck)
      const text = new Text({ text: 'Hi', x: 0, y: 0, width: 200, height: 50 })
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(1)
      text.align = 'center'
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(2)
    })

    it('rebuilds paragraph when .lineHeight is set without calling invalidate()', () => {
      const { ctx, ck } = makeCtx(true)
      const spy = countBuilds(ctx, ck)
      const text = new Text({ text: 'Hi', x: 0, y: 0, width: 200, height: 50 })
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(1)
      text.lineHeight = 1.5
      text.render(ctx)
      expect(spy).toHaveBeenCalledTimes(2)
    })
  })
})
