import { BaseObject, type BaseObjectProps } from './BaseObject.js'
import { BoundingBox } from '../math/BoundingBox.js'
import {
  makeFillPaint,
  makeStrokePaint,
  fillCacheKey,
  strokeCacheKey,
  makeEffectPaint,
  effectsCacheKey,
  type PaintCK,
  type EffectCK,
  type SkPaint,
} from '../renderer/paint.js'
import type { RenderContext, ObjectJSON, Port } from '../types.js'

// ---------------------------------------------------------------------------
// CanvasKit interface stubs
// ---------------------------------------------------------------------------

interface SkPath {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  close(): void
  contains(x: number, y: number): boolean
  delete(): void
}

interface SkCanvas {
  save(): number
  restore(): void
  concat(matrix: ArrayLike<number>): void
  saveLayer(paint: unknown): number
  drawPath(path: SkPath, paint: unknown): void
}

interface StarCK extends PaintCK {
  Path: new () => SkPath
}

// ---------------------------------------------------------------------------
// Star
// ---------------------------------------------------------------------------

export interface StarProps extends BaseObjectProps {
  /** Number of outer points. Minimum 3. Default 5. */
  points?: number
  /** Ratio of inner radius to outer radius, 0–1. Default 0.4. */
  innerRadius?: number
}

/**
 * An n-pointed star fit within the object bounding box.
 * Outer tips are placed at the top (−π/2) and spaced evenly.
 * Inner vertices sit at the midpoint angles, scaled by `innerRadius`.
 */
export class Star extends BaseObject {
  private _points: number
  private _innerRadius: number
  /** Cached CanvasKit path — rebuilt when points, innerRadius, width, or height changes. */
  private _skPath: SkPath | null = null
  private _pathKey: string = ''

  constructor(props: StarProps = {}) {
    super(props)
    this._points = Math.max(3, Math.round(props.points ?? 5))
    this._innerRadius = Math.min(1, Math.max(0, props.innerRadius ?? 0.4))
  }

  /** Number of outer points. Setting invalidates the path cache. */
  get points(): number {
    return this._points
  }

  set points(value: number) {
    const clamped = Math.max(3, Math.round(value))
    if (clamped !== this._points) {
      this._points = clamped
      this._invalidatePath()
    }
  }

  /** Inner-to-outer radius ratio, 0–1. Setting invalidates the path cache. */
  get innerRadius(): number {
    return this._innerRadius
  }

  set innerRadius(value: number) {
    const clamped = Math.min(1, Math.max(0, value))
    if (clamped !== this._innerRadius) {
      this._innerRadius = clamped
      this._invalidatePath()
    }
  }

  private _invalidatePath(): void {
    if (this._skPath) {
      this._skPath.delete()
      this._skPath = null
      this._pathKey = ''
    }
  }

  private _pathCacheKey(): string {
    return `${this._points}:${this._innerRadius}:${this.width}:${this.height}`
  }

  private _ensurePath(ck: StarCK): SkPath {
    const key = this._pathCacheKey()
    if (this._skPath && this._pathKey === key) return this._skPath
    this._invalidatePath()

    const path = new ck.Path()
    const cx = this.width / 2
    const cy = this.height / 2
    const outerRx = this.width / 2
    const outerRy = this.height / 2
    const innerRx = outerRx * this._innerRadius
    const innerRy = outerRy * this._innerRadius
    const step = Math.PI / this._points

    for (let i = 0; i < this._points; i++) {
      const outerAngle = (2 * Math.PI * i) / this._points - Math.PI / 2
      const innerAngle = outerAngle + step

      const ox = cx + outerRx * Math.cos(outerAngle)
      const oy = cy + outerRy * Math.sin(outerAngle)
      if (i === 0) path.moveTo(ox, oy)
      else path.lineTo(ox, oy)

      const ix = cx + innerRx * Math.cos(innerAngle)
      const iy = cy + innerRy * Math.sin(innerAngle)
      path.lineTo(ix, iy)
    }
    path.close()

    this._skPath = path
    this._pathKey = key
    return this._skPath
  }

  getType(): string {
    return 'Star'
  }

  getLocalBoundingBox(): BoundingBox {
    return new BoundingBox(0, 0, this.width, this.height)
  }

  /**
   * Returns one port per outer point (id: `point-0` … `point-N`) plus a `center` port.
   * Port positions match the outer vertices of the rendered star.
   */
  getDefaultPorts(): Port[] {
    const ports: Port[] = []
    for (let i = 0; i < this._points; i++) {
      const angle = (2 * Math.PI * i) / this._points - Math.PI / 2
      ports.push({
        id: `point-${i}`,
        relX: 0.5 + 0.5 * Math.cos(angle),
        relY: 0.5 + 0.5 * Math.sin(angle),
      })
    }
    ports.push({ id: 'center', relX: 0.5, relY: 0.5 })
    return ports
  }

  /**
   * Precise hit test using Skia's SkPath.contains().
   * Falls back to world bounding box before the first render.
   */
  hitTest(worldX: number, worldY: number, tolerance = 4): boolean {
    if (!this.visible) return false
    if (this._skPath) {
      const wt = this.getWorldTransform()
      const local = wt.inverse().transformPoint(worldX, worldY)
      return this._skPath.contains(local.x, local.y)
    }
    return this.getWorldBoundingBox().contains(worldX, worldY, tolerance)
  }

  render(ctx: RenderContext): void {
    if (!this.visible || !ctx.skCanvas) return
    const ck = ctx.canvasKit as unknown as StarCK
    const canvas = ctx.skCanvas as SkCanvas

    const skPath = this._ensurePath(ck)

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

    if (this.fill) {
      const bounds = { x: 0, y: 0, width: this.width, height: this.height }
      const key = fillCacheKey(this.fill, this.opacity, bounds)
      if (this._fillPaintCache?.key !== key) {
        ;(this._fillPaintCache?.paint as SkPaint | undefined)?.delete()
        this._fillPaintCache = { paint: makeFillPaint(ck, this.fill, this.opacity, bounds), key }
      }
      canvas.drawPath(skPath, this._fillPaintCache!.paint as SkPaint)
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
      canvas.drawPath(skPath, this._strokePaintCache!.paint as SkPaint)
    } else if (this._strokePaintCache) {
      ;(this._strokePaintCache.paint as SkPaint).delete()
      this._strokePaintCache = null
    }

    if (hasEffects) canvas.restore()
    canvas.restore()
  }

  toJSON(): ObjectJSON {
    return { ...super.toJSON(), points: this._points, innerRadius: this._innerRadius }
  }

  static fromJSON(json: ObjectJSON): Star {
    const obj = new Star()
    obj.applyBaseJSON(json)
    if (json['points'] !== undefined) obj._points = Math.max(3, Math.round(json['points'] as number))
    if (json['innerRadius'] !== undefined) obj._innerRadius = Math.min(1, Math.max(0, json['innerRadius'] as number))
    return obj
  }

  destroy(): void {
    this._invalidatePath()
    super.destroy()
  }
}
