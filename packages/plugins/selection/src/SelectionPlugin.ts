import type {
  Plugin,
  StageInterface,
  RenderContext,
  RenderPass,
  CanvasPointerEvent,
  BaseObject,
} from '@nexvas/core'

// ---------------------------------------------------------------------------
// CanvasKit interface fragments needed for selection rendering
// ---------------------------------------------------------------------------
interface SkCanvas {
  save(): number
  restore(): void
  drawRect(rect: number[], paint: unknown): void
  drawCircle(cx: number, cy: number, r: number, paint: unknown): void
  drawLine(x0: number, y0: number, x1: number, y1: number, paint: unknown): void
  concat(m: number[]): void
}

interface SelectionCK {
  Paint: new () => SkPaint
  Color4f(r: number, g: number, b: number, a: number): Float32Array
  PaintStyle: { Fill: unknown; Stroke: unknown }
  PathEffect: { MakeDash(intervals: number[], phase: number): SkPathEffect }
  LTRBRect(l: number, t: number, r: number, b: number): Float32Array
}

interface SkPaint {
  setStyle(style: unknown): void
  setColor(color: Float32Array): void
  setAntiAlias(aa: boolean): void
  setStrokeWidth(w: number): void
  setAlphaf(a: number): void
  setPathEffect(e: SkPathEffect | null): void
  delete(): void
}

interface SkPathEffect {
  delete(): void
}

// ---------------------------------------------------------------------------
// Handle positions — 8 handles: 4 corners + 4 midpoints
// ---------------------------------------------------------------------------
type HandleId = 'tl' | 'tc' | 'tr' | 'ml' | 'mr' | 'bl' | 'bc' | 'br' | 'rot'

interface Handle {
  id: HandleId
  x: number // world-space x
  y: number // world-space y
}

const HANDLE_SIZE = 8 // half-size (handle is HANDLE_SIZE*2 square)
const ROT_HANDLE_OFFSET = 24 // pixels above top-center

// ---------------------------------------------------------------------------
// Drag state
// ---------------------------------------------------------------------------
interface DragState {
  type: 'move' | 'resize' | 'rotate' | 'marquee'
  startWorldX: number
  startWorldY: number
  // move/resize: snapshot of initial object positions
  initialPositions: Map<
    string,
    { x: number; y: number; width: number; height: number; rotation: number }
  >
  // resize handle
  handle?: HandleId
  // marquee bounds in world space
  marqueeX?: number
  marqueeY?: number
  marqueeW?: number
  marqueeH?: number
}

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------
export interface SelectionPluginOptions {
  /** Stroke color for selection border. Default: blue. */
  selectionColor?: { r: number; g: number; b: number; a: number }
  /** Allow deleting selected objects with Delete/Backspace keys. Default: true. */
  allowDelete?: boolean
}

/**
 * Type augmentation for accessing SelectionPlugin through the stage.
 * @example
 * const sel = (stage as SelectionPluginAPI).selection
 */
export interface SelectionPluginAPI {
  selection: SelectionPlugin
}

type ChangeHandler = (selected: BaseObject[]) => void

/**
 * SelectionPlugin — click to select objects, drag to move, handles to resize/rotate.
 *
 * Features:
 * - Click to select / Shift+click for multi-select
 * - Click on empty area to deselect
 * - Drag selected objects to move them
 * - 8 transform handles (corners + midpoints) for resize
 * - Rotation handle above the selection
 * - Marquee (drag-to-select) on empty area
 * - Delete/Backspace key removes selected objects
 */
export class SelectionPlugin implements Plugin {
  readonly name = 'selection'
  readonly version = '0.1.0'

  private _stage: StageInterface | null = null
  private _selected: Set<BaseObject> = new Set()
  private _options: Required<SelectionPluginOptions>
  private _renderPass: RenderPass | null = null
  private _dragState: DragState | null = null
  private _changeHandlers: Set<ChangeHandler> = new Set()

  // Cached paints — created lazily on first draw, deleted on uninstall.
  // Zero WASM allocs per frame: all paints are reused; only stroke widths
  // (cheap setters, no allocation) and path effects (recreated only when
  // viewport scale changes) are updated between frames.
  private _handleFillPaint: SkPaint | null = null
  private _handleStrokePaint: SkPaint | null = null
  private _borderPaint: SkPaint | null = null
  private _rotLinePaint: SkPaint | null = null
  private _marqueePaint: SkPaint | null = null
  // Path effects — WASM objects; recreated only when invScale changes.
  private _borderDashEffect: SkPathEffect | null = null
  private _marqueeDashEffect: SkPathEffect | null = null
  // Last recorded invScale so we know when to rebuild path effects.
  private _lastInvScale = -1

  // Bound event handlers (stored for cleanup)
  private _onMouseDown: (e: CanvasPointerEvent) => void
  private _onMouseMove: (e: CanvasPointerEvent) => void
  private _onMouseUp: (e: CanvasPointerEvent) => void
  private _onKeyDown: (e: KeyboardEvent) => void

  constructor(options: SelectionPluginOptions = {}) {
    this._options = {
      selectionColor: options.selectionColor ?? { r: 0.039, g: 0.522, b: 1, a: 1 },
      allowDelete: options.allowDelete ?? true,
    }

    this._onMouseDown = this._handleMouseDown.bind(this)
    this._onMouseMove = this._handleMouseMove.bind(this)
    this._onMouseUp = this._handleMouseUp.bind(this)
    this._onKeyDown = this._handleKeyDown.bind(this)
  }

  // ---------------------------------------------------------------------------
  // Plugin lifecycle
  // ---------------------------------------------------------------------------

  install(stage: StageInterface): void {
    this._stage = stage
    ;(stage as unknown as SelectionPluginAPI).selection = this

    stage.on('mousedown', this._onMouseDown)
    stage.on('mousemove', this._onMouseMove)
    stage.on('mouseup', this._onMouseUp)

    if (this._options.allowDelete && typeof document !== 'undefined') {
      document.addEventListener('keydown', this._onKeyDown)
    }

    this._renderPass = {
      phase: 'post',
      order: 100,
      render: (ctx: RenderContext) => this._drawSelection(ctx),
    }
    stage.addRenderPass(this._renderPass)
  }

  uninstall(stage: StageInterface): void {
    stage.off('mousedown', this._onMouseDown)
    stage.off('mousemove', this._onMouseMove)
    stage.off('mouseup', this._onMouseUp)

    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this._onKeyDown)
    }

    if (this._renderPass) {
      stage.removeRenderPass(this._renderPass)
      this._renderPass = null
    }

    this._handleFillPaint?.delete()
    this._handleFillPaint = null
    this._handleStrokePaint?.delete()
    this._handleStrokePaint = null
    this._borderPaint?.delete()
    this._borderPaint = null
    this._rotLinePaint?.delete()
    this._rotLinePaint = null
    this._marqueePaint?.delete()
    this._marqueePaint = null
    this._borderDashEffect?.delete()
    this._borderDashEffect = null
    this._marqueeDashEffect?.delete()
    this._marqueeDashEffect = null
    this._lastInvScale = -1

    this._selected.clear()
    this._dragState = null
    this._stage = null
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Select a single object (replaces current selection). */
  select(obj: BaseObject): void {
    this._selected.clear()
    this._selected.add(obj)
    this._emitChange()
    this._stage?.markDirty()
  }

  /** Add an object to the selection. */
  addToSelection(obj: BaseObject): void {
    this._selected.add(obj)
    this._emitChange()
    this._stage?.markDirty()
  }

  /** Remove an object from the selection. */
  deselect(obj: BaseObject): void {
    this._selected.delete(obj)
    this._emitChange()
    this._stage?.markDirty()
  }

  /** Clear the selection. */
  clearSelection(): void {
    if (this._selected.size === 0) return
    this._selected.clear()
    this._emitChange()
    this._stage?.markDirty()
  }

  /** Select all visible unlocked objects across all layers. */
  selectAll(): void {
    this._selected.clear()
    for (const layer of this._stage?.layers ?? []) {
      for (const obj of layer.objects) {
        if (obj.visible && !obj.locked) this._selected.add(obj)
      }
    }
    this._emitChange()
    this._stage?.markDirty()
  }

  /** All currently selected objects. */
  get selected(): readonly BaseObject[] {
    return Array.from(this._selected)
  }

  /** @deprecated Use `.selected` instead. */
  getSelected(): BaseObject[] {
    return Array.from(this._selected)
  }

  /** Alias for clearSelection(). */
  deselectAll(): void {
    this.clearSelection()
  }

  /** Listen for selection changes. Returns an unsubscribe function. */
  onChange(handler: ChangeHandler): () => void {
    this._changeHandlers.add(handler)
    return () => this._changeHandlers.delete(handler)
  }

  private _emitChange(): void {
    const selected = Array.from(this._selected)
    this._changeHandlers.forEach((h) => h(selected))
    this._stage?.emit('selection:change', { selected })
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private _handleMouseDown(e: CanvasPointerEvent): void {
    if (!this._stage) return

    const { world, screen } = e

    // Check if clicking on a resize/rotation handle
    const handle = this._hitTestHandle(screen.x, screen.y)
    if (handle && this._selected.size > 0) {
      this._startDrag('resize', e, handle)
      return
    }

    // Hit-test scene objects
    const hit = this._hitTestScene(world.x, world.y)

    if (hit) {
      if (!this._selected.has(hit)) {
        const shiftHeld = (e.originalEvent as MouseEvent).shiftKey
        if (shiftHeld) {
          this._selected.add(hit)
        } else {
          this._selected.clear()
          this._selected.add(hit)
        }
        this._emitChange()
      }
      this._startDrag('move', e)
    } else {
      // Click on empty area — start marquee or deselect
      const shiftHeld = (e.originalEvent as MouseEvent).shiftKey
      if (!shiftHeld) {
        this._selected.clear()
        this._emitChange()
      }
      this._startDrag('marquee', e)
    }

    this._stage.markDirty()
  }

  private _handleMouseMove(e: CanvasPointerEvent): void {
    if (!this._dragState || !this._stage) return
    const { world } = e

    const ds = this._dragState
    const dWorldX = world.x - ds.startWorldX
    const dWorldY = world.y - ds.startWorldY

    if (ds.type === 'move') {
      for (const obj of this._selected) {
        if (obj.locked || !obj.isMovable) continue
        const init = ds.initialPositions.get(obj.id)
        if (init) {
          obj.x = init.x + dWorldX
          obj.y = init.y + dWorldY
        }
      }
    } else if (ds.type === 'resize' && ds.handle) {
      this._applyResize(ds.handle, dWorldX, dWorldY)
    } else if (ds.type === 'marquee') {
      // Track marquee in world space so finalization and drawing are consistent
      ds.marqueeX = Math.min(world.x, ds.startWorldX)
      ds.marqueeY = Math.min(world.y, ds.startWorldY)
      ds.marqueeW = Math.abs(world.x - ds.startWorldX)
      ds.marqueeH = Math.abs(world.y - ds.startWorldY)
    }

    this._stage.markDirty()
  }

  private _handleMouseUp(_e: CanvasPointerEvent): void {
    if (!this._dragState || !this._stage) return

    if (this._dragState.type === 'marquee') {
      this._finishMarquee()
    }

    this._dragState = null
    this._stage.markDirty()
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    if (!this._stage || this._selected.size === 0) return
    if (e.key !== 'Delete' && e.key !== 'Backspace') return

    const deletedObjects = Array.from(this._selected)

    // Build a reverse index: object id -> layer (single pass over all layers)
    const objToLayer = new Map<string, typeof this._stage.layers[0]>()
    for (const layer of this._stage.layers) {
      for (const obj of layer.objects) {
        objToLayer.set(obj.id, layer)
      }
    }
    // Now remove in O(k) where k = selected objects
    for (const obj of this._selected) {
      objToLayer.get(obj.id)?.remove(obj)
    }
    this._selected.clear()
    this._stage.emit('objects:deleted', { objects: deletedObjects })
    this._emitChange()
    this._stage.markDirty()
  }

  // ---------------------------------------------------------------------------
  // Drag helpers
  // ---------------------------------------------------------------------------

  private _startDrag(type: DragState['type'], e: CanvasPointerEvent, handle?: HandleId): void {
    const initialPositions = new Map<
      string,
      { x: number; y: number; width: number; height: number; rotation: number }
    >()
    for (const obj of this._selected) {
      initialPositions.set(obj.id, {
        x: obj.x,
        y: obj.y,
        width: obj.width,
        height: obj.height,
        rotation: obj.rotation,
      })
    }
    this._dragState = {
      type,
      startWorldX: e.world.x,
      startWorldY: e.world.y,
      initialPositions,
      ...(handle !== undefined && { handle }),
    }
  }

  private _applyResize(handle: HandleId, dWorldX: number, dWorldY: number): void {
    for (const obj of this._selected) {
      if (obj.locked || !obj.isResizable) continue
      const init = this._dragState!.initialPositions.get(obj.id)
      if (!init) continue

      switch (handle) {
        case 'br':
          obj.width = Math.max(1, init.width + dWorldX)
          obj.height = Math.max(1, init.height + dWorldY)
          break
        case 'bl':
          obj.x = init.x + dWorldX
          obj.width = Math.max(1, init.width - dWorldX)
          obj.height = Math.max(1, init.height + dWorldY)
          break
        case 'tr':
          obj.y = init.y + dWorldY
          obj.width = Math.max(1, init.width + dWorldX)
          obj.height = Math.max(1, init.height - dWorldY)
          break
        case 'tl':
          obj.x = init.x + dWorldX
          obj.y = init.y + dWorldY
          obj.width = Math.max(1, init.width - dWorldX)
          obj.height = Math.max(1, init.height - dWorldY)
          break
        case 'mr':
          obj.width = Math.max(1, init.width + dWorldX)
          break
        case 'ml':
          obj.x = init.x + dWorldX
          obj.width = Math.max(1, init.width - dWorldX)
          break
        case 'bc':
          obj.height = Math.max(1, init.height + dWorldY)
          break
        case 'tc':
          obj.y = init.y + dWorldY
          obj.height = Math.max(1, init.height - dWorldY)
          break
      }
    }
  }

  private _finishMarquee(): void {
    if (!this._dragState || !this._stage) return
    const { marqueeX, marqueeY, marqueeW, marqueeH } = this._dragState
    if (marqueeX === undefined || marqueeY === undefined || !marqueeW || !marqueeH) return
    if (marqueeW < 4 && marqueeH < 4) return // too small — ignore

    const mLeft = marqueeX
    const mTop = marqueeY
    const mRight = marqueeX + marqueeW
    const mBottom = marqueeY + marqueeH

    for (const layer of this._stage.layers) {
      for (const obj of layer.objects) {
        if (!obj.visible || obj.locked) continue
        const bb = obj.getWorldBoundingBox()
        // Intersects check — both marquee and bb are in world space
        const intersects =
          mLeft < bb.right && mRight > bb.left && mTop < bb.bottom && mBottom > bb.top
        if (intersects) {
          this._selected.add(obj)
        }
      }
    }
    this._emitChange()
  }

  // ---------------------------------------------------------------------------
  // Scene hit testing
  // ---------------------------------------------------------------------------

  private _hitTestScene(worldX: number, worldY: number): BaseObject | null {
    if (!this._stage) return null
    const layers = this._stage.layers
    for (let i = layers.length - 1; i >= 0; i--) {
      const hit = layers[i]!.hitTest(worldX, worldY)
      if (hit) return hit
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // Handle hit testing (screen space)
  // ---------------------------------------------------------------------------

  private _getHandles(): Handle[] {
    if (this._selected.size === 0 || !this._stage) return []
    const bb = this._getSelectionBB()
    if (!bb) return []
    const { x, y, r, b } = bb
    const cx = (x + r) / 2
    const cy = (y + b) / 2
    // Rotation handle offset in world units so it stays at a fixed screen-pixel distance
    const invScale = 1 / this._stage.viewport.scale
    const rotOffset = ROT_HANDLE_OFFSET * invScale
    return [
      { id: 'tl', x, y },
      { id: 'tc', x: cx, y },
      { id: 'tr', x: r, y },
      { id: 'ml', x, y: cy },
      { id: 'mr', x: r, y: cy },
      { id: 'bl', x, y: b },
      { id: 'bc', x: cx, y: b },
      { id: 'br', x: r, y: b },
      { id: 'rot', x: cx, y: y - rotOffset },
    ]
  }

  private _hitTestHandle(screenX: number, screenY: number): HandleId | null {
    if (!this._stage) return null
    // Convert screen click to world space to compare with world-space handle positions
    const world = this._stage.viewport.screenToWorld(screenX, screenY)
    const threshold = (HANDLE_SIZE + 2) / this._stage.viewport.scale
    for (const handle of this._getHandles()) {
      if (Math.abs(world.x - handle.x) <= threshold && Math.abs(world.y - handle.y) <= threshold) {
        return handle.id
      }
    }
    return null
  }

  /** Returns the combined world-space bounding box of all selected objects. */
  private _getSelectionBB(): { x: number; y: number; r: number; b: number } | null {
    if (!this._stage || this._selected.size === 0) return null

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity

    for (const obj of this._selected) {
      const bb = obj.getWorldBoundingBox()
      if (bb.x < minX) minX = bb.x
      if (bb.y < minY) minY = bb.y
      if (bb.right > maxX) maxX = bb.right
      if (bb.bottom > maxY) maxY = bb.bottom
    }

    if (minX === Infinity) return null
    return { x: minX, y: minY, r: maxX, b: maxY }
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /** Create all cached paint objects on first call. Safe to call every frame. */
  private _ensurePaints(ck: SelectionCK): void {
    if (this._handleFillPaint !== null) return // already initialised
    const color = this._options.selectionColor

    this._handleFillPaint = new ck.Paint()
    this._handleFillPaint.setStyle(ck.PaintStyle.Fill)
    this._handleFillPaint.setColor(ck.Color4f(1, 1, 1, 1))
    this._handleFillPaint.setAntiAlias(true)

    this._handleStrokePaint = new ck.Paint()
    this._handleStrokePaint.setStyle(ck.PaintStyle.Stroke)
    this._handleStrokePaint.setColor(ck.Color4f(color.r, color.g, color.b, color.a))
    this._handleStrokePaint.setAntiAlias(true)

    this._borderPaint = new ck.Paint()
    this._borderPaint.setStyle(ck.PaintStyle.Stroke)
    this._borderPaint.setColor(ck.Color4f(color.r, color.g, color.b, color.a))
    this._borderPaint.setAntiAlias(true)

    this._rotLinePaint = new ck.Paint()
    this._rotLinePaint.setStyle(ck.PaintStyle.Stroke)
    this._rotLinePaint.setColor(ck.Color4f(color.r, color.g, color.b, color.a))
    this._rotLinePaint.setAntiAlias(true)

    this._marqueePaint = new ck.Paint()
    this._marqueePaint.setStyle(ck.PaintStyle.Stroke)
    this._marqueePaint.setColor(ck.Color4f(color.r, color.g, color.b, 0.8))
    this._marqueePaint.setAntiAlias(true)
  }

  /**
   * Update all scale-dependent paint properties. Called only when viewport
   * scale changes, not on every frame. Path effects are WASM objects; this is
   * the only place they are (re)allocated, keeping per-frame allocs at zero.
   */
  private _updateScaleDependentPaints(ck: SelectionCK, invScale: number): void {
    this._borderPaint!.setStrokeWidth(1.5 * invScale)
    this._rotLinePaint!.setStrokeWidth(1.5 * invScale)
    this._handleStrokePaint!.setStrokeWidth(1.5 * invScale)
    this._marqueePaint!.setStrokeWidth(invScale)

    if (ck.PathEffect) {
      this._borderDashEffect?.delete()
      this._borderDashEffect = ck.PathEffect.MakeDash([5 * invScale, 3 * invScale], 0)
      this._borderPaint!.setPathEffect(this._borderDashEffect)

      this._marqueeDashEffect?.delete()
      this._marqueeDashEffect = ck.PathEffect.MakeDash([4 * invScale, 4 * invScale], 0)
      this._marqueePaint!.setPathEffect(this._marqueeDashEffect)
    }
  }

  private _drawSelection(ctx: RenderContext): void {
    if (this._selected.size === 0 || !ctx.skCanvas || !ctx.canvasKit) return
    const ck = ctx.canvasKit as SelectionCK
    const canvas = ctx.skCanvas as SkCanvas
    const vp = ctx.viewport
    // invScale keeps stroke widths and handle sizes constant in screen pixels regardless of zoom
    const invScale = 1 / vp.scale

    this._ensurePaints(ck)

    // Rebuild scale-dependent stroke widths and path effects only when zoom changes.
    // Path effects are the only WASM allocations here; all paints are reused.
    if (invScale !== this._lastInvScale) {
      this._updateScaleDependentPaints(ck, invScale)
      this._lastInvScale = invScale
    }

    // Draw selection border for each selected object in world space
    for (const obj of this._selected) {
      const bb = obj.getWorldBoundingBox()
      canvas.drawRect([bb.x, bb.y, bb.right, bb.bottom], this._borderPaint)
    }

    // Draw handles on combined world-space bounding box
    const bb = this._getSelectionBB()
    if (!bb) return

    const { x, y, r, b } = bb
    const cx = (x + r) / 2
    const rotOffset = ROT_HANDLE_OFFSET * invScale

    // Rotation handle line — from top-center to rotation handle position
    canvas.drawLine(cx, y, cx, y - rotOffset, this._rotLinePaint)

    const handles: Array<{ hx: number; hy: number; isRot: boolean }> = [
      { hx: x, hy: y, isRot: false },
      { hx: cx, hy: y, isRot: false },
      { hx: r, hy: y, isRot: false },
      { hx: x, hy: (y + b) / 2, isRot: false },
      { hx: r, hy: (y + b) / 2, isRot: false },
      { hx: x, hy: b, isRot: false },
      { hx: cx, hy: b, isRot: false },
      { hx: r, hy: b, isRot: false },
      { hx: cx, hy: y - rotOffset, isRot: true },
    ]

    // Handle sizes in world units so they appear at a fixed screen-pixel size
    const hs = (HANDLE_SIZE / 2) * invScale
    const circleR = (HANDLE_SIZE / 2) * invScale

    for (const { hx, hy, isRot } of handles) {
      if (isRot) {
        canvas.drawCircle(hx, hy, circleR, this._handleFillPaint)
        canvas.drawCircle(hx, hy, circleR, this._handleStrokePaint)
      } else {
        canvas.drawRect([hx - hs, hy - hs, hx + hs, hy + hs], this._handleFillPaint)
        canvas.drawRect([hx - hs, hy - hs, hx + hs, hy + hs], this._handleStrokePaint)
      }
    }

    // Draw marquee if active — marquee bounds are tracked in world space
    if (this._dragState?.type === 'marquee') {
      const { marqueeX, marqueeY, marqueeW, marqueeH } = this._dragState
      if (marqueeX !== undefined && marqueeW && marqueeH) {
        canvas.drawRect(
          [marqueeX, marqueeY!, marqueeX + marqueeW, marqueeY! + marqueeH],
          this._marqueePaint,
        )
      }
    }
  }
}
