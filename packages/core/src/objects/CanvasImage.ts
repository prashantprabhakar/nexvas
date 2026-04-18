import { BaseObject, type BaseObjectProps } from './BaseObject.js'
import { BoundingBox } from '../math/BoundingBox.js'
import type { RenderContext, ObjectJSON } from '../types.js'
import { makeEffectPaint, effectsCacheKey, type PaintCK, type EffectCK, type SkPaint } from '../renderer/paint.js'

interface SkImage {
  width(): number
  height(): number
  delete(): void
}

interface SkCanvas {
  save(): number
  restore(): void
  concat(matrix: ArrayLike<number>): void
  saveLayer(paint: unknown): number
  drawImageRect(
    img: SkImage,
    src: number[],
    dst: number[],
    paint: unknown,
    fastSample?: boolean,
  ): void
}

interface ImageCK extends PaintCK {
  MakeImageFromEncoded(data: Uint8Array): SkImage | null
  FilterMode: { Linear: unknown }
  MipmapMode: { Linear: unknown }
}

export interface ImageProps extends BaseObjectProps {
  /** URL of the image to load. */
  src?: string
  /** Optional crop in source image pixel coordinates: { x, y, width, height }. */
  crop?: { x: number; y: number; width: number; height: number } | null
  /** How to fit the image inside its bounds. Default: 'fill'. */
  objectFit?: 'fill' | 'contain' | 'cover'
  /**
   * Callback invoked after the image finishes loading so the stage can
   * schedule a redraw. Pass `() => stage.markDirty()`.
   */
  onLoad?: () => void
  /** Callback invoked when image loading fails with the error message. */
  onLoadError?: (message: string) => void
}

/** Raster image object (PNG, JPEG, WebP). Loaded via URL and decoded by CanvasKit. */
export class CanvasImage extends BaseObject {
  src: string
  crop: { x: number; y: number; width: number; height: number } | null
  objectFit: 'fill' | 'contain' | 'cover'
  onLoad: (() => void) | null
  onLoadError: ((message: string) => void) | null

  private _skImage: SkImage | null = null
  private _loadingSrc = ''
  private _loading = false
  private _loadGeneration = 0

  /**
   * Unsafe URL protocols that must never be fetched.
   * Checked case-insensitively against the start of `src`.
   */
  private static readonly _UNSAFE_PROTOCOLS = /^(?:javascript|vbscript):/i

  /**
   * data: URIs that are NOT image content — these are rejected.
   * Only `data:image/...` is allowed through.
   */
  private static readonly _UNSAFE_DATA = /^data:(?!image\/)/i

  /**
   * Returns true if the given src is safe to fetch.
   * Rejects javascript:, vbscript:, and non-image data: URIs.
   */
  static isAllowedSrc(src: string): boolean {
    if (CanvasImage._UNSAFE_PROTOCOLS.test(src)) return false
    if (CanvasImage._UNSAFE_DATA.test(src)) return false
    return true
  }

  constructor(props: ImageProps = {}) {
    super(props)
    this.src = props.src ?? ''
    this.crop = props.crop ?? null
    this.objectFit = props.objectFit ?? 'fill'
    this.onLoad = props.onLoad ?? null
    this.onLoadError = props.onLoadError ?? null
  }

  getType(): string {
    return 'Image'
  }

  getLocalBoundingBox(): BoundingBox {
    return new BoundingBox(0, 0, this.width, this.height)
  }

  private _startLoad(ck: ImageCK): void {
    // Skip only if this exact src is already loading (deduplicate)
    if (this._loadingSrc === this.src && this._loading) return

    // Reject unsafe URLs at runtime (NV-019)
    if (!CanvasImage.isAllowedSrc(this.src)) {
      console.warn(`[nexvas:image] rejected unsafe src "${this.src.slice(0, 64)}"`)
      return
    }

    const generation = ++this._loadGeneration
    this._loading = true
    this._loadingSrc = this.src

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    void fetch(this.src, { signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => {
        if (generation !== this._loadGeneration) return // stale — newer load in flight
        const img = ck.MakeImageFromEncoded(new Uint8Array(buf))
        if (img) {
          this._skImage?.delete()
          this._skImage = img
          this.onLoad?.()
        } else {
          console.warn(`[nexvas:image] CanvasKit could not decode image "${this.src}"`)
          this.onLoadError?.(`CanvasKit could not decode image "${this.src}"`)
        }
      })
      .catch((err: unknown) => {
        if (generation !== this._loadGeneration) return
        const msg = err instanceof Error ? err.message : String(err)
        if ((err as { name?: string }).name === 'AbortError') {
          console.warn(`[nexvas:image] Load timed out for "${this.src}"`)
          this.onLoadError?.(`Load timed out for "${this.src}"`)
        } else {
          console.warn(`[nexvas:image] Failed to load "${this.src}": ${msg}`)
          this.onLoadError?.(msg)
        }
      })
      .finally(() => {
        clearTimeout(timeoutId)
        if (generation === this._loadGeneration) this._loading = false
      })
  }

  /**
   * Compute the source rect (within the image) and destination rect (on canvas)
   * according to the objectFit setting.
   */
  private _computeRects(imgW: number, imgH: number): { src: number[]; dst: number[] } {
    const dstW = this.width
    const dstH = this.height

    if (this.crop) {
      const { x, y, width, height } = this.crop
      return {
        src: [x, y, x + width, y + height],
        dst: [0, 0, dstW, dstH],
      }
    }

    if (this.objectFit === 'fill') {
      return {
        src: [0, 0, imgW, imgH],
        dst: [0, 0, dstW, dstH],
      }
    }

    const imgRatio = imgW / imgH
    const dstRatio = dstW / dstH

    if (this.objectFit === 'contain') {
      // Letterbox — fit entirely, preserve aspect ratio
      if (imgRatio > dstRatio) {
        const h = dstW / imgRatio
        const offY = (dstH - h) / 2
        return {
          src: [0, 0, imgW, imgH],
          dst: [0, offY, dstW, offY + h],
        }
      } else {
        const w = dstH * imgRatio
        const offX = (dstW - w) / 2
        return {
          src: [0, 0, imgW, imgH],
          dst: [offX, 0, offX + w, dstH],
        }
      }
    }

    // cover — fill entirely, crop excess
    if (imgRatio > dstRatio) {
      const srcW = imgH * dstRatio
      const offX = (imgW - srcW) / 2
      return {
        src: [offX, 0, offX + srcW, imgH],
        dst: [0, 0, dstW, dstH],
      }
    } else {
      const srcH = imgW / dstRatio
      const offY = (imgH - srcH) / 2
      return {
        src: [0, offY, imgW, offY + srcH],
        dst: [0, 0, dstW, dstH],
      }
    }
  }

  render(ctx: RenderContext): void {
    if (!this.visible || !ctx.skCanvas || !this.src) return
    const ck = ctx.canvasKit as unknown as ImageCK
    const canvas = ctx.skCanvas as SkCanvas

    // If not loaded, kick off the load and skip this frame
    if (!this._skImage) {
      this._startLoad(ck)
      return
    }

    canvas.save()
    canvas.concat(this.getLocalTransform().values)

    const hasEffects = this.effects.length > 0
    if (hasEffects) {
      const key = effectsCacheKey(this.effects)
      if (this._effectPaintCache?.key !== key) {
        ;(this._effectPaintCache?.paint as SkPaint | undefined)?.delete()
        this._effectPaintCache = { paint: makeEffectPaint(ck as unknown as EffectCK, this.effects), key }
      }
      canvas.saveLayer(this._effectPaintCache!.paint)
    }

    const { src, dst } = this._computeRects(this._skImage.width(), this._skImage.height())

    const imgKey = `img:${this.opacity}`
    if (this._fillPaintCache?.key !== imgKey) {
      ;(this._fillPaintCache?.paint as SkPaint | undefined)?.delete()
      const p = new ck.Paint()
      p.setAntiAlias(true)
      p.setAlphaf(this.opacity)
      this._fillPaintCache = { paint: p, key: imgKey }
    }
    canvas.drawImageRect(this._skImage, src, dst, this._fillPaintCache!.paint as SkPaint)

    if (hasEffects) canvas.restore()
    canvas.restore()
  }

  toJSON(): ObjectJSON {
    return {
      ...super.toJSON(),
      src: this.src,
      crop: this.crop,
      objectFit: this.objectFit,
    }
  }

  static fromJSON(json: ObjectJSON): CanvasImage {
    const obj = new CanvasImage()
    obj.applyBaseJSON(json)
    if (json['src'] !== undefined) {
      const src = String(json['src'])
      if (!CanvasImage.isAllowedSrc(src)) {
        console.warn(`[nexvas:image] fromJSON: rejected unsafe src "${src.slice(0, 64)}"`)
      } else {
        obj.src = src
      }
    }
    if (json['crop'] !== undefined) {
      obj.crop = (json['crop'] as { x: number; y: number; width: number; height: number }) ?? null
    }
    if (json['objectFit'] !== undefined)
      obj.objectFit = json['objectFit'] as 'fill' | 'contain' | 'cover'
    return obj
  }

  destroy(): void {
    this._skImage?.delete()
    this._skImage = null
    super.destroy()
  }
}
