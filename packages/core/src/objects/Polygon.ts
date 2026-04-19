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

interface PolygonCK extends PaintCK {
  Path: new () => SkPath
}

// ---------------------------------------------------------------------------
// Polygon
// ---------------------------------------------------------------------------

export interface PolygonProps extends BaseObjectProps {
  /** Number of sides. Minimum 3. Default 6. */
  sides?: number
}

/**
 * A regular n-sided polygon fit within the object bounding box.
 * Vertices are evenly distributed around an ellipse inscribed in [0, 0, width, height],
 * starting at the top (−π/2). Non-square bounds produce non-regular (scaled) polygons.
 */
export class Polygon extends BaseObject {
  private _sides: number
  /** Cached CanvasKit path — rebuilt when sides, width, or height changes. */
  private _skPath: SkPath | null = null
  private _pathKey: string = ''

  constructor(props: PolygonProps = {}) {
    super(props)
    this._sides = Math.max(3, Math.round(props.sides ?? 6))
  }

  /** Number of sides. Setting invalidates the path cache. */
  get sides(): number {
    return this._sides
  }

  set sides(value: number) {
    const clamped = Math.max(3, Math.round(value))
    if (clamped !== this._sides) {
      this._sides = clamped
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
    return `${this._sides}:${this.width}:${this.height}`
  }

  private _ensurePath(ck: PolygonCK): SkPath {
    const key = this._pathCacheKey()
    if (this._skPath && this._pathKey === key) return this._skPath
    this._invalidatePath()

    const path = new ck.Path()
    const cx = this.width / 2
    const cy = this.height / 2
    const rx = this.width / 2
    const ry = this.height / 2
    for (let i = 0; i < this._sides; i++) {
      const angle = (2 * Math.PI * i / this._sides) - Math.PI / 2
      const vx = cx + rx * Math.cos(angle)
      const vy = cy + ry * Math.sin(angle)
      if (i === 0) path.moveTo(vx, vy)
      else path.lineTo(vx, vy)
    }
    path.close()

    this._skPath = path
    this._pathKey = key
    return this._skPath
  }

  getType(): string {
    return 'Polygon'
  }

  getLocalBoundingBox(): BoundingBox {
    return new BoundingBox(0, 0, this.width, this.height)
  }

  /**
   * Returns one port per vertex (id: `vertex-0` … `vertex-N`) plus a `center` port.
   * Port positions use the same ellipse geometry as the rendered vertices.
   */
  getDefaultPorts(): Port[] {
    const ports: Port[] = []
    for (let i = 0; i < this._sides; i++) {
      const angle = (2 * Math.PI * i / this._sides) - Math.PI / 2
      ports.push({
        id: `vertex-${i}`,
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
    const ck = ctx.canvasKit as unknown as PolygonCK
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
    return { ...super.toJSON(), sides: this._sides }
  }

  static fromJSON(json: ObjectJSON): Polygon {
    const obj = new Polygon()
    obj.applyBaseJSON(json)
    if (json['sides'] !== undefined) obj._sides = Math.max(3, Math.round(json['sides'] as number))
    return obj
  }

  destroy(): void {
    this._invalidatePath()
    super.destroy()
  }
}
