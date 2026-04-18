import { BaseObject, type BaseObjectProps } from './BaseObject.js'
import { BoundingBox } from '../math/BoundingBox.js'
import { makeFillPaint, makeStrokePaint, fillCacheKey, strokeCacheKey, makeEffectPaint, effectsCacheKey, type PaintCK, type EffectCK, type SkPaint } from '../renderer/paint.js'
import type { RenderContext, ObjectJSON } from '../types.js'

interface SkCanvas {
  save(): number
  restore(): void
  concat(matrix: ArrayLike<number>): void
  saveLayer(paint: unknown): number
  drawOval(oval: ArrayLike<number>, paint: unknown): void
}

interface CircleCK extends PaintCK {
  LTRBRect(l: number, t: number, r: number, b: number): Float32Array
}

export interface CircleProps extends BaseObjectProps {
  /**
   * Convenience: center x + radius instead of x/y/width/height.
   * If provided, takes precedence over `x` and `width`.
   */
  cx?: number
  cy?: number
  radius?: number
}

/**
 * Ellipse / circle.
 *
 * You can construct with a bounding box (`x`, `y`, `width`, `height`) or with
 * the more natural center + radius API (`cx`, `cy`, `radius`). Both styles
 * can be mixed — whichever props are present are applied in order.
 *
 * @example
 * ```ts
 * // Center + radius (recommended for circles)
 * new Circle({ cx: 200, cy: 150, radius: 50, fill: Color.hex('#3b82f6') })
 *
 * // Bounding box (use for ellipses)
 * new Circle({ x: 150, y: 100, width: 100, height: 60 })
 * ```
 */
export class Circle extends BaseObject {
  constructor(props: CircleProps = {}) {
    super(props)
    // cx/cy/radius override x/y/width/height if provided.
    if (props.radius !== undefined) {
      const r = props.radius
      this.width  = r * 2
      this.height = r * 2
      if (props.cx !== undefined) this.x = props.cx - r
      if (props.cy !== undefined) this.y = props.cy - r
    }
  }

  /** Horizontal radius (half of width). */
  get radiusX(): number { return this.width  / 2 }
  /** Vertical radius (half of height). */
  get radiusY(): number { return this.height / 2 }

  /** Radius of a perfect circle. Throws if width !== height. Use `radiusX`/`radiusY` for ellipses. */
  get radius(): number { return this.radiusX }
  set radius(r: number) { this.width = r * 2; this.height = r * 2 }

  /** Center x in local space. */
  get cx(): number { return this.x + this.radiusX }
  set cx(v: number) { this.x = v - this.radiusX }

  /** Center y in local space. */
  get cy(): number { return this.y + this.radiusY }
  set cy(v: number) { this.y = v - this.radiusY }

  getType(): string {
    return 'Circle'
  }

  getLocalBoundingBox(): BoundingBox {
    return new BoundingBox(0, 0, this.width, this.height)
  }

  render(ctx: RenderContext): void {
    if (!this.visible || !ctx.skCanvas) return
    const ck = ctx.canvasKit as CircleCK
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

    const oval = ck.LTRBRect(0, 0, this.width, this.height)

    if (this.fill) {
      const bounds = { x: 0, y: 0, width: this.width, height: this.height }
      const key = fillCacheKey(this.fill, this.opacity, bounds)
      if (this._fillPaintCache?.key !== key) {
        ;(this._fillPaintCache?.paint as SkPaint | undefined)?.delete()
        this._fillPaintCache = { paint: makeFillPaint(ck, this.fill, this.opacity, bounds), key }
      }
      canvas.drawOval(oval, this._fillPaintCache!.paint as SkPaint)
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
      canvas.drawOval(oval, this._strokePaintCache!.paint as SkPaint)
    } else if (this._strokePaintCache) {
      ;(this._strokePaintCache.paint as SkPaint).delete()
      this._strokePaintCache = null
    }

    if (hasEffects) canvas.restore()
    canvas.restore()
  }

  static fromJSON(json: ObjectJSON): Circle {
    const obj = new Circle()
    obj.applyBaseJSON(json)
    return obj
  }
}
