import type { RoutePoint, PolylineRoute } from './types.js'

/**
 * Orthogonal (Manhattan) routing — right-angle segments only.
 * Without waypoints: routes through a single vertical midpoint column.
 * With waypoints: routes through each waypoint with a right-angle bend.
 */
export function routeOrthogonal(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  waypoints: RoutePoint[],
): PolylineRoute {
  if (waypoints.length === 0) {
    const midX = (sx + tx) / 2
    return {
      kind: 'polyline',
      points: [
        { x: sx, y: sy },
        { x: midX, y: sy },
        { x: midX, y: ty },
        { x: tx, y: ty },
      ],
    }
  }

  // Route through each waypoint with right-angle bends:
  // from previous point, go horizontal to waypoint x, then vertical to waypoint y.
  const pts: RoutePoint[] = [{ x: sx, y: sy }]
  let prevY = sy
  for (const wp of waypoints) {
    pts.push({ x: wp.x, y: prevY })
    pts.push({ x: wp.x, y: wp.y })
    prevY = wp.y
  }
  const lastPt = pts[pts.length - 1] as RoutePoint
  pts.push({ x: lastPt.x, y: ty })
  pts.push({ x: tx, y: ty })
  return { kind: 'polyline', points: pts }
}
