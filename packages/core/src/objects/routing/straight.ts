import type { RoutePoint, PolylineRoute } from './types.js'

/**
 * Straight-line routing — direct line from source to target,
 * optionally passing through any user-defined waypoints.
 */
export function routeStraight(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  waypoints: RoutePoint[],
): PolylineRoute {
  const points: RoutePoint[] =
    waypoints.length > 0
      ? [{ x: sx, y: sy }, ...waypoints, { x: tx, y: ty }]
      : [{ x: sx, y: sy }, { x: tx, y: ty }]
  return { kind: 'polyline', points }
}
