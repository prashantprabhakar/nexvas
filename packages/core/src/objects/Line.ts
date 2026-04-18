import { BaseObject, type BaseObjectProps } from './BaseObject.js'
import { BoundingBox } from '../math/BoundingBox.js'
import { makeStrokePaint, strokeCacheKey, drawArrowHead, makeEffectPaint, effectsCacheKey, type PaintCK, type ArrowCK, type EffectCK, type SkPaint } from '../renderer/paint.js'
import type { RenderContext, ObjectJSON } from '../types.js'

interface SkCanvas {
  save(): number
  restore(): void
  concat(matrix: ArrayLike<number>): void
  saveLayer(paint: unknown): number
  drawLine(x0: number, y0: number, x1: number, y1: number, paint: unknown): void
  drawPath(path: unknown, paint: unknown): void
}

export interface LineProps extends BaseObjectProps {
  /** X coordinate of the start point in local (parent) space. */
  x1?: number
  /** Y coordinate of the start point in local (parent) space. */
  y1?: number
  /** X coordinate of the end point in local (parent) space. */
  x2?: number
  /** Y coordinate of the end point in local (parent) space. */
  y2?: number
}

/**
 * A straight line segment between two points.
 * Lines have a stroke but no fill. Hit testing uses distance-to-segment.
 */
export class Line extends BaseObject {
  /** Start point X in local space. */
  x1: number
  /** Start point Y in local space. */
  y1: number
  /** End point X in local space. */
  x2: number
  /** End point Y in local space. */
  y2: number

  constructor(props: LineProps = {}) {
    super(props)
    this.x1 = props.x1 ?? 0
    this.y1 = props.y1 ?? 0
    this.x2 = props.x2 ?? props.width ?? 0
    this.y2 = props.y2 ?? props.height ?? 0
    // width/height derived from endpoints for bounding box compatibility
    this.width = Math.abs(this.x2 - this.x1)
    this.height = Math.abs(this.y2 - this.y1)
  }

  getType(): string {
    return 'Line'
  }

  /**
   * Axis-aligned bounding box that encloses the line, expanded by strokeWidth/2.
   */
  getLocalBoundingBox(): BoundingBox {
    const pad = (this.stroke?.width ?? 1) / 2
    return new BoundingBox(
      Math.min(this.x1, this.x2) - pad,
      Math.min(this.y1, this.y2) - pad,
      Math.abs(this.x2 - this.x1) + pad * 2,
      Math.abs(this.y2 - this.y1) + pad * 2,
    )
  }

  /**
   * Precise hit test: distance from the world point to the line segment.
   * Falls back to tolerance if the segment has zero length.
   */
  hitTest(worldX: number, worldY: number, tolerance = 4): boolean {
    if (!this.visible) return false
    // Transform world point into local space
    const wt = this.getWorldTransform()
    const localPt = wt.inverse().transformPoint(worldX, worldY)
    return this._distToSegment(localPt.x, localPt.y) <= tolerance
  }

  private _distToSegment(px: number, py: number): number {
    const dx = this.x2 - this.x1
    const dy = this.y2 - this.y1
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) {
      // degenerate segment — distance to point
      return Math.hypot(px - this.x1, py - this.y1)
    }
    const t = Math.max(0, Math.min(1, ((px - this.x1) * dx + (py - this.y1) * dy) / lenSq))
    const cx = this.x1 + t * dx
    const cy = this.y1 + t * dy
    return Math.hypot(px - cx, py - cy)
  }

  render(ctx: RenderContext): void {
    if (!this.visible || !ctx.skCanvas || !this.stroke) return

    const ck = ctx.canvasKit as PaintCK
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

    const key = strokeCacheKey(this.stroke, this.opacity)
    if (this._strokePaintCache?.key !== key) {
      ;(this._strokePaintCache?.paint as SkPaint | undefined)?.delete()
      this._strokePaintCache = { paint: makeStrokePaint(ck, this.stroke, this.opacity), key }
    }
    canvas.drawLine(this.x1, this.y1, this.x2, this.y2, this._strokePaintCache!.paint as SkPaint)

    const startArrow = this.stroke.startArrow ?? 'none'
    const endArrow = this.stroke.endArrow ?? 'none'
    if ((startArrow !== 'none' || endArrow !== 'none') && (ck as unknown as ArrowCK).Path) {
      const arrowCK = ck as unknown as ArrowCK
      const arrowSize = this.stroke.width * 5
      if (startArrow !== 'none') {
        const angle = Math.atan2(this.y1 - this.y2, this.x1 - this.x2)
        drawArrowHead(canvas, arrowCK, this.x1, this.y1, angle, startArrow, arrowSize, this.stroke, this.opacity)
      }
      if (endArrow !== 'none') {
        const angle = Math.atan2(this.y2 - this.y1, this.x2 - this.x1)
        drawArrowHead(canvas, arrowCK, this.x2, this.y2, angle, endArrow, arrowSize, this.stroke, this.opacity)
      }
    }

    if (hasEffects) canvas.restore()
    canvas.restore()
  }

  toJSON(): ObjectJSON {
    return {
      ...super.toJSON(),
      x1: this.x1,
      y1: this.y1,
      x2: this.x2,
      y2: this.y2,
    }
  }

  static fromJSON(json: ObjectJSON): Line {
    const obj = new Line()
    obj.applyBaseJSON(json)
    if (json['x1'] !== undefined) obj.x1 = json['x1'] as number
    if (json['y1'] !== undefined) obj.y1 = json['y1'] as number
    if (json['x2'] !== undefined) obj.x2 = json['x2'] as number
    if (json['y2'] !== undefined) obj.y2 = json['y2'] as number
    return obj
  }
}
