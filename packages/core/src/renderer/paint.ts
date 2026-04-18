/**
 * Internal paint/color helpers for CanvasKit rendering.
 * Not exported from the public package API.
 */
import type { Fill, StrokeStyle, ColorRGBA, SolidFill, LinearGradientFill, RadialGradientFill, ArrowHeadStyle, Effect } from '../types.js'

// ---------------------------------------------------------------------------
// Minimal CanvasKit interfaces needed by this module
// ---------------------------------------------------------------------------

export interface SkPaint {
  setStyle(style: unknown): void
  setColor(color: Float32Array): void
  setAntiAlias(aa: boolean): void
  setStrokeWidth(width: number): void
  setStrokeCap(cap: unknown): void
  setStrokeJoin(join: unknown): void
  setStrokeMiter(limit: number): void
  setShader(shader: unknown | null): void
  setAlphaf(alpha: number): void
  setImageFilter(filter: unknown): void
  delete(): void
}

export interface SkImageFilter {
  delete(): void
}

interface SkShader {
  delete(): void
}

export interface EffectCK extends PaintCK {
  ImageFilter: {
    MakeDropShadow(
      dx: number,
      dy: number,
      sigmaX: number,
      sigmaY: number,
      color: Float32Array,
      input: SkImageFilter | null,
    ): SkImageFilter | null
    MakeBlur(
      sigmaX: number,
      sigmaY: number,
      tileMode: unknown,
      input: SkImageFilter | null,
    ): SkImageFilter | null
    MakeCompose(outer: SkImageFilter, inner: SkImageFilter): SkImageFilter | null
  }
}

export interface PaintCK {
  // eslint-disable-next-line @typescript-eslint/no-misused-new
  Paint: new () => SkPaint
  Color4f(r: number, g: number, b: number, a: number): Float32Array
  PaintStyle: { Fill: unknown; Stroke: unknown }
  StrokeCap: { Butt: unknown; Round: unknown; Square: unknown }
  StrokeJoin: { Miter: unknown; Round: unknown; Bevel: unknown }
  Shader: {
    MakeLinearGradient(
      start: number[],
      end: number[],
      colors: Float32Array[],
      positions: number[] | null,
      mode: unknown,
    ): SkShader | null
    MakeRadialGradient(
      center: number[],
      radius: number,
      colors: Float32Array[],
      positions: number[] | null,
      mode: unknown,
    ): SkShader | null
  }
  TileMode: { Clamp: unknown }
}

// ---------------------------------------------------------------------------
// Color conversion
// ---------------------------------------------------------------------------

/**
 * Convert a framework ColorRGBA (values 0–1) to a CanvasKit Color4f Float32Array.
 */
export function colorToCK(ck: PaintCK, c: ColorRGBA): Float32Array {
  return ck.Color4f(c.r, c.g, c.b, c.a)
}

// ---------------------------------------------------------------------------
// Fill paint
// ---------------------------------------------------------------------------

/** Local-space bounding box needed to resolve bounds-relative fill coordinates. */
export interface FillBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Create and configure a CanvasKit Paint for a Fill.
 * `bounds` is required for radial-gradient fills (center/radius are bounds-relative).
 * Caller is responsible for calling `paint.delete()` when done.
 */
export function makeFillPaint(ck: PaintCK, fill: Fill, opacity: number, bounds?: FillBounds): SkPaint {
  const paint = new ck.Paint()
  paint.setStyle(ck.PaintStyle.Fill)
  paint.setAntiAlias(true)
  paint.setAlphaf(opacity)

  if (fill.type === 'solid') {
    applySolidFill(ck, paint, fill)
  } else if (fill.type === 'linear-gradient') {
    applyLinearGradient(ck, paint, fill)
  } else if (fill.type === 'radial-gradient' && bounds) {
    applyRadialGradient(ck, paint, fill, bounds)
  }

  return paint
}

function applySolidFill(ck: PaintCK, paint: SkPaint, fill: SolidFill): void {
  paint.setColor(colorToCK(ck, fill.color))
}

function applyLinearGradient(ck: PaintCK, paint: SkPaint, fill: LinearGradientFill): void {
  const colors = fill.stops.map((s) => colorToCK(ck, s.color))
  const positions = fill.stops.map((s) => s.offset)
  const shader = ck.Shader.MakeLinearGradient(
    [fill.start.x, fill.start.y],
    [fill.end.x, fill.end.y],
    colors,
    positions,
    ck.TileMode.Clamp,
  )
  if (shader) {
    paint.setShader(shader)
    shader.delete()
  }
}

function applyRadialGradient(ck: PaintCK, paint: SkPaint, fill: RadialGradientFill, bounds: FillBounds): void {
  const cx = bounds.x + fill.center.x * bounds.width
  const cy = bounds.y + fill.center.y * bounds.height
  const radius = fill.radius * Math.max(bounds.width, bounds.height)
  const colors = fill.stops.map((s) => colorToCK(ck, s.color))
  const positions = fill.stops.map((s) => s.offset)
  const shader = ck.Shader.MakeRadialGradient(
    [cx, cy],
    radius,
    colors,
    positions,
    ck.TileMode.Clamp,
  )
  if (shader) {
    paint.setShader(shader)
    shader.delete()
  }
}

// ---------------------------------------------------------------------------
// Stroke paint
// ---------------------------------------------------------------------------

/**
 * Create and configure a CanvasKit Paint for a StrokeStyle.
 * Caller is responsible for calling `paint.delete()` when done.
 */
export function makeStrokePaint(ck: PaintCK, stroke: StrokeStyle, opacity: number): SkPaint {
  const paint = new ck.Paint()
  paint.setStyle(ck.PaintStyle.Stroke)
  paint.setAntiAlias(true)
  paint.setAlphaf(opacity)
  paint.setColor(colorToCK(ck, stroke.color))
  paint.setStrokeWidth(stroke.width)

  if (stroke.cap === 'round') {
    paint.setStrokeCap(ck.StrokeCap.Round)
  } else if (stroke.cap === 'square') {
    paint.setStrokeCap(ck.StrokeCap.Square)
  } else {
    paint.setStrokeCap(ck.StrokeCap.Butt)
  }

  if (stroke.join === 'round') {
    paint.setStrokeJoin(ck.StrokeJoin.Round)
  } else if (stroke.join === 'bevel') {
    paint.setStrokeJoin(ck.StrokeJoin.Bevel)
  } else {
    paint.setStrokeJoin(ck.StrokeJoin.Miter)
    paint.setStrokeMiter(10)
  }

  return paint
}

// ---------------------------------------------------------------------------
// Paint cache key helpers — cheap string keys to detect when a paint needs rebuild
// ---------------------------------------------------------------------------

/**
 * Returns a cheap cache key for a fill + opacity combo.
 * Solid fills use a compact format; gradients fall back to JSON.
 * Radial gradient also encodes `bounds` because center/radius are bounds-relative.
 */
export function fillCacheKey(fill: Fill, opacity: number, bounds?: FillBounds): string {
  if (fill.type === 'solid') {
    const { r, g, b, a } = fill.color
    return `s:${r}:${g}:${b}:${a}:${opacity}`
  }
  if (fill.type === 'radial-gradient' && bounds) {
    return JSON.stringify(fill) + ':' + opacity + ':' + bounds.x + ':' + bounds.y + ':' + bounds.width + ':' + bounds.height
  }
  return JSON.stringify(fill) + ':' + opacity
}

/**
 * Returns a cheap cache key for a stroke + opacity combo.
 * Includes arrowhead styles so the paint is invalidated when arrows change.
 */
export function strokeCacheKey(stroke: StrokeStyle, opacity: number): string {
  const { r, g, b, a } = stroke.color
  return `${r}:${g}:${b}:${a}:${stroke.width}:${stroke.cap ?? 'butt'}:${stroke.join ?? 'miter'}:${stroke.dash?.join(',') ?? ''}:${stroke.dashOffset ?? 0}:${stroke.startArrow ?? 'none'}:${stroke.endArrow ?? 'none'}:${opacity}`
}

// ---------------------------------------------------------------------------
// Arrowhead rendering
// ---------------------------------------------------------------------------

/** Minimal CanvasKit interface required for drawing arrowheads. */
export interface ArrowCK extends PaintCK {
  Path: {
    MakeFromSVGString(svg: string): { delete(): void } | null
  }
}

/** Minimal canvas interface required for drawing arrowheads. */
export interface ArrowCanvas {
  drawPath(path: unknown, paint: unknown): void
}

/**
 * Draw an arrowhead at position (x, y) pointing in the given direction (radians).
 *
 * `size` is the overall length of the arrowhead in local coordinate units.
 * For open-style arrows the existing stroke paint style is used; for filled shapes
 * a temporary fill paint is created and deleted before returning.
 *
 * Called by Line, Path, and Connector render() methods.
 */
export function drawArrowHead(
  canvas: ArrowCanvas,
  ck: ArrowCK,
  x: number,
  y: number,
  angle: number,
  style: ArrowHeadStyle,
  size: number,
  stroke: StrokeStyle,
  opacity: number,
): void {
  if (style === 'none') return

  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const hw = size * 0.4 // half-width of arrowhead base

  let svgPath: string

  if (style === 'filled-arrow' || style === 'arrow') {
    const lx = x - size * cos + hw * sin
    const ly = y - size * sin - hw * cos
    const rx = x - size * cos - hw * sin
    const ry = y - size * sin + hw * cos
    svgPath =
      style === 'filled-arrow'
        ? `M ${x} ${y} L ${lx} ${ly} L ${rx} ${ry} Z`
        : `M ${lx} ${ly} L ${x} ${y} L ${rx} ${ry}`
  } else if (style === 'diamond') {
    const mx = x - size * 0.5 * cos
    const my = y - size * 0.5 * sin
    const lx = mx + hw * sin
    const ly = my - hw * cos
    const rx = mx - hw * sin
    const ry = my + hw * cos
    const bx = x - size * cos
    const by = y - size * sin
    svgPath = `M ${x} ${y} L ${lx} ${ly} L ${bx} ${by} L ${rx} ${ry} Z`
  } else {
    // circle — two-arc SVG approximation
    const cx = x - size * 0.5 * cos
    const cy = y - size * 0.5 * sin
    const r = hw
    svgPath = `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0`
  }

  const skPath = ck.Path.MakeFromSVGString(svgPath)
  if (!skPath) return

  const filled = style === 'filled-arrow' || style === 'diamond' || style === 'circle'
  withPaint(ck, (paint) => {
    paint.setAntiAlias(true)
    paint.setAlphaf(opacity)
    paint.setColor(colorToCK(ck, stroke.color))
    if (filled) {
      paint.setStyle(ck.PaintStyle.Fill)
    } else {
      paint.setStyle(ck.PaintStyle.Stroke)
      paint.setStrokeWidth(stroke.width)
      paint.setStrokeJoin(ck.StrokeJoin.Round)
      paint.setStrokeCap(ck.StrokeCap.Round)
    }
    canvas.drawPath(skPath, paint)
  })

  skPath.delete()
}

// ---------------------------------------------------------------------------
// Utility — run a function with a Paint, delete when done
// ---------------------------------------------------------------------------

/**
 * Create a paint, call `fn` with it, then delete it automatically.
 * Prevents accidental memory leaks when many render paths are involved.
 */
export function withPaint<T>(ck: PaintCK, fn: (paint: SkPaint) => T): T {
  const paint = new ck.Paint()
  try {
    return fn(paint)
  } finally {
    paint.delete()
  }
}

// ---------------------------------------------------------------------------
// Effect paint — used for saveLayer when effects are present
// ---------------------------------------------------------------------------

function makeEffectsImageFilter(ck: EffectCK, effects: Effect[]): SkImageFilter | null {
  let result: SkImageFilter | null = null
  for (const effect of effects) {
    let filter: SkImageFilter | null = null
    if (effect.type === 'drop-shadow') {
      filter = ck.ImageFilter.MakeDropShadow(
        effect.offsetX,
        effect.offsetY,
        effect.blur,
        effect.blur,
        ck.Color4f(effect.color.r, effect.color.g, effect.color.b, effect.color.a),
        null,
      )
    } else if (effect.type === 'blur') {
      filter = ck.ImageFilter.MakeBlur(effect.radius, effect.radius, ck.TileMode.Clamp, null)
    }
    if (filter !== null) {
      if (result !== null) {
        const composed = ck.ImageFilter.MakeCompose(result, filter)
        result.delete()
        filter.delete()
        result = composed
      } else {
        result = filter
      }
    }
  }
  return result
}

/**
 * Create a saveLayer paint that composites the object with the given effects.
 * The caller is responsible for calling `paint.delete()` when done.
 *
 * Pass to `canvas.saveLayer(paint)` before drawing the object, then call
 * `canvas.restore()` after drawing to composite the layer with the filter applied.
 */
export function makeEffectPaint(ck: EffectCK, effects: Effect[]): SkPaint {
  const paint = new ck.Paint()
  const filter = makeEffectsImageFilter(ck, effects)
  if (filter !== null) {
    paint.setImageFilter(filter)
    filter.delete()
  }
  return paint
}

/**
 * Returns a stable cache key for an array of effects.
 * Simple JSON serialization — effects arrays are typically small (1–3 items).
 */
export function effectsCacheKey(effects: Effect[]): string {
  return JSON.stringify(effects)
}
