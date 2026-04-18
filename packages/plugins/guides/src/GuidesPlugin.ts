import type {
  Plugin,
  StageInterface,
  RenderContext,
  RenderPass,
  CanvasPointerEvent,
  BaseObject,
} from '@nexvas/core'

// ---------------------------------------------------------------------------
// CanvasKit interface fragments
// ---------------------------------------------------------------------------
interface SkCanvas {
  drawLine(x0: number, y0: number, x1: number, y1: number, paint: unknown): void
}

interface GuidesCK {
  Paint: new () => SkPaint
  Color4f(r: number, g: number, b: number, a: number): Float32Array
  PaintStyle: { Stroke: unknown }
  PathEffect: { MakeDash(intervals: number[], phase: number): unknown }
}

interface SkPaint {
  setStyle(style: unknown): void
  setColor(color: Float32Array): void
  setAntiAlias(aa: boolean): void
  setStrokeWidth(w: number): void
  setPathEffect(e: unknown): void
  delete(): void
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SnapEdge {
  /** World-space position of this edge. */
  value: number
  /** Is this a horizontal (y-axis) or vertical (x-axis) guide? */
  axis: 'x' | 'y'
}

interface ActiveGuide {
  axis: 'x' | 'y'
  /** World-space coordinate where the guide line is drawn. */
  position: number
}

export interface GuidesPluginOptions {
  /**
   * Snap threshold in world units. Default: 6.
   */
  snapThreshold?: number
  /**
   * Color of guide lines. Default: red-pink.
   */
  color?: { r: number; g: number; b: number; a: number }
}

/**
 * Type augmentation for accessing GuidesPlugin through the stage.
 * @example
 * const guides = (stage as GuidesPluginAPI).guides
 */
export interface GuidesPluginAPI {
  guides: GuidesPlugin
}

/**
 * GuidesPlugin — shows smart alignment guides and snaps objects to nearby
 * edges and centres of other objects during drag.
 *
 * Listens for `mousedown`/`mousemove`/`mouseup` and renders guides via
 * a post-render pass.
 */
export class GuidesPlugin implements Plugin {
  readonly name = 'guides'
  readonly version = '0.1.0'

  private _stage: StageInterface | null = null
  private _options: Required<GuidesPluginOptions>
  private _renderPass: RenderPass | null = null
  private _activeGuides: ActiveGuide[] = []

  // The object being dragged (set on mousedown hit test)
  private _dragging: BaseObject | null = null
  private _dragStartWorld: { x: number; y: number } | null = null
  private _dragInitialPos: { x: number; y: number } | null = null

  private _onMouseDown: (e: CanvasPointerEvent) => void
  private _onMouseMove: (e: CanvasPointerEvent) => void
  private _onMouseUp: (e: CanvasPointerEvent) => void

  constructor(options: GuidesPluginOptions = {}) {
    this._options = {
      snapThreshold: options.snapThreshold ?? 6,
      color: options.color ?? { r: 1, g: 0.2, b: 0.4, a: 0.9 },
    }

    this._onMouseDown = this._handleMouseDown.bind(this)
    this._onMouseMove = this._handleMouseMove.bind(this)
    this._onMouseUp = this._handleMouseUp.bind(this)
  }

  // ---------------------------------------------------------------------------
  // Plugin lifecycle
  // ---------------------------------------------------------------------------

  install(stage: StageInterface): void {
    this._stage = stage
    ;(stage as unknown as GuidesPluginAPI).guides = this
    stage.on('mousedown', this._onMouseDown)
    stage.on('mousemove', this._onMouseMove)
    stage.on('mouseup', this._onMouseUp)

    this._renderPass = {
      phase: 'post',
      order: 200,
      render: (ctx: RenderContext) => this._drawGuides(ctx),
    }
    stage.addRenderPass(this._renderPass)
  }

  uninstall(stage: StageInterface): void {
    stage.off('mousedown', this._onMouseDown)
    stage.off('mousemove', this._onMouseMove)
    stage.off('mouseup', this._onMouseUp)

    if (this._renderPass) {
      stage.removeRenderPass(this._renderPass)
      this._renderPass = null
    }

    this._activeGuides = []
    this._dragging = null
    this._stage = null
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private _handleMouseDown(e: CanvasPointerEvent): void {
    if (!this._stage) return
    const { x: wx, y: wy } = e.world

    const layers = this._stage.layers
    for (let i = layers.length - 1; i >= 0; i--) {
      const obj = layers[i]!.hitTest(wx, wy)
      if (obj && !obj.locked) {
        this._dragging = obj
        this._dragStartWorld = { x: wx, y: wy }
        this._dragInitialPos = { x: obj.x, y: obj.y }
        break
      }
    }
  }

  private _handleMouseMove(e: CanvasPointerEvent): void {
    if (!this._dragging || !this._dragStartWorld || !this._dragInitialPos || !this._stage) return

    const dx = e.world.x - this._dragStartWorld.x
    const dy = e.world.y - this._dragStartWorld.y

    let newX = this._dragInitialPos.x + dx
    let newY = this._dragInitialPos.y + dy

    // Compute snap targets from other objects
    const targets = this._collectSnapTargets(this._dragging)
    const { snappedX, snappedY, guides } = this._computeSnap(
      newX,
      newY,
      this._dragging.width,
      this._dragging.height,
      targets,
    )

    newX = snappedX
    newY = snappedY

    this._dragging.x = newX
    this._dragging.y = newY
    this._activeGuides = guides
    this._stage.markDirty()
  }

  private _handleMouseUp(_e: CanvasPointerEvent): void {
    this._dragging = null
    this._dragStartWorld = null
    this._dragInitialPos = null
    this._activeGuides = []
    this._stage?.markDirty()
  }

  // ---------------------------------------------------------------------------
  // Snap computation
  // ---------------------------------------------------------------------------

  private _collectSnapTargets(exclude: BaseObject): SnapEdge[] {
    if (!this._stage) return []
    const edges: SnapEdge[] = []

    for (const layer of this._stage.layers) {
      for (const obj of layer.objects) {
        if (obj === exclude || !obj.visible) continue
        const bb = obj.getWorldBoundingBox()
        edges.push(
          { axis: 'x', value: bb.x },
          { axis: 'x', value: bb.x + bb.width / 2 },
          { axis: 'x', value: bb.right },
          { axis: 'y', value: bb.y },
          { axis: 'y', value: bb.y + bb.height / 2 },
          { axis: 'y', value: bb.bottom },
        )
      }
    }
    return edges
  }

  private _computeSnap(
    x: number,
    y: number,
    w: number,
    h: number,
    targets: SnapEdge[],
  ): { snappedX: number; snappedY: number; guides: ActiveGuide[] } {
    const threshold = this._options.snapThreshold
    let snappedX = x
    let snappedY = y
    const guides: ActiveGuide[] = []

    // Candidate edges of the dragged object: left, center, right
    const xCandidates = [x, x + w / 2, x + w]
    const yCandidates = [y, y + h / 2, y + h]

    for (const target of targets) {
      if (target.axis === 'x') {
        for (const candidate of xCandidates) {
          const delta = target.value - candidate
          if (Math.abs(delta) <= threshold) {
            snappedX = x + delta
            guides.push({ axis: 'x', position: target.value })
            break
          }
        }
      } else {
        for (const candidate of yCandidates) {
          const delta = target.value - candidate
          if (Math.abs(delta) <= threshold) {
            snappedY = y + delta
            guides.push({ axis: 'y', position: target.value })
            break
          }
        }
      }
    }

    return { snappedX, snappedY, guides }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Returns currently active guide lines (axis and world-space position). */
  getActiveGuides(): Array<{ axis: 'x' | 'y'; position: number }> {
    return [...this._activeGuides]
  }

  /** Update snap threshold at runtime without reinstalling the plugin. */
  setSnapThreshold(threshold: number): void {
    this._options.snapThreshold = threshold
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  private _drawGuides(ctx: RenderContext): void {
    if (this._activeGuides.length === 0 || !ctx.skCanvas || !ctx.canvasKit) return
    const ck = ctx.canvasKit as unknown as GuidesCK
    const canvas = ctx.skCanvas as SkCanvas
    const vp = ctx.viewport
    const color = this._options.color

    const invScale = 1 / vp.scale
    const worldLeft = -vp.x * invScale
    const worldTop = -vp.y * invScale
    const worldRight = worldLeft + (vp.width ?? 4000) * invScale
    const worldBottom = worldTop + (vp.height ?? 4000) * invScale

    const paint = new ck.Paint()
    paint.setStyle(ck.PaintStyle.Stroke)
    paint.setColor(ck.Color4f(color.r, color.g, color.b, color.a))
    paint.setAntiAlias(true)
    paint.setStrokeWidth(invScale)
    if (ck.PathEffect) {
      paint.setPathEffect(ck.PathEffect.MakeDash([6 * invScale, 3 * invScale], 0))
    }

    for (const guide of this._activeGuides) {
      if (guide.axis === 'x') {
        // Vertical line at x = guide.position
        canvas.drawLine(guide.position, worldTop, guide.position, worldBottom, paint)
      } else {
        // Horizontal line at y = guide.position
        canvas.drawLine(worldLeft, guide.position, worldRight, guide.position, paint)
      }
    }

    paint.delete()
  }
}
