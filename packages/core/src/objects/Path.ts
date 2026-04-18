import { BaseObject, type BaseObjectProps } from './BaseObject.js'
import { BoundingBox } from '../math/BoundingBox.js'
import { makeFillPaint, makeStrokePaint, fillCacheKey, strokeCacheKey, drawArrowHead, makeEffectPaint, effectsCacheKey, type PaintCK, type ArrowCK, type EffectCK, type SkPaint } from '../renderer/paint.js'
import type { RenderContext, ObjectJSON } from '../types.js'

interface SkPath {
  contains(x: number, y: number): boolean
  getBounds(output?: Float32Array): Float32Array
  delete(): void
}

interface SkCanvas {
  save(): number
  restore(): void
  concat(matrix: ArrayLike<number>): void
  saveLayer(paint: unknown): number
  drawPath(path: SkPath, paint: unknown): void
}

interface PathCK extends PaintCK {
  Path: {
    MakeFromSVGString(svg: string): SkPath | null
  }
}

interface PathEndpoints {
  startX: number
  startY: number
  startAngle: number
  endX: number
  endY: number
  endAngle: number
}

/**
 * Parse an SVG path string to extract start/end points and tangent angles.
 * Handles M, L, H, V, C, Q, Z commands (both absolute and relative).
 * Used for positioning arrowheads at the correct location and angle.
 */
function parseSvgPathEndpoints(d: string): PathEndpoints | null {
  // Tokenize: command letters and numeric values
  const re = /[MLHVCQZmlhvcqz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g
  const tokens: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(d)) !== null) tokens.push(m[0])

  if (!tokens.length) return null

  let i = 0
  let cx = 0, cy = 0       // current point
  let spx = 0, spy = 0     // subpath start (for Z)
  let startDX = 0, startDY = 0   // first segment direction vector
  let prevX = 0, prevY = 0  // point before end (for end tangent)
  let hasMove = false
  let hasSegment = false

  function num(): number { return parseFloat(tokens[i++] ?? '0') }
  function isCmd(t: string | undefined): boolean { return !!t && /[MLHVCQZmlhvcqz]/.test(t) }

  while (i < tokens.length) {
    if (!isCmd(tokens[i])) { i++; continue }
    const cmd = tokens[i++]!
    const rel = cmd === cmd.toLowerCase() && cmd !== 'z' && cmd !== 'Z'
    const c = cmd.toUpperCase()

    // Process implicit repetition of the same command
    do {
      const ox = rel ? cx : 0
      const oy = rel ? cy : 0

      if (c === 'M') {
        cx = ox + num(); cy = oy + num()
        if (!hasMove) { spx = cx; spy = cy; hasMove = true }
        spx = cx; spy = cy
      } else if (c === 'L') {
        const nx = ox + num(), ny = oy + num()
        if (!hasSegment) { startDX = nx - cx; startDY = ny - cy; hasSegment = true }
        prevX = cx; prevY = cy; cx = nx; cy = ny
      } else if (c === 'H') {
        const nx = ox + num(), ny = cy
        if (!hasSegment) { startDX = nx - cx; startDY = 0; hasSegment = true }
        prevX = cx; prevY = cy; cx = nx; cy = ny
      } else if (c === 'V') {
        const nx = cx, ny = oy + num()
        if (!hasSegment) { startDX = 0; startDY = ny - cy; hasSegment = true }
        prevX = cx; prevY = cy; cx = nx; cy = ny
      } else if (c === 'C') {
        const x1 = ox + num(), y1 = oy + num()
        const x2 = ox + num(), y2 = oy + num()
        const x = ox + num(), y = oy + num()
        if (!hasSegment) { startDX = x1 - cx; startDY = y1 - cy; hasSegment = true }
        prevX = x2; prevY = y2; cx = x; cy = y
      } else if (c === 'Q') {
        const x1 = ox + num(), y1 = oy + num()
        const x = ox + num(), y = oy + num()
        if (!hasSegment) { startDX = x1 - cx; startDY = y1 - cy; hasSegment = true }
        prevX = x1; prevY = y1; cx = x; cy = y
      } else if (c === 'Z') {
        cx = spx; cy = spy; break
      }
    } while (i < tokens.length && !isCmd(tokens[i]))
  }

  if (!hasMove) return null

  // Fallback: if no segments, start/end angles are both 0
  const startAngle = hasSegment ? Math.atan2(startDY, startDX) : 0
  const endAngle = hasSegment ? Math.atan2(cy - prevY, cx - prevX) : 0

  return { startX: spx, startY: spy, startAngle, endX: cx, endY: cy, endAngle }
}

export interface PathProps extends BaseObjectProps {
  /** SVG path data string, e.g. "M 0 0 L 100 100 Z" */
  d?: string
}

/**
 * Arbitrary SVG-compatible path.
 * Hit testing uses Skia's SkPath.contains() for pixel-precise results.
 * The parsed SkPath is cached and invalidated when `d` changes.
 */
export class Path extends BaseObject {
  private _d: string
  /** Cached CanvasKit path — recreated when `d` changes. */
  private _skPath: SkPath | null = null
  private _skPathCK: PathCK | null = null

  constructor(props: PathProps = {}) {
    super(props)
    this._d = props.d ?? ''
  }

  get d(): string {
    return this._d
  }

  set d(value: string) {
    if (value !== this._d) {
      this._d = value
      this._invalidatePath()
    }
  }

  private _invalidatePath(): void {
    if (this._skPath) {
      this._skPath.delete()
      this._skPath = null
    }
  }

  private _ensurePath(ck: PathCK): SkPath | null {
    if (this._skPath && this._skPathCK === ck) return this._skPath
    this._invalidatePath()
    if (!this._d) return null
    this._skPath = ck.Path.MakeFromSVGString(this._d) ?? null
    this._skPathCK = ck
    return this._skPath
  }

  /**
   * Returns the bounding box of the path.
   * When the SkPath has been parsed, uses Skia's getBounds() for accuracy.
   * Before the first render (SkPath not yet created), returns a large box so
   * the viewport culling pass never incorrectly discards an unrendered path.
   */
  getLocalBoundingBox(): BoundingBox {
    if (this._skPath) {
      const b = this._skPath.getBounds()
      return new BoundingBox(b[0]!, b[1]!, b[2]! - b[0]!, b[3]! - b[1]!)
    }
    // Not yet parsed — skip culling by returning a large sentinel box.
    const LARGE = 1e7
    return new BoundingBox(-LARGE, -LARGE, LARGE * 2, LARGE * 2)
  }

  getType(): string {
    return 'Path'
  }

  /**
   * Precise hit test using Skia's SkPath.contains().
   * Falls back to bounding box when CanvasKit is not available.
   */
  hitTest(worldX: number, worldY: number, tolerance = 4): boolean {
    if (!this.visible) return false
    // Try precise hit test if we have a cached path
    if (this._skPath) {
      const wt = this.getWorldTransform()
      const local = wt.inverse().transformPoint(worldX, worldY)
      return this._skPath.contains(local.x, local.y)
    }
    return this.getWorldBoundingBox().contains(worldX, worldY, tolerance)
  }

  render(ctx: RenderContext): void {
    if (!this.visible || !ctx.skCanvas || !this._d) return
    const ck = ctx.canvasKit as unknown as PathCK
    const canvas = ctx.skCanvas as SkCanvas

    const skPath = this._ensurePath(ck)
    if (!skPath) return

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
      const lb = this.getLocalBoundingBox()
      const bounds = { x: lb.x, y: lb.y, width: lb.width, height: lb.height }
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

      const startArrow = this.stroke.startArrow ?? 'none'
      const endArrow = this.stroke.endArrow ?? 'none'
      if ((startArrow !== 'none' || endArrow !== 'none') && (ck as unknown as ArrowCK).Path) {
        const arrowCK = ck as unknown as ArrowCK
        const endpoints = parseSvgPathEndpoints(this._d)
        if (endpoints) {
          const arrowSize = this.stroke.width * 5
          if (startArrow !== 'none') {
            // Start arrow points backward (away from path direction)
            drawArrowHead(canvas, arrowCK, endpoints.startX, endpoints.startY, endpoints.startAngle + Math.PI, startArrow, arrowSize, this.stroke, this.opacity)
          }
          if (endArrow !== 'none') {
            drawArrowHead(canvas, arrowCK, endpoints.endX, endpoints.endY, endpoints.endAngle, endArrow, arrowSize, this.stroke, this.opacity)
          }
        }
      }
    } else if (this._strokePaintCache) {
      ;(this._strokePaintCache.paint as SkPaint).delete()
      this._strokePaintCache = null
    }

    if (hasEffects) canvas.restore()
    canvas.restore()
  }

  toJSON(): ObjectJSON {
    return { ...super.toJSON(), d: this._d }
  }

  static fromJSON(json: ObjectJSON): Path {
    const obj = new Path()
    obj.applyBaseJSON(json)
    if (json['d'] !== undefined) obj.d = json['d'] as string
    return obj
  }

  destroy(): void {
    this._invalidatePath()
    super.destroy()
  }
}
