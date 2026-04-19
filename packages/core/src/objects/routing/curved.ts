import type { RoutePoint, CubicBezierRoute, BezierSegment } from './types.js'

/**
 * Curved routing — cubic bezier segments with auto-computed control points.
 * Control points flow horizontally out of/into each endpoint, creating smooth S-curves.
 * Multiple waypoints create chained bezier segments.
 */
export function routeCurved(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  waypoints: RoutePoint[],
): CubicBezierRoute {
  const all: RoutePoint[] = [{ x: sx, y: sy }, ...waypoints, { x: tx, y: ty }]
  const segments: BezierSegment[] = []

  for (let i = 0; i < all.length - 1; i++) {
    const p0 = all[i] as RoutePoint
    const p3 = all[i + 1] as RoutePoint
    const dx = (p3.x - p0.x) * 0.5
    segments.push({
      p0,
      p1: { x: p0.x + dx, y: p0.y },
      p2: { x: p3.x - dx, y: p3.y },
      p3,
    })
  }

  return { kind: 'cubic-bezier', segments }
}

/**
 * Sample a cubic bezier segment at parameter t ∈ [0, 1].
 * Used by hit testing to approximate distance to the curve.
 */
export function sampleBezier(seg: BezierSegment, t: number): RoutePoint {
  const mt = 1 - t
  const mt2 = mt * mt
  const t2 = t * t
  return {
    x: mt2 * mt * seg.p0.x + 3 * mt2 * t * seg.p1.x + 3 * mt * t2 * seg.p2.x + t2 * t * seg.p3.x,
    y: mt2 * mt * seg.p0.y + 3 * mt2 * t * seg.p1.y + 3 * mt * t2 * seg.p2.y + t2 * t * seg.p3.y,
  }
}
