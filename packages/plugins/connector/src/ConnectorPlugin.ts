import type {
  Plugin,
  StageInterface,
  CanvasPointerEvent,
  RenderContext,
  RenderPass,
  BaseObject,
  Port,
  StrokeStyle,
} from '@nexvas/core'
import { Connector, type ConnectorEndpoint, type ConnectorRouting } from '@nexvas/core'

// ---------------------------------------------------------------------------
// CanvasKit interface stubs for the render pass
// ---------------------------------------------------------------------------

interface Color4f {
  (r: number, g: number, b: number, a: number): Float32Array
}

interface SkPaint {
  delete(): void
  setAntiAlias(aa: boolean): void
  setColor4f(color: Float32Array, colorSpace?: unknown): void
  setStrokeWidth(w: number): void
  setStyle(style: unknown): void
}

interface ConnectorCK {
  Color4f: Color4f
  PaintStyle: { Fill: unknown; Stroke: unknown }
  Paint: new () => SkPaint
  Path: new () => {
    moveTo(x: number, y: number): void
    lineTo(x: number, y: number): void
    delete(): void
  }
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Options for ConnectorPlugin. */
export interface ConnectorPluginOptions {
  /** Default routing for newly created connectors. Default: 'straight'. */
  defaultRouting?: ConnectorRouting
  /** Default stroke style for new connectors. */
  defaultStroke?: StrokeStyle
  /** Screen-pixel radius within which a port is considered a snap target. Default: 20. */
  portSnapTolerance?: number
  /** Called when a connector is successfully created. */
  onConnect?: (connector: Connector) => void
}

/** Type augmentation to access ConnectorPlugin through the stage. */
export interface ConnectorPluginAPI {
  connector: ConnectorPlugin
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface DrawState {
  /** Fixed world-space source position. */
  srcX: number
  srcY: number
  /** Source endpoint reference, if snapped to a port when the drag started. */
  srcRef: { objectId: string; portId: string } | null
  /** Current world-space cursor position. */
  curX: number
  curY: number
  /** Snap target under the cursor, if any. */
  snapTarget: { obj: BaseObject; port: Port; wx: number; wy: number } | null
}

interface HoverState {
  obj: BaseObject
  ports: Array<{ port: Port; wx: number; wy: number }>
}

// ---------------------------------------------------------------------------
// ConnectorPlugin
// ---------------------------------------------------------------------------

/**
 * ConnectorPlugin — enables interactive connector drawing on the canvas.
 *
 * When connect mode is active, users can drag from any object port to another
 * object's port (or to a free point) to create a {@link Connector}.
 *
 * Usage:
 * ```ts
 * const plugin = new ConnectorPlugin()
 * stage.use(plugin)
 * plugin.startConnectMode()
 * ```
 *
 * Or create connectors programmatically:
 * ```ts
 * plugin.createConnector({ source: { objectId: 'r1', portId: 'right' }, target: { objectId: 'r2', portId: 'left' } })
 * ```
 */
export class ConnectorPlugin implements Plugin {
  readonly name = 'connector'
  readonly version = '0.1.0'

  private _stage: StageInterface | null = null
  private _options: Required<Omit<ConnectorPluginOptions, 'onConnect'>> & {
    onConnect: NonNullable<ConnectorPluginOptions['onConnect']>
  }

  /** Whether connector drawing mode is currently active. */
  private _connectMode = false
  /** State while a connector is actively being drawn (mouse held down). */
  private _draw: DrawState | null = null
  /** Hovered object and its computed port positions. */
  private _hover: HoverState | null = null

  private _renderPass: RenderPass | null = null

  private _onMouseDown: (e: CanvasPointerEvent) => void
  private _onMouseMove: (e: CanvasPointerEvent) => void
  private _onMouseUp: (e: CanvasPointerEvent) => void
  private _onMouseLeave: (e: CanvasPointerEvent) => void

  constructor(options: ConnectorPluginOptions = {}) {
    this._options = {
      defaultRouting: options.defaultRouting ?? 'straight',
      defaultStroke: options.defaultStroke ?? {
        color: { r: 0.2, g: 0.2, b: 0.2, a: 1 },
        width: 2,
        endArrow: 'filled-arrow',
      },
      portSnapTolerance: options.portSnapTolerance ?? 20,
      onConnect: options.onConnect ?? (() => undefined),
    }

    this._onMouseDown = this._handleMouseDown.bind(this)
    this._onMouseMove = this._handleMouseMove.bind(this)
    this._onMouseUp = this._handleMouseUp.bind(this)
    this._onMouseLeave = this._handleMouseLeave.bind(this)
  }

  // ---------------------------------------------------------------------------
  // Plugin lifecycle
  // ---------------------------------------------------------------------------

  /** Install the plugin on a stage. */
  install(stage: StageInterface): void {
    this._stage = stage
    ;(stage as unknown as ConnectorPluginAPI).connector = this

    this._renderPass = {
      phase: 'post',
      order: 90,
      render: (ctx: RenderContext) => this._drawOverlay(ctx),
    }
    stage.addRenderPass(this._renderPass)

    stage.on('mousedown', this._onMouseDown)
    stage.on('mousemove', this._onMouseMove)
    stage.on('mouseup', this._onMouseUp)
    stage.on('mouseleave', this._onMouseLeave)
  }

  /** Uninstall the plugin, removing all event listeners and render passes. */
  uninstall(stage: StageInterface): void {
    stage.off('mousedown', this._onMouseDown)
    stage.off('mousemove', this._onMouseMove)
    stage.off('mouseup', this._onMouseUp)
    stage.off('mouseleave', this._onMouseLeave)

    if (this._renderPass) {
      stage.removeRenderPass(this._renderPass)
      this._renderPass = null
    }

    this._draw = null
    this._hover = null
    this._connectMode = false
    this._stage = null
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Enable connector-drawing mode.
   * In this mode, hovering over objects shows port indicators and users can
   * drag from one port to another to create a connector.
   */
  startConnectMode(): void {
    this._connectMode = true
    this._stage?.markDirty()
  }

  /**
   * Disable connector-drawing mode.
   * Any in-progress connector draw is cancelled.
   */
  stopConnectMode(): void {
    this._connectMode = false
    this._draw = null
    this._hover = null
    this._stage?.markDirty()
  }

  /** Returns true when connector-drawing mode is active. */
  isConnectMode(): boolean {
    return this._connectMode
  }

  /** Returns true when the user is actively dragging a new connector. */
  isConnecting(): boolean {
    return this._draw !== null
  }

  /**
   * Programmatically create a connector between two endpoints.
   * The connector is added to the first layer of the stage.
   *
   * @param props - Source and target endpoints, optional routing and label.
   * @returns The newly created {@link Connector}, or null if no stage is installed.
   */
  createConnector(props: {
    source: ConnectorEndpoint
    target: ConnectorEndpoint
    routing?: ConnectorRouting
    label?: string
    labelOffset?: number
  }): Connector | null {
    if (!this._stage) return null
    const connector = new Connector({
      source: props.source,
      target: props.target,
      routing: props.routing ?? this._options.defaultRouting,
      label: props.label,
      labelOffset: props.labelOffset,
      stroke: this._options.defaultStroke,
    })
    const layer = this._stage.layers[0]
    if (!layer) return null
    layer.add(connector)
    this._options.onConnect(connector)
    this._stage.markDirty()
    return connector
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private _handleMouseDown(e: CanvasPointerEvent): void {
    if (!this._connectMode || !this._stage || e.stopped) return

    const { x: wx, y: wy } = e.world

    // Try to snap to a port under the cursor
    const snap = this._findSnapTarget(wx, wy)
    this._draw = {
      srcX: snap ? snap.wx : wx,
      srcY: snap ? snap.wy : wy,
      srcRef: snap ? { objectId: snap.obj.id, portId: snap.port.id } : null,
      curX: wx,
      curY: wy,
      snapTarget: null,
    }
    this._stage.markDirty()
  }

  private _handleMouseMove(e: CanvasPointerEvent): void {
    if (!this._connectMode || !this._stage) return

    const { x: wx, y: wy } = e.world

    // Update hover (port indicators)
    this._hover = this._computeHover(wx, wy)

    if (this._draw) {
      // Update preview line endpoint + snap target
      const snap = this._findSnapTarget(wx, wy)
      this._draw.curX = snap ? snap.wx : wx
      this._draw.curY = snap ? snap.wy : wy
      this._draw.snapTarget = snap
    }

    this._stage.markDirty()
  }

  private _handleMouseUp(e: CanvasPointerEvent): void {
    if (!this._draw || !this._stage) return

    const { x: wx, y: wy } = e.world
    const draw = this._draw
    const snap = this._findSnapTarget(wx, wy)

    const source: ConnectorEndpoint = draw.srcRef
      ? draw.srcRef
      : { x: draw.srcX, y: draw.srcY }

    const target: ConnectorEndpoint = snap
      ? { objectId: snap.obj.id, portId: snap.port.id }
      : { x: wx, y: wy }

    this._draw = null
    this._hover = null

    // Avoid zero-length fixed-to-fixed connectors
    const isTrivial =
      !('objectId' in source) &&
      !('objectId' in target) &&
      Math.hypot((target as { x: number }).x - (source as { x: number }).x,
                 (target as { y: number }).y - (source as { y: number }).y) < 4

    if (!isTrivial) {
      this.createConnector({ source, target })
    }

    this._stage.markDirty()
  }

  private _handleMouseLeave(_e: CanvasPointerEvent): void {
    this._hover = null
    this._draw = null
    this._stage?.markDirty()
  }

  // ---------------------------------------------------------------------------
  // Port helpers
  // ---------------------------------------------------------------------------

  /** Compute world positions for all ports on all visible objects near the cursor. */
  private _computeHover(wx: number, wy: number): HoverState | null {
    if (!this._stage) return null

    // Find the topmost hittable object under the cursor
    const layers = this._stage.layers
    for (let i = layers.length - 1; i >= 0; i--) {
      const obj = layers[i]!.hitTest(wx, wy)
      if (obj && !obj.locked) {
        return {
          obj,
          ports: this._getPortWorldPositions(obj),
        }
      }
    }
    return null
  }

  private _getPortWorldPositions(obj: BaseObject): Array<{ port: Port; wx: number; wy: number }> {
    return obj.getPorts().map((port) => {
      const pos = obj.getPortWorldPosition(port.id)
      return { port, wx: pos?.x ?? 0, wy: pos?.y ?? 0 }
    })
  }

  /** Find a port within snap tolerance of the given world-space point. */
  private _findSnapTarget(
    wx: number,
    wy: number,
  ): { obj: BaseObject; port: Port; wx: number; wy: number } | null {
    if (!this._stage) return null

    const viewportScale = this._stage.viewport.scale
    const worldTol = this._options.portSnapTolerance / viewportScale

    const layers = this._stage.layers
    for (let i = layers.length - 1; i >= 0; i--) {
      const objects = layers[i]!.objects
      for (const obj of objects) {
        if (!obj.visible || obj.locked) continue
        for (const port of obj.getPorts()) {
          const pos = obj.getPortWorldPosition(port.id)
          if (!pos) continue
          if (Math.hypot(wx - pos.x, wy - pos.y) <= worldTol) {
            return { obj, port, wx: pos.x, wy: pos.y }
          }
        }
      }
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // Render pass overlay
  // ---------------------------------------------------------------------------

  private _drawOverlay(ctx: RenderContext): void {
    if (!this._connectMode) return
    const ck = ctx.canvasKit as unknown as ConnectorCK
    const canvas = ctx.skCanvas as unknown as {
      save(): number
      restore(): void
      drawCircle(cx: number, cy: number, r: number, paint: SkPaint): void
      drawPath(path: unknown, paint: SkPaint): void
    }
    if (!canvas || !ck?.Paint) return

    const viewportScale = ctx.viewport.scale

    // Draw port indicators on hovered object
    if (this._hover) {
      const fillPaint = new ck.Paint()
      fillPaint.setAntiAlias(true)
      fillPaint.setStyle(ck.PaintStyle.Fill)
      fillPaint.setColor4f(ck.Color4f(0.2, 0.5, 1.0, 0.85))

      const strokePaint = new ck.Paint()
      strokePaint.setAntiAlias(true)
      strokePaint.setStyle(ck.PaintStyle.Stroke)
      strokePaint.setColor4f(ck.Color4f(1, 1, 1, 1))
      strokePaint.setStrokeWidth(1.5 / viewportScale)

      const r = 5 / viewportScale

      for (const { wx, wy } of this._hover.ports) {
        canvas.drawCircle(wx, wy, r, fillPaint)
        canvas.drawCircle(wx, wy, r, strokePaint)
      }

      fillPaint.delete()
      strokePaint.delete()
    }

    // Draw snap indicator on active snap target
    if (this._draw?.snapTarget) {
      const { wx, wy } = this._draw.snapTarget
      const snapPaint = new ck.Paint()
      snapPaint.setAntiAlias(true)
      snapPaint.setStyle(ck.PaintStyle.Fill)
      snapPaint.setColor4f(ck.Color4f(0.0, 0.8, 0.4, 0.9))
      canvas.drawCircle(wx, wy, 7 / viewportScale, snapPaint)
      snapPaint.delete()
    }

    // Draw preview line
    if (this._draw) {
      const linePaint = new ck.Paint()
      linePaint.setAntiAlias(true)
      linePaint.setStyle(ck.PaintStyle.Stroke)
      linePaint.setStrokeWidth(2 / viewportScale)
      linePaint.setColor4f(ck.Color4f(0.2, 0.5, 1.0, 0.7))

      const skPath = new ck.Path()
      skPath.moveTo(this._draw.srcX, this._draw.srcY)
      skPath.lineTo(this._draw.curX, this._draw.curY)
      canvas.drawPath(skPath, linePaint)
      skPath.delete()
      linePaint.delete()
    }
  }
}
