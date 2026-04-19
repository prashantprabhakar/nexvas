/** A 2D point used in routing calculations. */
export interface RoutePoint {
  x: number
  y: number
}

/** A route made of straight line segments through a sequence of points. */
export interface PolylineRoute {
  kind: 'polyline'
  points: RoutePoint[]
}

/** A single cubic bezier segment. */
export interface BezierSegment {
  p0: RoutePoint
  /** Control point 1 */
  p1: RoutePoint
  /** Control point 2 */
  p2: RoutePoint
  p3: RoutePoint
}

/** A route made of one or more cubic bezier segments. */
export interface CubicBezierRoute {
  kind: 'cubic-bezier'
  segments: BezierSegment[]
}

export type Route = PolylineRoute | CubicBezierRoute

/** Routing algorithm for Connector objects. */
export type ConnectorRouting = 'straight' | 'orthogonal' | 'curved'
