import { BaseObject, type BaseObjectProps } from './BaseObject.js'
import { BoundingBox } from '../math/BoundingBox.js'
import {
  makeStrokePaint,
  strokeCacheKey,
  drawArrowHead,
  makeEffectPaint,
  effectsCacheKey,
  colorToCK,
  type PaintCK,
  type ArrowCK,
  type EffectCK,
  type SkPaint,
} from '../renderer/paint.js'
import type { RenderContext, ObjectJSON, StageInterface, StrokeStyle } from '../types.js'
import type { ConnectorRouting, Route, RoutePoint } from './routing/types.js'
import { routeStraight } from './routing/straight.js'
import { routeOrthogonal } from './routing/orthogonal.js'
import { routeCurved, sampleBezier } from './routing/curved.js'

// ---------------------------------------------------------------------------
// CanvasKit interface stubs
// ---------------------------------------------------------------------------

interface SkPath {
  moveTo(x: number, y: number): void
  lineTo(x: number, y: number): void
  cubicTo(cp1x: number, cp1y: number, cp2x: number, cp2y: number, x: number, y: number): void
  delete(): void
}

interface SkCanvas {
  save(): number
  restore(): void
  saveLayer(paint: unknown): number
  drawPath(path: unknown, paint: unknown): void
  translate(dx: number, dy: number): void
  drawParagraph(para: unknown, x: number, y: number): void
}

interface SkParagraph {
  layout(width: number): void
  getHeight(): number
  delete(): void
}

interface SkParagraphBuilder {
  pushStyle(style: unknown): void
  addText(text: string): void
  build(): SkParagraph
  delete(): void
}

interface LabelCK extends PaintCK {
  ParagraphStyle(opts: { textAlign?: unknown; textStyle?: unknown }): unknown
  ParagraphBuilder: {
    MakeFromFontProvider(style: unknown, fontProvider: unknown): SkParagraphBuilder
  }
  TextAlign: { Center: unknown }
  FontWeight: { Normal: unknown }
  FontWidth: { Normal: unknown }
  FontSlant: { Upright: unknown }
  TextBaseline: { Alphabetic: unknown }
  DecorationStyle: { Solid: unknown }
}

interface ConnectorCK extends PaintCK {
  Path: new () => SkPath
}

// ---------------------------------------------------------------------------
// Connector endpoint types
// ---------------------------------------------------------------------------

/** A fixed world-space point. */
export interface ConnectorEndpointFixed {
  x: number
  y: number
}

/** A reference to a named port on another object. */
export interface ConnectorEndpointRef {
  objectId: string
  portId: string
}

export type ConnectorEndpoint = ConnectorEndpointFixed | ConnectorEndpointRef

function isRef(ep: ConnectorEndpoint): ep is ConnectorEndpointRef {
  return 'objectId' in ep
}

// ---------------------------------------------------------------------------
// ConnectorProps
// ---------------------------------------------------------------------------

export interface ConnectorProps extends BaseObjectProps {
  /** Source endpoint — fixed world point or object port reference. */
  source: ConnectorEndpoint
  /** Target endpoint — fixed world point or object port reference. */
  target: ConnectorEndpoint
  /** Routing algorithm. Defaults to 'straight'. */
  routing?: ConnectorRouting
  /** Optional label rendered at the path midpoint. */
  label?: string
  /** Label position along the path, 0–1. Defaults to 0.5. */
  labelOffset?: number
  /** User-defined intermediate waypoints (world space). */
  waypoints?: RoutePoint[]
}

// ---------------------------------------------------------------------------
// Serialization type
// ---------------------------------------------------------------------------

export interface ConnectorJSON extends ObjectJSON {
  sourceRef: ConnectorEndpoint
  targetRef: ConnectorEndpoint
  routing: ConnectorRouting
  label: string
  labelOffset: number
  waypoints: RoutePoint[]
}

// ---------------------------------------------------------------------------
// Default stroke for connectors
// ---------------------------------------------------------------------------

const DEFAULT_CONNECTOR_STROKE: StrokeStyle = {
  color: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
  width: 2,
  endArrow: 'filled-arrow',
}

// ---------------------------------------------------------------------------
// Distance helpers
// ---------------------------------------------------------------------------

function distToSegment(px: number, py: number, a: RoutePoint, b: RoutePoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(px - a.x, py - a.y)
  const t = Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / lenSq))
  return Math.hypot(px - (a.x + t * dx), py - (a.y + t * dy))
}

// ---------------------------------------------------------------------------
// Connector
// ---------------------------------------------------------------------------

/**
 * A smart line between two endpoints (fixed world points or object ports).
 * Supports straight, orthogonal (right-angle), and curved (cubic bezier) routing.
 * Resolves attached object port positions at render time via the stage reference
 * in RenderContext — survives JSON round-trips because only ids are stored.
 */
export class Connector extends BaseObject {
  /** Source endpoint — fixed point or port reference. */
  source: ConnectorEndpoint
  /** Target endpoint — fixed point or port reference. */
  target: ConnectorEndpoint
  /** Routing algorithm used to draw the path. */
  routing: ConnectorRouting
  /** Optional label string rendered at the midpoint of the path. */
  label: string
  /** Position of the label along the path (0 = source, 1 = target). */
  labelOffset: number
  /** User-defined intermediate waypoints in world space. */
  waypoints: RoutePoint[]

  // ---------------------------------------------------------------------------
  // Internal cache — populated during render(), used for hit testing and bbox
  // ---------------------------------------------------------------------------

  private _cachedRoute: Route | null = null
  private _cachedSrc: RoutePoint | null = null
  private _cachedTgt: RoutePoint | null = null
  private _pathCache: { path: SkPath; key: string } | null = null
  private _labelParagraph: SkParagraph | null = null
  private _labelKey = ''

  constructor(props: ConnectorProps) {
    super(props)
    this.source = props.source
    this.target = props.target
    this.routing = props.routing ?? 'straight'
    this.label = props.label ?? ''
    this.labelOffset = props.labelOffset ?? 0.5
    this.waypoints = props.waypoints ?? []
    // Connector has no meaningful local transform — it draws in world space.
    // Force identity so getWorldBoundingBox() == getLocalBoundingBox().
    this.x = 0
    this.y = 0
  }

  getType(): string {
    return 'Connector'
  }

  // ---------------------------------------------------------------------------
  // Endpoint resolution
  // ---------------------------------------------------------------------------

  private _resolveEndpoint(ep: ConnectorEndpoint, stage: StageInterface): RoutePoint | null {
    if (isRef(ep)) {
      const obj = stage.getObjectById(ep.objectId)
      if (!obj) return null
      return obj.getPortWorldPosition(ep.portId)
    }
    return { x: ep.x, y: ep.y }
  }

  // ---------------------------------------------------------------------------
  // Route building
  // ---------------------------------------------------------------------------

  private _buildRoute(sx: number, sy: number, tx: number, ty: number): Route {
    switch (this.routing) {
      case 'orthogonal':
        return routeOrthogonal(sx, sy, tx, ty, this.waypoints)
      case 'curved':
        return routeCurved(sx, sy, tx, ty, this.waypoints)
      default:
        return routeStraight(sx, sy, tx, ty, this.waypoints)
    }
  }

  private _pathKey(src: RoutePoint, tgt: RoutePoint): string {
    let key = `${src.x},${src.y},${tgt.x},${tgt.y},${this.routing}`
    for (const wp of this.waypoints) key += `,${wp.x},${wp.y}`
    return key
  }

  // ---------------------------------------------------------------------------
  // Bounding box — based on cached route points
  // ---------------------------------------------------------------------------

  getLocalBoundingBox(): BoundingBox {
    const pts = this._aabbPoints()
    if (pts.length === 0) {
      // Fall back to fixed endpoint coords if not yet rendered
      const sx = isRef(this.source) ? 0 : this.source.x
      const sy = isRef(this.source) ? 0 : this.source.y
      const tx = isRef(this.target) ? sx : this.target.x
      const ty = isRef(this.target) ? sy : this.target.y
      const minX = Math.min(sx, tx)
      const minY = Math.min(sy, ty)
      return new BoundingBox(minX, minY, Math.max(Math.abs(tx - sx), 1), Math.max(Math.abs(ty - sy), 1))
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const p of pts) {
      if (p.x < minX) minX = p.x
      if (p.y < minY) minY = p.y
      if (p.x > maxX) maxX = p.x
      if (p.y > maxY) maxY = p.y
    }
    const pad = (this.stroke?.width ?? DEFAULT_CONNECTOR_STROKE.width!) / 2 + 8
    return new BoundingBox(minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2)
  }

  private _aabbPoints(): RoutePoint[] {
    if (!this._cachedRoute) return []
    const r = this._cachedRoute
    if (r.kind === 'polyline') return r.points
    // For bezier: use all control points — the bezier lies within their convex hull
    const pts: RoutePoint[] = []
    for (const seg of r.segments) pts.push(seg.p0, seg.p1, seg.p2, seg.p3)
    return pts
  }

  // ---------------------------------------------------------------------------
  // Hit testing
  // ---------------------------------------------------------------------------

  hitTest(worldX: number, worldY: number, tolerance = 8): boolean {
    if (!this.visible || !this._cachedRoute) return false
    const r = this._cachedRoute
    if (r.kind === 'polyline') {
      const pts = r.points
      for (let i = 0; i < pts.length - 1; i++) {
        if (distToSegment(worldX, worldY, pts[i] as RoutePoint, pts[i + 1] as RoutePoint) <= tolerance) return true
      }
      return false
    }
    // Cubic bezier: sample each segment at 24 intervals
    for (const seg of r.segments) {
      const STEPS = 24
      let prev = seg.p0
      for (let i = 1; i <= STEPS; i++) {
        const cur = sampleBezier(seg, i / STEPS)
        if (distToSegment(worldX, worldY, prev, cur) <= tolerance) return true
        prev = cur
      }
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Path midpoint (for label placement and arrowheads)
  // ---------------------------------------------------------------------------

  private _midpoint(): RoutePoint {
    if (!this._cachedRoute) return { x: 0, y: 0 }
    const r = this._cachedRoute
    if (r.kind === 'polyline') {
      const pts = r.points
      // Compute total length and find point at labelOffset fraction
      let totalLen = 0
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i] as RoutePoint, b = pts[i + 1] as RoutePoint
        totalLen += Math.hypot(b.x - a.x, b.y - a.y)
      }
      const target = totalLen * this.labelOffset
      let acc = 0
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i] as RoutePoint, b = pts[i + 1] as RoutePoint
        const segLen = Math.hypot(b.x - a.x, b.y - a.y)
        if (acc + segLen >= target) {
          const t = segLen > 0 ? (target - acc) / segLen : 0
          return { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }
        }
        acc += segLen
      }
      return pts[pts.length - 1] as RoutePoint
    }
    // Bezier: sample at labelOffset
    const segs = r.segments
    const t = this.labelOffset * segs.length
    const idx = Math.min(Math.floor(t), segs.length - 1)
    return sampleBezier(segs[idx] as NonNullable<typeof segs[number]>, t - idx)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  render(ctx: RenderContext): void {
    if (!this.visible || !ctx.skCanvas) return

    const ck = ctx.canvasKit as unknown as ConnectorCK
    const canvas = ctx.skCanvas as SkCanvas
    const stage = ctx.stage

    const src = this._resolveEndpoint(this.source, stage)
    const tgt = this._resolveEndpoint(this.target, stage)
    if (!src || !tgt) return

    this._cachedSrc = src
    this._cachedTgt = tgt
    this._cachedRoute = this._buildRoute(src.x, src.y, tgt.x, tgt.y)

    // Build or reuse cached SkPath
    const pk = this._pathKey(src, tgt)
    if (this._pathCache?.key !== pk) {
      this._pathCache?.path.delete()
      const skPath = new ck.Path()
      this._fillSkPath(skPath, this._cachedRoute)
      this._pathCache = { path: skPath, key: pk }
    }

    canvas.save()
    // No local transform — Connector draws in world space (viewport transform is already on canvas)

    const hasEffects = this.effects.length > 0
    if (hasEffects) {
      const ek = effectsCacheKey(this.effects)
      if (this._effectPaintCache?.key !== ek) {
        ;(this._effectPaintCache?.paint as SkPaint | undefined)?.delete()
        this._effectPaintCache = { paint: makeEffectPaint(ck as unknown as EffectCK, this.effects), key: ek }
      }
      canvas.saveLayer(this._effectPaintCache!.paint)
    }

    const stroke = this.stroke ?? DEFAULT_CONNECTOR_STROKE
    const sk = strokeCacheKey(stroke, this.opacity)
    if (this._strokePaintCache?.key !== sk) {
      ;(this._strokePaintCache?.paint as SkPaint | undefined)?.delete()
      this._strokePaintCache = { paint: makeStrokePaint(ck, stroke, this.opacity), key: sk }
    }

    canvas.drawPath(this._pathCache!.path, this._strokePaintCache!.paint as SkPaint)

    // Arrowheads
    this._drawArrows(canvas, ck as unknown as ArrowCK, src, tgt, stroke)

    // Label
    if (this.label) this._drawLabel(canvas, ck as unknown as LabelCK, ctx)

    if (hasEffects) canvas.restore()
    canvas.restore()
  }

  private _fillSkPath(path: SkPath, route: Route): void {
    if (route.kind === 'polyline') {
      const pts = route.points
      if (pts.length === 0) return
      path.moveTo((pts[0] as RoutePoint).x, (pts[0] as RoutePoint).y)
      for (let i = 1; i < pts.length; i++) path.lineTo((pts[i] as RoutePoint).x, (pts[i] as RoutePoint).y)
    } else {
      for (const seg of route.segments) {
        path.moveTo(seg.p0.x, seg.p0.y)
        path.cubicTo(seg.p1.x, seg.p1.y, seg.p2.x, seg.p2.y, seg.p3.x, seg.p3.y)
      }
    }
  }

  private _drawArrows(
    canvas: SkCanvas,
    ck: ArrowCK,
    src: RoutePoint,
    tgt: RoutePoint,
    stroke: StrokeStyle,
  ): void {
    const startArrow = stroke.startArrow ?? 'none'
    const endArrow = stroke.endArrow ?? 'none'
    if (startArrow === 'none' && endArrow === 'none') return
    if (!ck.Path) return

    const arrowSize = (stroke.width ?? 2) * 5
    const r = this._cachedRoute!

    if (startArrow !== 'none') {
      let angle: number
      if (r.kind === 'polyline' && r.points.length >= 2) {
        const a = r.points[0] as RoutePoint, b = r.points[1] as RoutePoint
        angle = Math.atan2(a.y - b.y, a.x - b.x)
      } else if (r.kind === 'cubic-bezier' && r.segments.length > 0) {
        const seg = r.segments[0]!
        angle = Math.atan2(seg.p0.y - seg.p1.y, seg.p0.x - seg.p1.x)
      } else {
        angle = Math.atan2(src.y - tgt.y, src.x - tgt.x)
      }
      drawArrowHead(canvas, ck, src.x, src.y, angle, startArrow, arrowSize, stroke, this.opacity)
    }

    if (endArrow !== 'none') {
      let angle: number
      if (r.kind === 'polyline' && r.points.length >= 2) {
        const pts = r.points
        const a = pts[pts.length - 2] as RoutePoint, b = pts[pts.length - 1] as RoutePoint
        angle = Math.atan2(b.y - a.y, b.x - a.x)
      } else if (r.kind === 'cubic-bezier' && r.segments.length > 0) {
        const seg = r.segments[r.segments.length - 1]!
        angle = Math.atan2(seg.p3.y - seg.p2.y, seg.p3.x - seg.p2.x)
      } else {
        angle = Math.atan2(tgt.y - src.y, tgt.x - src.x)
      }
      drawArrowHead(canvas, ck, tgt.x, tgt.y, angle, endArrow, arrowSize, stroke, this.opacity)
    }
  }

  private _drawLabel(canvas: SkCanvas, ck: LabelCK, ctx: RenderContext): void {
    const fontMgr = ctx.fontManager
    if (!fontMgr || !ck.ParagraphBuilder) return

    const fontProvider = fontMgr.getFontProvider()
    if (!fontProvider) return

    const labelKey = `${this.label},${this.opacity}`
    if (this._labelKey !== labelKey) {
      this._labelParagraph?.delete()
      this._labelParagraph = null
      this._labelKey = labelKey
    }

    if (!this._labelParagraph) {
      const stroke = this.stroke ?? DEFAULT_CONNECTOR_STROKE
      const col = colorToCK(ck, stroke.color)
      const textStyle = {
        color: col,
        decoration: 0,
        decorationColor: ck.Color4f(0, 0, 0, 0),
        decorationThickness: 0,
        decorationStyle: ck.DecorationStyle.Solid,
        fontFamilies: ['Noto Sans'],
        fontSize: 12,
        fontStyle: {
          weight: ck.FontWeight.Normal,
          width: ck.FontWidth.Normal,
          slant: ck.FontSlant.Upright,
        },
        foregroundColor: ck.Color4f(0, 0, 0, 0),
        backgroundColor: ck.Color4f(0, 0, 0, 0),
        heightMultiplier: 1.2,
        halfLeading: false,
        letterSpacing: 0,
        locale: '',
        shadows: [],
        fontFeatures: [],
        fontVariations: [],
        textBaseline: ck.TextBaseline.Alphabetic,
        wordSpacing: 0,
      }
      const paraStyle = ck.ParagraphStyle({ textAlign: ck.TextAlign.Center, textStyle: { color: ck.Color4f(0, 0, 0, 1) } })
      const builder = ck.ParagraphBuilder.MakeFromFontProvider(paraStyle, fontProvider)
      builder.pushStyle(textStyle)
      builder.addText(this.label)
      this._labelParagraph = builder.build()
      builder.delete()
      this._labelParagraph.layout(200)
    }

    const mid = this._midpoint()
    canvas.save()
    canvas.translate(mid.x - 100, mid.y - this._labelParagraph.getHeight() / 2)
    canvas.drawParagraph(this._labelParagraph, 0, 0)
    canvas.restore()
  }

  // ---------------------------------------------------------------------------
  // Destroy
  // ---------------------------------------------------------------------------

  destroy(): void {
    this._pathCache?.path.delete()
    this._pathCache = null
    this._labelParagraph?.delete()
    this._labelParagraph = null
    super.destroy()
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toJSON(): ConnectorJSON {
    return {
      ...super.toJSON(),
      sourceRef: this.source,
      targetRef: this.target,
      routing: this.routing,
      label: this.label,
      labelOffset: this.labelOffset,
      waypoints: this.waypoints,
    }
  }

  static fromJSON(json: ObjectJSON): Connector {
    const j = json as ConnectorJSON
    const obj = new Connector({
      source: j.sourceRef ?? { x: 0, y: 0 },
      target: j.targetRef ?? { x: 100, y: 100 },
      routing: j.routing ?? 'straight',
      label: j.label ?? '',
      labelOffset: j.labelOffset ?? 0.5,
      waypoints: j.waypoints ?? [],
    })
    obj.applyBaseJSON(json)
    return obj
  }
}
