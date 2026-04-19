import type { BoundingBox } from './math/BoundingBox.js'
import type { Layer } from './Layer.js'
import type { Viewport } from './Viewport.js'
import type { FontManager } from './FontManager.js'
import type { BaseObject } from './objects/BaseObject.js'
import type { Group } from './objects/Group.js'

/**
 * A function that deserializes a plain JSON object into a typed scene object.
 * Passed to {@link StageInterface.registerObject} to support custom object types in `loadJSON()`.
 */
export type ObjectDeserializer = (json: ObjectJSON) => BaseObject

// ---------------------------------------------------------------------------
// Minimal CanvasKit typing (NV-015)
// ---------------------------------------------------------------------------

/**
 * Minimal interface covering the CanvasKit surface used by core and official
 * plugins.  Avoids forcing every consumer to cast from `unknown`.
 *
 * The index signature allows access to any deeper API without additional casts,
 * so plugins that use niche CanvasKit features can still call them directly.
 */
export interface CanvasKitLike {
  // Construction
  Paint: new () => { setColor(c: Float32Array): void; setStyle(s: unknown): void; setStrokeWidth(w: number): void; setAntiAlias(aa: boolean): void; setStrokeCap(cap: unknown): void; setStrokeJoin(join: unknown): void; setStrokeMiter(limit: number): void; setShader(shader: unknown | null): void; setAlphaf(alpha: number): void; setImageFilter(filter: unknown): void; delete(): void; [k: string]: unknown }
  Color4f(r: number, g: number, b: number, a: number): Float32Array
  LTRBRect(l: number, t: number, r: number, b: number): Float32Array

  // Enums
  PaintStyle: { Fill: unknown; Stroke: unknown }
  StrokeCap?: { Butt: unknown; Round: unknown; Square: unknown }
  StrokeJoin?: { Miter: unknown; Round: unknown; Bevel: unknown }
  TileMode?: { Clamp: unknown; [k: string]: unknown }
  ColorSpace?: { SRGB: unknown; [k: string]: unknown }

  // Factories
  Shader?: {
    MakeLinearGradient(start: number[], end: number[], colors: Float32Array[], positions: number[] | null, mode: unknown): unknown
    MakeRadialGradient(center: number[], radius: number, colors: Float32Array[], positions: number[] | null, mode: unknown): unknown
  }
  PathEffect?: { MakeDash(intervals: number[], phase?: number): unknown; [k: string]: unknown }
  ImageFilter?: {
    MakeDropShadow(dx: number, dy: number, sigmaX: number, sigmaY: number, color: Float32Array, input: unknown): unknown
    MakeBlur(sigmaX: number, sigmaY: number, tileMode: unknown, input: unknown): unknown
    MakeCompose(outer: unknown, inner: unknown): unknown
    [k: string]: unknown
  }

  // Surface / canvas
  MakeWebGLCanvasSurface?(canvas: HTMLCanvasElement, colorSpace?: unknown, opts?: unknown): unknown
  MakeImageFromEncoded?(data: Uint8Array): unknown

  // Allow arbitrary access for niche or newer APIs
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** Versioned JSON schema for a serialized scene graph. */
export interface SceneJSON {
  version: string
  layers: LayerJSON[]
}

export interface LayerJSON {
  id: string
  name: string
  visible: boolean
  locked: boolean
  objects: ObjectJSON[]
}

export interface ObjectJSON {
  type: string
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  scaleX: number
  scaleY: number
  skewX: number
  skewY: number
  opacity: number
  visible: boolean
  locked: boolean
  /** Custom ports override — only present when the object has non-default ports. */
  ports?: Port[]
  /** Visual effects — only present when non-empty. */
  effects?: Effect[]
  [key: string]: unknown
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Context passed to every object's render() call.
 * The `skCanvas` and `canvasKit` fields are typed as `unknown` in core to avoid
 * a hard dependency on canvaskit-wasm. Object render() implementations cast them
 * to the appropriate CanvasKit types internally.
 */
export interface RenderContext {
  /** CanvasKit SkCanvas instance — cast to SkCanvas inside render() implementations. */
  skCanvas: unknown
  /** CanvasKit instance — used to create Paints, Paths, etc. inside render(). */
  canvasKit: CanvasKitLike
  /** FontManager for loading and retrieving typefaces for Text rendering. */
  fontManager: FontManager | null
  /** Device pixel ratio for HiDPI rendering. */
  pixelRatio: number
  /** Current viewport state. */
  viewport: ViewportState
  /** The stage — used by Connector to resolve object port positions at render time. */
  stage: StageInterface
}

// ---------------------------------------------------------------------------
// Viewport
// ---------------------------------------------------------------------------

export interface ViewportState {
  x: number
  y: number
  scale: number
  width: number
  height: number
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface PointerPosition {
  /** Position in screen (canvas pixel) space. */
  screen: { x: number; y: number }
  /** Position in world space (accounting for viewport pan/zoom). */
  world: { x: number; y: number }
}

export interface CanvasPointerEvent extends PointerPosition {
  originalEvent: PointerEvent | MouseEvent | TouchEvent
  stopped: boolean
  stopPropagation(): void
}

export interface CanvasWheelEvent extends PointerPosition {
  deltaX: number
  deltaY: number
  originalEvent: WheelEvent
}

/** All events that can be emitted on a BaseObject or Stage. */
export interface ObjectEventMap {
  click: CanvasPointerEvent
  dblclick: CanvasPointerEvent
  mousedown: CanvasPointerEvent
  mouseup: CanvasPointerEvent
  mousemove: CanvasPointerEvent
  mouseenter: CanvasPointerEvent
  mouseleave: CanvasPointerEvent
  dragstart: CanvasPointerEvent
  drag: CanvasPointerEvent
  dragend: CanvasPointerEvent
  tap: CanvasPointerEvent
  doubletap: CanvasPointerEvent
}

export interface ObjectMutationEvent {
  /** The object that changed */
  object: BaseObject
  /** The property that changed (e.g. 'x', 'y', 'width', 'rotation', etc.) */
  property: string
  /** The previous value before the change */
  oldValue: unknown
  /** The new value after the change */
  newValue: unknown
}

export interface StageEventMap extends ObjectEventMap {
  wheel: CanvasWheelEvent
  /** Fired after a render frame completes. */
  render: { timestamp: number }
  /** Fired when an object is added to any layer. */
  'object:added': { object: unknown }
  /** Fired when an object is removed from any layer. */
  'object:removed': { object: unknown }
  /** Fired when an object's property changes (position, size, rotation, etc.). */
  'object:mutated': ObjectMutationEvent
  // Plugin events — emitted by official plugins via stage.emit()
  /** Fired by SelectionPlugin when the selection changes. */
  'selection:change': { selected: unknown[] }
  /** Fired by SelectionPlugin when objects are deleted via keyboard. */
  'objects:deleted': { objects: unknown[] }
  /** Fired by HistoryPlugin when the undo/redo stack changes. */
  'history:change': { canUndo: boolean; canRedo: boolean }
  /** Fired by HistoryPlugin when checkpoint() is called. */
  'history:checkpoint': { label?: string }
  /**
   * Fired once when a `stage.batch()` call completes.
   * Contains all mutations that were coalesced. HistoryPlugin listens to this
   * event to record a single undo entry for the entire batch.
   */
  'batch:commit': { mutations: ObjectMutationEvent[] }
  /**
   * Fired when an object's z-order changes via bringToFront / sendToBack /
   * bringForward / sendBackward or Layer.moveTo().
   * HistoryPlugin listens to this to record undoable z-order commands.
   */
  'zorder:change': { object: BaseObject; layer: Layer; oldIndex: number; newIndex: number }
  /**
   * Fired by `stage.groupObjects()` when a new Group is created.
   * Contains the group, the layer it was added to, and the original objects
   * (with their pre-group layer assignments for undo purposes).
   */
  'group:created': { group: Group; layer: Layer; members: BaseObject[] }
  /**
   * Fired by `stage.ungroupObject()` when a Group is dissolved.
   * Contains the dissolved group, the layer its children were moved to, and
   * the children in their original order.
   */
  'group:dissolved': { group: Group; layer: Layer; members: BaseObject[] }
}

// ---------------------------------------------------------------------------
// Plugins
// ---------------------------------------------------------------------------

/**
 * A plugin adds optional capabilities to a Stage without modifying core.
 * Plugins must be fully reversible: `uninstall` must undo everything `install` did.
 */
export interface Plugin {
  /** Unique kebab-case identifier, e.g. "selection", "drag". */
  readonly name: string
  /** SemVer string. */
  readonly version: string
  /**
   * Called once when the plugin is added to a stage.
   * Should register event listeners, render passes, etc.
   */
  install(stage: StageInterface, options?: Record<string, unknown>): void
  /**
   * Called when the plugin is removed from a stage.
   * Must fully clean up all side effects from install().
   */
  uninstall(stage: StageInterface): void
}

// ---------------------------------------------------------------------------
// Effects
// ---------------------------------------------------------------------------

export interface DropShadowEffect {
  type: 'drop-shadow'
  offsetX: number
  offsetY: number
  /** Blur sigma (equal sigmaX / sigmaY for a circular shadow). */
  blur: number
  color: ColorRGBA
}

export interface BlurEffect {
  type: 'blur'
  /** Blur sigma radius applied equally on both axes. */
  radius: number
}

export type Effect = DropShadowEffect | BlurEffect

// ---------------------------------------------------------------------------
// Ports / anchor points
// ---------------------------------------------------------------------------

/**
 * A named attachment point on a BaseObject, used by Connector to snap endpoints
 * to specific positions on an object.
 *
 * `relX` and `relY` are in the object's local coordinate space, relative to the
 * object's local bounding box: 0 = left/top edge, 1 = right/bottom edge.
 * So `{ relX: 0.5, relY: 0 }` is the top-center of the object.
 */
export interface Port {
  /** Unique id within the object, e.g. "top", "right", "bottom", "left", "center". */
  id: string
  /** Position relative to object local bounds: 0 = left, 1 = right. */
  relX: number
  /** Position relative to object local bounds: 0 = top, 1 = bottom. */
  relY: number
}

// ---------------------------------------------------------------------------
// Fill & Stroke
// ---------------------------------------------------------------------------

export type ColorRGBA = { r: number; g: number; b: number; a: number }

export interface SolidFill {
  type: 'solid'
  color: ColorRGBA
}

export interface LinearGradientFill {
  type: 'linear-gradient'
  stops: Array<{ offset: number; color: ColorRGBA }>
  start: { x: number; y: number }
  end: { x: number; y: number }
}

export interface RadialGradientFill {
  type: 'radial-gradient'
  stops: Array<{ offset: number; color: ColorRGBA }>
  /** Center position relative to object bounds, 0–1. Default: { x: 0.5, y: 0.5 } */
  center: { x: number; y: number }
  /** Radius relative to the longer object dimension, 0–1. Default: 0.5 */
  radius: number
}

export type Fill = SolidFill | LinearGradientFill | RadialGradientFill

export type StrokeLineCap = 'butt' | 'round' | 'square'
export type StrokeLineJoin = 'miter' | 'round' | 'bevel'

/** Shape drawn at the start or end of a Line, Path, or Connector stroke. */
export type ArrowHeadStyle = 'none' | 'arrow' | 'filled-arrow' | 'circle' | 'diamond'

export interface StrokeStyle {
  color: ColorRGBA
  width: number
  cap?: StrokeLineCap
  join?: StrokeLineJoin
  dash?: number[]
  dashOffset?: number
  /** Arrowhead drawn at the stroke start point. Defaults to 'none'. */
  startArrow?: ArrowHeadStyle
  /** Arrowhead drawn at the stroke end point. Defaults to 'none'. */
  endArrow?: ArrowHeadStyle
}

// ---------------------------------------------------------------------------
// Minimal Stage interface for Plugin use (avoids circular imports)
// ---------------------------------------------------------------------------

/** Minimal interface that plugins interact with. Full Stage extends this. */
export interface StageInterface {
  readonly id: string
  readonly canvasKit: CanvasKitLike
  readonly layers: readonly Layer[]
  readonly viewport: Viewport
  readonly fonts: FontManager
  on<K extends keyof StageEventMap>(event: K, handler: (e: StageEventMap[K]) => void): void
  off<K extends keyof StageEventMap>(event: K, handler: (e: StageEventMap[K]) => void): void
  /** Emit a stage event. Used by plugins to fire events on the stage. */
  emit<K extends keyof StageEventMap>(event: K, data: StageEventMap[K]): void
  addRenderPass(pass: RenderPass): void
  removeRenderPass(pass: RenderPass): void
  getBoundingBox(): BoundingBox
  render(): void
  /** Mark the stage as needing a redraw. Call after mutating objects programmatically. */
  markDirty(): void
  resize(physicalWidth: number, physicalHeight: number): void
  /** Find all objects across all layers that match the predicate. */
  find(predicate: (obj: BaseObject) => boolean): BaseObject[]
  /** Find all objects of a specific type string (e.g. "Rect", "Circle"). */
  findByType(type: string): BaseObject[]
  /** Find an object by its id across all layers. Returns undefined if not found. */
  getObjectById(id: string): BaseObject | undefined
  /**
   * Register a custom object type for deserialization.
   * Once registered, `loadJSON()` will use the provided deserializer whenever
   * it encounters an object whose `type` field matches `typeName`.
   *
   * @example
   * ```ts
   * stage.registerObject('Node', (json) => NodeObject.fromJSON(json))
   * stage.loadJSON(savedScene)
   * ```
   */
  registerObject(typeName: string, deserializer: ObjectDeserializer): void
  /**
   * Return the Layer that contains `obj`, or null if not found in any layer.
   */
  getObjectLayer(obj: BaseObject): Layer | null
  /** Move the object to the front (highest z-order) within its layer. */
  bringToFront(obj: BaseObject): void
  /** Move the object to the back (lowest z-order) within its layer. */
  sendToBack(obj: BaseObject): void
  /** Move the object one step forward in z-order within its layer. */
  bringForward(obj: BaseObject): void
  /** Move the object one step backward in z-order within its layer. */
  sendBackward(obj: BaseObject): void
  /**
   * Group a set of objects into a new {@link Group}, preserving their world
   * positions. The group is placed at the bounding-box origin of the provided
   * objects and each child's local position is adjusted so its world position
   * does not change. Uses `batch()` internally — HistoryPlugin records one
   * undo entry.
   *
   * @param objects - Objects to group. All must be direct children of a layer
   *   (not already inside a group).
   * @param layerOrId - Layer to add the new group to. Defaults to the layer
   *   that contains the first object.
   * @throws If `objects` is empty or any object is not in a layer.
   */
  groupObjects(objects: BaseObject[], layerOrId?: Layer | string): Group
  /**
   * Dissolve a {@link Group}, moving its children back to the group's parent
   * layer while preserving their world positions. The group is removed from the
   * layer. Uses `batch()` internally — HistoryPlugin records one undo entry.
   *
   * @param group - The group to ungroup. Must be a direct child of a layer.
   * @throws If the group is not in any layer.
   * @returns The children that were moved to the layer (in original child order).
   */
  ungroupObject(group: Group): BaseObject[]
  /**
   * Coalesce multiple property mutations into a single `object:mutated` flush
   * and one `batch:commit` event.
   *
   * While `fn` is executing, individual `object:mutated` events are suppressed.
   * When `fn` returns, all collected mutations are emitted as individual
   * `object:mutated` events followed by a single `batch:commit` event.
   * HistoryPlugin uses `batch:commit` to record one undo entry for the whole batch.
   *
   * Batches can be nested — the flush happens only when the outermost batch exits.
   *
   * @example
   * ```ts
   * stage.batch(() => {
   *   obj.x = 100
   *   obj.y = 200
   *   obj.width = 300
   * })
   * // Fires three object:mutated events + one batch:commit event, not three separate flushes.
   * ```
   */
  batch(fn: () => void): void
}

// ---------------------------------------------------------------------------
// Render passes (for plugins)
// ---------------------------------------------------------------------------

export type RenderPassPhase = 'pre' | 'post'

export interface RenderPass {
  phase: RenderPassPhase
  /** Lower numbers render first within the same phase. */
  order?: number
  render(ctx: RenderContext): void
}
