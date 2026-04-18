import { Matrix3x3 } from '../math/Matrix3x3.js'
import { BoundingBox } from '../math/BoundingBox.js'
import type { ObjectJSON, RenderContext, ObjectEventMap, Fill, StrokeStyle, Port, Effect } from '../types.js'

export type EventHandler<T> = (event: T) => void

function sanitizeFinite(val: unknown, fallback: number): number {
  const n = typeof val === 'number' ? val : fallback
  return Number.isFinite(n) ? n : fallback
}

let _nextId = 1
function generateId(): string {
  return `obj_${(_nextId++).toString(36)}`
}

export interface BaseObjectProps {
  id?: string
  name?: string
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  scaleX?: number
  scaleY?: number
  skewX?: number
  skewY?: number
  opacity?: number
  visible?: boolean
  locked?: boolean
  fill?: Fill | null
  stroke?: StrokeStyle | null
  /** Whether the object can be moved interactively. Default: true. */
  isMovable?: boolean
  /** Whether the object can be resized interactively. Default: true. */
  isResizable?: boolean
  /** Hit testing tolerance in world units. Default: 4. */
  hitTolerance?: number
  /**
   * Custom port overrides. When non-empty, replaces the default five ports
   * (top, right, bottom, left, center). Store only when you need non-standard
   * attachment points — the defaults are inferred and not persisted in JSON.
   */
  ports?: Port[]
  /**
   * Visual effects applied to this object via a save-layer composite.
   * Empty array = no effects. Supported: `'drop-shadow'`, `'blur'`.
   */
  effects?: Effect[]
}

/**
 * Abstract base class for all canvas objects.
 * Provides transforms, events, serialization, and hit testing scaffolding.
 */
export abstract class BaseObject {
  readonly id: string
  name: string

  // Spatial properties use getters/setters so mutations invalidate the bbox cache
  // and notify the Layer's spatial index. Backing fields are private.
  private _x: number = 0
  private _y: number = 0
  private _width: number = 0
  private _height: number = 0
  private _rotation: number = 0
  private _scaleX: number = 1
  private _scaleY: number = 1
  private _skewX: number = 0
  private _skewY: number = 0

  get x(): number { return this._x }
  set x(v: number) {
    const oldValue = this._x
    this._x = v
    if (oldValue !== v) this._mutationHandler?.('x', oldValue, v)
    this._localTransformCache = null
    this._invalidateBBox()
  }
  get y(): number { return this._y }
  set y(v: number) {
    const oldValue = this._y
    this._y = v
    if (oldValue !== v) this._mutationHandler?.('y', oldValue, v)
    this._localTransformCache = null
    this._invalidateBBox()
  }
  get width(): number { return this._width }
  set width(v: number) {
    const oldValue = this._width
    this._width = v
    if (oldValue !== v) this._mutationHandler?.('width', oldValue, v)
    this._invalidateBBox()
  }
  get height(): number { return this._height }
  set height(v: number) {
    const oldValue = this._height
    this._height = v
    if (oldValue !== v) this._mutationHandler?.('height', oldValue, v)
    this._invalidateBBox()
  }
  get rotation(): number { return this._rotation }
  set rotation(v: number) {
    const oldValue = this._rotation
    this._rotation = v
    if (oldValue !== v) this._mutationHandler?.('rotation', oldValue, v)
    this._localTransformCache = null
    this._invalidateBBox()
  }
  get scaleX(): number { return this._scaleX }
  set scaleX(v: number) {
    const oldValue = this._scaleX
    this._scaleX = v
    if (oldValue !== v) this._mutationHandler?.('scaleX', oldValue, v)
    this._localTransformCache = null
    this._invalidateBBox()
  }
  get scaleY(): number { return this._scaleY }
  set scaleY(v: number) {
    const oldValue = this._scaleY
    this._scaleY = v
    if (oldValue !== v) this._mutationHandler?.('scaleY', oldValue, v)
    this._localTransformCache = null
    this._invalidateBBox()
  }
  get skewX(): number { return this._skewX }
  set skewX(v: number) {
    const oldValue = this._skewX
    this._skewX = v
    if (oldValue !== v) this._mutationHandler?.('skewX', oldValue, v)
    this._localTransformCache = null
    this._invalidateBBox()
  }
  get skewY(): number { return this._skewY }
  set skewY(v: number) {
    const oldValue = this._skewY
    this._skewY = v
    if (oldValue !== v) this._mutationHandler?.('skewY', oldValue, v)
    this._localTransformCache = null
    this._invalidateBBox()
  }

  opacity: number
  visible: boolean
  locked: boolean
  fill: Fill | null
  stroke: StrokeStyle | null
  /** Whether the object can be moved interactively. Default: true. */
  isMovable: boolean
  /** Whether the object can be resized interactively. Default: true. */
  isResizable: boolean
  /** Hit testing tolerance in world units. Default: 4. */
  hitTolerance: number
  /**
   * Custom port overrides. When empty (the default), the five standard ports
   * (top, right, bottom, left, center) are used — computed from the bounding
   * box at query time and not persisted. Set to a non-empty array to replace
   * the defaults with your own named attachment points.
   */
  ports: Port[]
  /**
   * Visual effects composited via a save-layer. Applied in order; each effect
   * creates an image filter that is combined via `MakeCompose`. Empty = no effects.
   */
  effects: Effect[]

  /** Reference to the parent Group, set by Group.add(). */
  parent: BaseObject | null = null

  /** @internal Cached local transform matrix. Cleared on any spatial mutation. */
  _localTransformCache: Matrix3x3 | null = null
  /** @internal Cached world-space AABB. Cleared on any spatial mutation. */
  _worldBBoxCache: BoundingBox | null = null
  /** @internal Cached fill SkPaint — reused across frames, rebuilt only when fill/opacity changes. */
  _fillPaintCache: { paint: unknown; key: string } | null = null
  /** @internal Cached stroke SkPaint — reused across frames, rebuilt only when stroke/opacity changes. */
  _strokePaintCache: { paint: unknown; key: string } | null = null
  /** @internal Cached effect saveLayer paint — reused across frames, rebuilt only when effects change. */
  _effectPaintCache: { paint: unknown; key: string } | null = null
  /** @internal Set by Layer to receive notifications when this object's bbox changes. */
  private _onBBoxChange: (() => void) | null = null
  /** @internal Set by Layer to receive notifications when this object's properties change. */
  private _mutationHandler: ((property: string, oldValue: unknown, newValue: unknown) => void) | null = null

  private _eventHandlers = new Map<string, Set<EventHandler<unknown>>>()

  constructor(props: BaseObjectProps = {}) {
    this.id = props.id ?? generateId()
    this.name = props.name ?? ''
    // Set backing fields directly in constructor to avoid spurious invalidation callbacks
    // before the object is added to any layer.
    this._x = props.x ?? 0
    this._y = props.y ?? 0
    this._width = props.width ?? 0
    this._height = props.height ?? 0
    this._rotation = props.rotation ?? 0
    this._scaleX = props.scaleX ?? 1
    this._scaleY = props.scaleY ?? 1
    this._skewX = props.skewX ?? 0
    this._skewY = props.skewY ?? 0
    this.opacity = props.opacity ?? 1
    this.visible = props.visible ?? true
    this.locked = props.locked ?? false
    this.fill = props.fill ?? null
    this.stroke = props.stroke ?? null
    this.isMovable = props.isMovable ?? true
    this.isResizable = props.isResizable ?? true
    this.hitTolerance = props.hitTolerance ?? 4
    this.ports = props.ports ?? []
    this.effects = props.effects ?? []
  }

  // ---------------------------------------------------------------------------
  // Transform
  // ---------------------------------------------------------------------------

  /**
   * Local transform matrix: translate → rotate → scale → skew.
   * Computed from this object's own properties only.
   */
  getLocalTransform(): Matrix3x3 {
    if (this._localTransformCache !== null) return this._localTransformCache
    const rotRad = (this.rotation * Math.PI) / 180
    this._localTransformCache = Matrix3x3.translation(this.x, this.y)
      .multiply(Matrix3x3.rotation(rotRad))
      .multiply(Matrix3x3.scale(this.scaleX, this.scaleY))
    return this._localTransformCache
  }

  /**
   * World transform matrix — composes all ancestor transforms.
   * Walk up the parent chain and multiply matrices.
   */
  getWorldTransform(): Matrix3x3 {
    if (this.parent === null) return this.getLocalTransform()
    return this.parent.getWorldTransform().multiply(this.getLocalTransform())
  }

  /**
   * Returns the five default ports (top, right, bottom, left, center) derived
   * from the object's local bounding box. These are the ports used when
   * `this.ports` is empty.
   */
  getDefaultPorts(): Port[] {
    return [
      { id: 'top',    relX: 0.5, relY: 0 },
      { id: 'right',  relX: 1,   relY: 0.5 },
      { id: 'bottom', relX: 0.5, relY: 1 },
      { id: 'left',   relX: 0,   relY: 0.5 },
      { id: 'center', relX: 0.5, relY: 0.5 },
    ]
  }

  /**
   * Returns all ports on this object: custom ports when set, otherwise the five
   * default ports.
   */
  getPorts(): Port[] {
    return this.ports.length > 0 ? this.ports : this.getDefaultPorts()
  }

  /**
   * Returns the world-space position of the named port, or `null` if no port
   * with that id exists.
   *
   * The position is computed by mapping `(relX * localWidth, relY * localHeight)`
   * through the full world transform, so it correctly accounts for pan, zoom,
   * rotation, and scale on all ancestor groups.
   *
   * @param portId - The port id to look up, e.g. "top", "left", "center".
   */
  getPortWorldPosition(portId: string): { x: number; y: number } | null {
    const port = this.getPorts().find((p) => p.id === portId)
    if (port === undefined) return null
    const bbox = this.getLocalBoundingBox()
    const localX = bbox.x + port.relX * bbox.width
    const localY = bbox.y + port.relY * bbox.height
    const world = this.getWorldTransform().transformPoint(localX, localY)
    return { x: world.x, y: world.y }
  }

  /**
   * Axis-aligned bounding box in local (parent) space, **before** the world
   * transform is applied.
   *
   * Every concrete object type MUST implement this method. There is no default
   * because the shape of the bounding box is intrinsic to the object's geometry:
   *
   * - Rectangularly-positioned objects (Rect, Circle, Text, Image) return
   *   `new BoundingBox(0, 0, this.width, this.height)` — the transform (x, y,
   *   rotation, scale) is separate and applied by `getWorldBoundingBox()`.
   * - Geometry-defined objects (Line, Path, connectors) compute the bbox
   *   directly from their geometry data (endpoints, path `d` string, waypoints)
   *   without relying on `x / y / width / height`.
   *
   * Making this abstract guarantees that authors of new object types must
   * consciously declare how their bounding box is computed, preventing silent
   * 0×0 fallbacks that cause culling and hit-testing failures (NV-027).
   */
  abstract getLocalBoundingBox(): BoundingBox

  /**
   * Axis-aligned bounding box in world space. Result is cached; cleared on any spatial mutation.
   * Accounts for all ancestor transforms.
   */
  getWorldBoundingBox(): BoundingBox {
    if (this._worldBBoxCache !== null) return this._worldBBoxCache
    this._worldBBoxCache = this._computeWorldBoundingBox()
    return this._worldBBoxCache
  }

  /** Override in subclasses (e.g. Group) to change how the world bbox is computed. */
  protected _computeWorldBoundingBox(): BoundingBox {
    return this.getLocalBoundingBox().transform(this.getWorldTransform())
  }

  /**
   * Clears the cached world bbox, notifies the Layer's spatial index, and propagates
   * up the parent chain so ancestor Group entries are also refreshed.
   * @internal
   */
  protected _invalidateBBox(): void {
    this._worldBBoxCache = null
    this._onBBoxChange?.()
    this.parent?._invalidateBBox()
  }

  /**
   * Recursively clears world bbox caches without firing callbacks.
   * Called when an ancestor's transform changes and all descendant caches go stale.
   * @internal
   */
  _clearBBoxCacheDeep(): void {
    this._worldBBoxCache = null
  }

  /**
   * Register a callback invoked when this object's world bbox is invalidated.
   * Used internally by Layer to keep the spatial index in sync.
   * @internal
   */
  _setBBoxChangeCallback(fn: (() => void) | null): void {
    this._onBBoxChange = fn
  }

  /**
   * Register a callback invoked when this object's properties change.
   * Used internally by Layer to emit object:mutated events on the stage.
   * @internal
   */
  _setMutationHandler(fn: ((property: string, oldValue: unknown, newValue: unknown) => void) | null): void {
    this._mutationHandler = fn
  }

  // ---------------------------------------------------------------------------
  // Hit Testing
  // ---------------------------------------------------------------------------

  /**
   * Returns true if the given world-space point is inside this object.
   *
   * Default: bounding box check with configurable tolerance.
   * Override in subclasses for precise hit testing (e.g. Path uses Skia contains).
   *
   * @param worldX - X coordinate in world space
   * @param worldY - Y coordinate in world space
   * @param tolerance - Extra padding around the bounding box, in world units
   */
  hitTest(worldX: number, worldY: number, tolerance = 4): boolean {
    if (!this.visible) return false
    return this.getWorldBoundingBox().contains(worldX, worldY, tolerance)
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /**
   * Render this object onto the CanvasKit canvas.
   * @param ctx - Render context containing the SkCanvas and viewport state.
   */
  abstract render(ctx: RenderContext): void

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toJSON(): ObjectJSON {
    const json: ObjectJSON = {
      type: this.getType(),
      id: this.id,
      name: this.name,
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      rotation: this.rotation,
      scaleX: this.scaleX,
      scaleY: this.scaleY,
      skewX: this.skewX,
      skewY: this.skewY,
      opacity: this.opacity,
      visible: this.visible,
      locked: this.locked,
      fill: this.fill,
      stroke: this.stroke,
      isMovable: this.isMovable,
      isResizable: this.isResizable,
      hitTolerance: this.hitTolerance,
    }
    // Only persist custom ports — default ports are always inferred.
    if (this.ports.length > 0) json.ports = this.ports
    // Only persist effects when present.
    if (this.effects.length > 0) json.effects = this.effects
    return json
  }

  /** Subclasses return their type string, e.g. "Rect", "Circle". */
  abstract getType(): string

  protected applyBaseJSON(json: ObjectJSON): void {
    ;(this as { id: string }).id = json.id
    this.name = json.name
    this.x = sanitizeFinite(json.x, 0)
    this.y = sanitizeFinite(json.y, 0)
    this.width = Math.max(0, sanitizeFinite(json.width, 0))
    this.height = Math.max(0, sanitizeFinite(json.height, 0))
    this.rotation = sanitizeFinite(json.rotation, 0)
    this.scaleX = sanitizeFinite(json.scaleX, 1)
    this.scaleY = sanitizeFinite(json.scaleY, 1)
    this.skewX = sanitizeFinite(json.skewX, 0)
    this.skewY = sanitizeFinite(json.skewY, 0)
    this.opacity = Math.max(0, Math.min(1, sanitizeFinite(json.opacity, 1)))
    this.visible = json.visible
    this.locked = json.locked
    this.fill = (json.fill as Fill | null | undefined) ?? null
    this.stroke = (json.stroke as StrokeStyle | null | undefined) ?? null
    this.isMovable = typeof json['isMovable'] === 'boolean' ? json['isMovable'] : true
    this.isResizable = typeof json['isResizable'] === 'boolean' ? json['isResizable'] : true
    this.hitTolerance = sanitizeFinite(json['hitTolerance'], 4)
    this.ports = Array.isArray(json.ports) ? (json.ports as Port[]) : []
    this.effects = Array.isArray(json.effects) ? (json.effects as Effect[]) : []
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  on<K extends keyof ObjectEventMap>(event: K, handler: EventHandler<ObjectEventMap[K]>): this {
    if (!this._eventHandlers.has(event)) {
      this._eventHandlers.set(event, new Set())
    }
    this._eventHandlers.get(event)!.add(handler as EventHandler<unknown>)
    return this
  }

  off<K extends keyof ObjectEventMap>(event: K, handler: EventHandler<ObjectEventMap[K]>): this {
    this._eventHandlers.get(event)?.delete(handler as EventHandler<unknown>)
    return this
  }

  emit<K extends keyof ObjectEventMap>(event: K, data: ObjectEventMap[K]): void {
    this._eventHandlers.get(event)?.forEach((handler) => handler(data))
    // Bubble to parent if not stopped
    if (!('stopped' in data && data.stopped)) {
      this.parent?.emit(event, data)
    }
  }

  /** Remove all event listeners. */
  removeAllListeners(): void {
    this._eventHandlers.clear()
  }

  destroy(): void {
    this.removeAllListeners()
    this.parent = null
    ;(this._fillPaintCache?.paint as { delete(): void } | undefined)?.delete()
    ;(this._strokePaintCache?.paint as { delete(): void } | undefined)?.delete()
    ;(this._effectPaintCache?.paint as { delete(): void } | undefined)?.delete()
    this._fillPaintCache = null
    this._strokePaintCache = null
    this._effectPaintCache = null
  }
}
