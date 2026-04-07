import { BaseObject, type BaseObjectProps } from './BaseObject.js'
import { BoundingBox } from '../math/BoundingBox.js'
import { makeFillPaint, makeStrokePaint, type PaintCK } from '../renderer/paint.js'
import type { RenderContext, ObjectJSON } from '../types.js'

// Minimal CanvasKit canvas interface for Rect
interface SkCanvas {
  save(): number
  restore(): void
  concat(matrix: number[]): void
  drawRect(rect: number[], paint: unknown): void
  drawRRect(rrect: Float32Array, paint: unknown): void
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
    const ck = ctx.canvasKit as RectCK
    const canvas = ctx.skCanvas as SkCanvas

    canvas.save()
    canvas.concat(Array.from(this.getLocalTransform().values))

    const rect = ck.LTRBRect(0, 0, this.width, this.height)

    if (this.fill) {
      const paint = makeFillPaint(ck, this.fill, this.opacity)
      if (this.cornerRadius > 0) {
        canvas.drawRRect(ck.RRectXY(rect, this.cornerRadius, this.cornerRadius), paint)
      } else {
        canvas.drawRect(Array.from(rect), paint)
      }
      paint.delete()
    }

    if (this.stroke) {
      const paint = makeStrokePaint(ck, this.stroke, this.opacity)
      if (this.cornerRadius > 0) {
        canvas.drawRRect(ck.RRectXY(rect, this.cornerRadius, this.cornerRadius), paint)
      } else {
        canvas.drawRect(Array.from(rect), paint)
      }
      paint.delete()
    }

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
