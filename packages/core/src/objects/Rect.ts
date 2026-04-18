import { BaseObject, type BaseObjectProps } from './BaseObject.js'
import { BoundingBox } from '../math/BoundingBox.js'
import { makeFillPaint, makeStrokePaint, fillCacheKey, strokeCacheKey, makeEffectPaint, effectsCacheKey, type PaintCK, type EffectCK, type SkPaint } from '../renderer/paint.js'
import type { RenderContext, ObjectJSON } from '../types.js'

// Minimal CanvasKit canvas interface for Rect
interface SkCanvas {
  save(): number
  restore(): void
  concat(matrix: ArrayLike<number>): void
  saveLayer(paint: unknown): number
  drawRect(rect: ArrayLike<number>, paint: unknown): void
  drawRRect(rrect: ArrayLike<number>, paint: unknown): void
}

interface RectCK extends PaintCK {
  LTRBRect(l: number, t: number, r: number, b: number): Float32Array
  RRectXY(rect: Float32Array, rx: number, ry: number): Float32Array
}

export interface RectProps extends BaseObjectProps {
  cornerRadius?: number
}

/** A rectangle with optional rounded corners, fill, and stroke. */
export class Rect extends BaseObject {
  /** Corner radius for rounded rectangles. 0 = sharp corners. */
  cornerRadius: number

  constructor(props: RectProps = {}) {
    super(props)
    this.cornerRadius = props.cornerRadius ?? 0
  }

  getType(): string {
    return 'Rect'
  }

  getLocalBoundingBox(): BoundingBox {
    return new BoundingBox(0, 0, this.width, this.height)
  }

  render(ctx: RenderContext): void {
    if (!this.visible || !ctx.skCanvas) return
    const ck = ctx.canvasKit as unknown as RectCK
    const canvas = ctx.skCanvas as SkCanvas

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

    const rect = ck.LTRBRect(0, 0, this.width, this.height)

    if (this.fill) {
      const bounds = { x: 0, y: 0, width: this.width, height: this.height }
      const key = fillCacheKey(this.fill, this.opacity, bounds)
      if (this._fillPaintCache?.key !== key) {
        ;(this._fillPaintCache?.paint as SkPaint | undefined)?.delete()
        this._fillPaintCache = { paint: makeFillPaint(ck, this.fill, this.opacity, bounds), key }
      }
      const fillPaint = this._fillPaintCache!.paint as SkPaint
      if (this.cornerRadius > 0) {
        canvas.drawRRect(ck.RRectXY(rect, this.cornerRadius, this.cornerRadius), fillPaint)
      } else {
        canvas.drawRect(rect, fillPaint)
      }
    } else if (this._fillPaintCache) {
      ;(this._fillPaintCache.paint as SkPaint).delete()
      this._fillPaintCache = null
    }

    if (this.stroke) {
      const key = strokeCacheKey(this.stroke, this.opacity)
      if (this._strokePaintCache?.key !== key) {
        ;(this._strokePaintCache?.paint as SkPaint | undefined)?.delete()
        this._strokePaintCache = { paint: makeStrokePaint(ck, this.stroke, this.opacity), key }
      }
      const strokePaint = this._strokePaintCache!.paint as SkPaint
      if (this.cornerRadius > 0) {
        canvas.drawRRect(ck.RRectXY(rect, this.cornerRadius, this.cornerRadius), strokePaint)
      } else {
        canvas.drawRect(rect, strokePaint)
      }
    } else if (this._strokePaintCache) {
      ;(this._strokePaintCache.paint as SkPaint).delete()
      this._strokePaintCache = null
    }

    if (hasEffects) canvas.restore()
    canvas.restore()
  }

  toJSON(): ObjectJSON {
    return { ...super.toJSON(), cornerRadius: this.cornerRadius }
  }

  static fromJSON(json: ObjectJSON): Rect {
    const obj = new Rect()
    obj.applyBaseJSON(json)
    if (json['cornerRadius'] !== undefined) obj.cornerRadius = json['cornerRadius'] as number
    return obj
  }
}
