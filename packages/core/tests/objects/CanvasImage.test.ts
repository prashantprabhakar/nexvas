import { describe, it, expect, vi } from 'vitest'
import { CanvasImage } from '../../src/objects/CanvasImage.js'
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

describe('CanvasImage', () => {
  it('skips render on first call (starts async load)', () => {
    const { ctx, canvas } = makeCtx()
    // Mock fetch to return a valid response but never resolve in this test
    const fetchMock = vi.fn().mockReturnValue(new Promise(() => {}))
    vi.stubGlobal('fetch', fetchMock)

    const img = new CanvasImage({ src: 'https://example.com/img.png', width: 100, height: 100 })
    img.render(ctx)
    // First render: no skImage yet → kick off load and skip drawing
    expect(canvas.calls.some((c) => c.method === 'drawImageRect')).toBe(false)
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/img.png', expect.objectContaining({ signal: expect.any(AbortSignal) }))

    vi.unstubAllGlobals()
  })

  it('toJSON roundtrip', () => {
    const img = new CanvasImage({
      src: 'https://example.com/photo.jpg',
      objectFit: 'cover',
      crop: { x: 10, y: 10, width: 80, height: 80 },
    })
    const json = img.toJSON()
    expect(json['src']).toBe('https://example.com/photo.jpg')
    expect(json['objectFit']).toBe('cover')
    const restored = CanvasImage.fromJSON(json)
    expect(restored.objectFit).toBe('cover')
    expect(restored.crop).toEqual({ x: 10, y: 10, width: 80, height: 80 })
  })

  it('skips render when invisible', () => {
    const { ctx, canvas } = makeCtx()
    const img = new CanvasImage({ src: 'x.png', visible: false })
    img.render(ctx)
    expect(canvas.calls).toHaveLength(0)
  })

  it('hitTest inside bounds', () => {
    const img = new CanvasImage({ x: 0, y: 0, width: 100, height: 100 })
    expect(img.hitTest(50, 50)).toBe(true)
    expect(img.hitTest(200, 200)).toBe(false)
  })

  it('onLoad is called after image loads', async () => {
    const { ctx } = makeCtx()
    const ck = ctx.canvasKit as ReturnType<typeof createMockCK>
    const mockImgData = new Uint8Array([1, 2, 3, 4])
    // Make MakeImageFromEncoded return a mock image
    const mockSkImg = { width: () => 100, height: () => 100, delete: () => {} }
    ck.MakeImageFromEncoded = (_data: Uint8Array) => mockSkImg

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: () => Promise.resolve(mockImgData.buffer),
    })
    vi.stubGlobal('fetch', fetchMock)

    const onLoad = vi.fn()
    const img = new CanvasImage({
      src: 'https://example.com/img.png',
      width: 100,
      height: 100,
      onLoad,
    })
    img.render(ctx) // starts load
    // Wait for async operations
    await new Promise((r) => setTimeout(r, 0))
    expect(onLoad).toHaveBeenCalled()

    vi.unstubAllGlobals()
  })

  describe('NV-009 race condition prevention', () => {
    it('discards stale fetch results when src changes mid-load', async () => {
      const { ctx } = makeCtx()
      const ck = ctx.canvasKit as ReturnType<typeof createMockCK>

      let resolveFirst!: (v: Response) => void
      const firstFetch = new Promise<Response>((r) => {
        resolveFirst = r
      })
      const secondFetch = Promise.resolve({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([9, 9, 9]).buffer),
      } as Response)

      const mockImgB = { width: () => 200, height: () => 200, delete: vi.fn() }
      ck.MakeImageFromEncoded = (data: Uint8Array) => {
        if (data[0] === 9) return mockImgB as unknown as ReturnType<typeof ck.MakeImageFromEncoded>
        return null
      }

      let callCount = 0
      vi.stubGlobal('fetch', (_url: string) => {
        callCount++
        if (callCount === 1) return firstFetch
        return secondFetch
      })

      const img = new CanvasImage({ src: 'a.png', width: 100, height: 100 })
      img.render(ctx) // starts load for a.png
      // Change src before first fetch resolves
      img.src = 'b.png'
      img.render(ctx) // starts load for b.png

      await new Promise((r) => setTimeout(r, 0)) // b.png resolves

      // Now resolve the first (stale) fetch
      resolveFirst({
        ok: true,
        arrayBuffer: () => Promise.resolve(new Uint8Array([1, 2, 3]).buffer),
      } as Response)
      await new Promise((r) => setTimeout(r, 0))

      // The image shown should be from b.png (not overwritten by stale a.png)
      expect(mockImgB.delete).not.toHaveBeenCalled() // b's image was not replaced/deleted
      vi.unstubAllGlobals()
    })
  })

  describe('NV-019 URL validation in fromJSON', () => {
    it('rejects javascript: URLs', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const json = {
        type: 'Image',
        id: 'x',
        name: '',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        opacity: 1,
        visible: true,
        locked: false,
        src: 'javascript:alert(1)',
      }
      const img = CanvasImage.fromJSON(json)
      expect(img.src).toBe('') // src should remain empty (default)
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unsafe src'))
      consoleSpy.mockRestore()
    })

    it('allows https: URLs', () => {
      const json = {
        type: 'Image',
        id: 'x',
        name: '',
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        scaleX: 1,
        scaleY: 1,
        skewX: 0,
        skewY: 0,
        opacity: 1,
        visible: true,
        locked: false,
        src: 'https://example.com/img.png',
      }
      const img = CanvasImage.fromJSON(json)
      expect(img.src).toBe('https://example.com/img.png')
    })
  })
})
