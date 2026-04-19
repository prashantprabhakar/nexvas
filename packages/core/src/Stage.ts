import { Layer } from './Layer.js'
import { Viewport } from './Viewport.js'
import { EventSystem } from './EventSystem.js'
import { PluginRegistry } from './PluginRegistry.js'
import { FontManager } from './FontManager.js'
import { BoundingBox } from './math/BoundingBox.js'
import { Matrix3x3 } from './math/Matrix3x3.js'
import { Group } from './objects/Group.js'
import type { ViewportOptions } from './Viewport.js'
import type {
  CanvasKitLike,
  Plugin,
  RenderContext,
  RenderPass,
  SceneJSON,
  StageEventMap,
  StageInterface,
  ObjectDeserializer,
  ObjectMutationEvent,
} from './types.js'
import type { BaseObject } from './objects/BaseObject.js'

// ---------------------------------------------------------------------------
// Minimal CanvasKit interface — only what Stage needs at this level.
// Object render() implementations have their own more detailed local types.
// ---------------------------------------------------------------------------
interface SkSurface {
  getCanvas(): SkCanvas
  flush(): void
  dispose(): void
}

interface SkCanvas {
  clear(color: Float32Array): void
  save(): number
  restore(): void
  translate(dx: number, dy: number): void
  scale(sx: number, sy: number): void
}

interface MinimalCK {
  MakeWebGLCanvasSurface(
    canvas: HTMLCanvasElement,
    colorSpace?: unknown,
    opts?: unknown,
  ): SkSurface | null
  Color4f(r: number, g: number, b: number, a: number): Float32Array
  ColorSpace: { SRGB: unknown }
}

export interface StageOptions {
  /**
   * The HTML canvas element to render to.
   */
  canvas: HTMLCanvasElement
  /**
   * CanvasKit instance — result of `loadCanvasKit()` from @nexvas/renderer.
   */
  canvasKit: CanvasKitLike
  viewport?: ViewportOptions
  /**
   * Device pixel ratio. Defaults to window.devicePixelRatio.
   */
  pixelRatio?: number
}

export interface StartLoopOptions {
  /**
   * Wait for all fonts to finish loading before starting the render loop.
   * Defaults to `true`. When true, `startLoop()` returns a Promise that resolves
   * once fonts are ready and the loop is running — preventing Text objects from
   * rendering invisibly on the first frame.
   *
   * Set to `false` to start the loop immediately (fonts may still be loading).
   */
  waitForFonts?: boolean
}

/**
 * The root of NexVas. Owns the canvas element, layers, viewport,
 * event system, and plugin registry.
 *
 * @example
 * ```ts
 * const ck = await loadCanvasKit()
 * const stage = new Stage({ canvas, canvasKit: ck })
 * const layer = stage.addLayer()
 * layer.add(new Rect({ x: 10, y: 10, width: 100, height: 100, fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } } }))
 * await stage.startLoop()
 * ```
 */
export class Stage implements StageInterface {
  readonly id: string
  readonly canvas: HTMLCanvasElement
  readonly canvasKit: CanvasKitLike
  readonly viewport: Viewport
  readonly plugins: PluginRegistry
  readonly fonts: FontManager

  private _layers: Layer[] = []
  private _events: EventSystem
  private _renderPasses: RenderPass[] = []
  private _pixelRatio: number
  private _dirty = true
  private _rafId: number | null = null
  private _destroyed = false
  private _surface: SkSurface | null = null
  private _boundContextLost: (e: Event) => void
  private _boundContextRestored: () => void
  private _objectRegistry = new Map<string, ObjectDeserializer>()
  private _batchDepth: number = 0
  private _pendingMutations: ObjectMutationEvent[] = []

  constructor(options: StageOptions) {
    this.id = `stage_${Date.now().toString(36)}`
    this.canvas = options.canvas
    this.canvasKit = options.canvasKit
    this._pixelRatio =
      options.pixelRatio ?? (typeof window !== 'undefined' ? window.devicePixelRatio : 1)

    this.viewport = new Viewport(options.viewport)
    this.viewport.setOnChange(() => this.markDirty())
    this._events = new EventSystem(this.canvas, this.viewport, () => this._layers)
    this.plugins = new PluginRegistry(this)
    this.fonts = new FontManager()
    this.fonts.init(options.canvasKit)
    this.fonts.setOnFontLoaded(() => this.markDirty())

    this._syncCanvasSize()

    // Create the CanvasKit WebGL surface.
    const ck = options.canvasKit as MinimalCK
    const surface = ck.MakeWebGLCanvasSurface(this.canvas, ck.ColorSpace.SRGB)
    if (!surface) {
      throw new Error(
        '[nexvas:stage] Failed to create CanvasKit WebGL surface. ' +
          'Ensure WebGL2 is available and the canvas element is attached to the DOM.',
      )
    }
    this._surface = surface

    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onResize)
    }

    this._boundContextLost = this._onContextLost.bind(this)
    this._boundContextRestored = this._onContextRestored.bind(this)
    this.canvas.addEventListener('webglcontextlost', this._boundContextLost)
    this.canvas.addEventListener('webglcontextrestored', this._boundContextRestored)
  }

  // ---------------------------------------------------------------------------
  // Layers
  // ---------------------------------------------------------------------------

  addLayer(options?: ConstructorParameters<typeof Layer>[0]): Layer {
    const layer = new Layer(options)
    layer.setObjectMutationHandler((type, obj) => {
      this._events.emitStage(
        type === 'added' ? 'object:added' : 'object:removed',
        { object: obj },
      )
    })
    layer.setPropertyMutationHandler((obj, property, oldValue, newValue) => {
      this._handlePropertyMutation({ object: obj, property, oldValue, newValue })
    })
    this._layers.push(layer)
    this.markDirty()
    return layer
  }

  removeLayer(layer: Layer): void {
    const i = this._layers.indexOf(layer)
    if (i !== -1) {
      layer.setObjectMutationHandler(null)
      this._layers.splice(i, 1)
      this.markDirty()
    }
  }

  get layers(): readonly Layer[] {
    return this._layers
  }

  /** Find any object by ID across all layers. */
  getObjectById(id: string): BaseObject | undefined {
    for (const layer of this._layers) {
      const found = layer.getById(id)
      if (found !== undefined) return found
    }
    return undefined
  }

  /**
   * Find all objects across all layers that match the predicate.
   */
  find(predicate: (obj: BaseObject) => boolean): BaseObject[] {
    const results: BaseObject[] = []
    for (const layer of this._layers) {
      for (const obj of layer.objects) {
        if (predicate(obj)) results.push(obj)
      }
    }
    return results
  }

  /**
   * Find all objects of a specific type string (e.g. "Rect", "Circle").
   */
  findByType(type: string): BaseObject[] {
    return this.find((obj) => obj.getType() === type)
  }

  // ---------------------------------------------------------------------------
  // Plugin convenience methods (implements StageInterface)
  // ---------------------------------------------------------------------------

  use(plugin: Plugin, options?: Record<string, unknown>): this {
    this.plugins.install(plugin, options)
    return this
  }

  /** Uninstall a plugin by its name or instance. */
  unuse(pluginOrName: Plugin | string): this {
    const name = typeof pluginOrName === 'string' ? pluginOrName : pluginOrName.name
    this.plugins.uninstall(name)
    return this
  }

  on<K extends keyof StageEventMap>(event: K, handler: (e: StageEventMap[K]) => void): void {
    this._events.on(event, handler)
  }

  off<K extends keyof StageEventMap>(event: K, handler: (e: StageEventMap[K]) => void): void {
    this._events.off(event, handler)
  }

  emit<K extends keyof StageEventMap>(event: K, data: StageEventMap[K]): void {
    this._events.emitStage(event, data)
  }

  batch(fn: () => void): void {
    this._batchDepth++
    try {
      fn()
    } finally {
      this._batchDepth--
      if (this._batchDepth === 0 && this._pendingMutations.length > 0) {
        const mutations = this._pendingMutations.splice(0)
        for (const m of mutations) {
          this._events.emitStage('object:mutated', m)
        }
        this._events.emitStage('batch:commit', { mutations })
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Z-order
  // ---------------------------------------------------------------------------

  getObjectLayer(obj: BaseObject): Layer | null {
    for (const layer of this._layers) {
      if (layer.objects.includes(obj)) return layer
    }
    return null
  }

  bringToFront(obj: BaseObject): void {
    const layer = this.getObjectLayer(obj)
    if (!layer) return
    const oldIndex = (layer.objects as BaseObject[]).indexOf(obj)
    layer.moveToTop(obj)
    const newIndex = (layer.objects as BaseObject[]).indexOf(obj)
    if (oldIndex !== newIndex) {
      this._events.emitStage('zorder:change', { object: obj, layer, oldIndex, newIndex })
      this.markDirty()
    }
  }

  sendToBack(obj: BaseObject): void {
    const layer = this.getObjectLayer(obj)
    if (!layer) return
    const oldIndex = (layer.objects as BaseObject[]).indexOf(obj)
    layer.moveToBottom(obj)
    const newIndex = (layer.objects as BaseObject[]).indexOf(obj)
    if (oldIndex !== newIndex) {
      this._events.emitStage('zorder:change', { object: obj, layer, oldIndex, newIndex })
      this.markDirty()
    }
  }

  bringForward(obj: BaseObject): void {
    const layer = this.getObjectLayer(obj)
    if (!layer) return
    const oldIndex = (layer.objects as BaseObject[]).indexOf(obj)
    layer.moveUp(obj)
    const newIndex = (layer.objects as BaseObject[]).indexOf(obj)
    if (oldIndex !== newIndex) {
      this._events.emitStage('zorder:change', { object: obj, layer, oldIndex, newIndex })
      this.markDirty()
    }
  }

  sendBackward(obj: BaseObject): void {
    const layer = this.getObjectLayer(obj)
    if (!layer) return
    const oldIndex = (layer.objects as BaseObject[]).indexOf(obj)
    layer.moveDown(obj)
    const newIndex = (layer.objects as BaseObject[]).indexOf(obj)
    if (oldIndex !== newIndex) {
      this._events.emitStage('zorder:change', { object: obj, layer, oldIndex, newIndex })
      this.markDirty()
    }
  }

  // ---------------------------------------------------------------------------
  // Group / Ungroup
  // ---------------------------------------------------------------------------

  groupObjects(objects: BaseObject[], layerOrId?: Layer | string): Group {
    if (objects.length === 0) {
      throw new Error('[nexvas:stage] groupObjects: objects array must not be empty')
    }

    // Resolve target layer
    let targetLayer: Layer | null = null
    if (layerOrId instanceof Layer) {
      targetLayer = layerOrId
    } else if (typeof layerOrId === 'string') {
      targetLayer = this._layers.find((l) => l.id === layerOrId) ?? null
      if (!targetLayer) {
        throw new Error(`[nexvas:stage] groupObjects: layer "${layerOrId}" not found`)
      }
    } else {
      targetLayer = this.getObjectLayer(objects[0]!)
      if (!targetLayer) {
        throw new Error('[nexvas:stage] groupObjects: first object is not in any layer')
      }
    }

    // Validate all objects are in layers (not already in groups)
    for (const obj of objects) {
      const objLayer = this.getObjectLayer(obj)
      if (!objLayer) {
        throw new Error(
          `[nexvas:stage] groupObjects: object "${obj.id}" is not a direct child of any layer`,
        )
      }
    }

    // Compute bounding box union in world space to determine group origin
    let unionBox: BoundingBox | null = null
    for (const obj of objects) {
      const bb = obj.getWorldBoundingBox()
      unionBox = unionBox === null ? bb : unionBox.union(bb)
    }
    const box = unionBox!

    const group = new Group({ x: box.x, y: box.y, width: box.width, height: box.height })

    this.batch(() => {
      for (const obj of objects) {
        const objLayer = this.getObjectLayer(obj)!
        objLayer.remove(obj)
        // Shift into group-local space (group has no rotation/scale, just translation)
        obj.x -= group.x
        obj.y -= group.y
        group.add(obj)
      }
      targetLayer!.add(group)
    })

    this._events.emitStage('group:created', { group, layer: targetLayer, members: objects })
    this.markDirty()
    return group
  }

  ungroupObject(group: Group): BaseObject[] {
    const layer = this.getObjectLayer(group)
    if (!layer) {
      throw new Error('[nexvas:stage] ungroupObject: group is not in any layer')
    }

    const children = [...group.children] as BaseObject[]
    const groupWorldTransform = group.getWorldTransform()

    // Pre-compute new world transforms before any structural changes
    const newTransforms = children.map((child) => {
      const composed = groupWorldTransform.multiply(child.getLocalTransform())
      return this._decomposeMatrix(composed)
    })

    this.batch(() => {
      for (let i = 0; i < children.length; i++) {
        const child = children[i]!
        const t = newTransforms[i]!
        group.remove(child)
        child.x = t.x
        child.y = t.y
        child.rotation = t.rotation
        child.scaleX = t.scaleX
        child.scaleY = t.scaleY
        layer.add(child)
      }
    })

    layer.remove(group)
    this._events.emitStage('group:dissolved', { group, layer, members: children })
    this.markDirty()
    return children
  }

  /**
   * Decompose a TRS matrix into translation, rotation (degrees), and scale
   * components. Assumes the matrix has the form T * R * S with no shear.
   */
  private _decomposeMatrix(
    m: Matrix3x3,
  ): { x: number; y: number; rotation: number; scaleX: number; scaleY: number } {
    const v = m.values
    return {
      x: v[2],
      y: v[5],
      rotation: (Math.atan2(v[3], v[0]) * 180) / Math.PI,
      scaleX: Math.sqrt(v[0] * v[0] + v[3] * v[3]),
      scaleY: Math.sqrt(v[1] * v[1] + v[4] * v[4]),
    }
  }

  private _handlePropertyMutation(event: ObjectMutationEvent): void {
    if (this._batchDepth > 0) {
      this._pendingMutations.push(event)
    } else {
      this._events.emitStage('object:mutated', event)
    }
  }

  addRenderPass(pass: RenderPass): void {
    this._renderPasses.push(pass)
    this._renderPasses.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }

  removeRenderPass(pass: RenderPass): void {
    const i = this._renderPasses.indexOf(pass)
    if (i !== -1) this._renderPasses.splice(i, 1)
  }

  getBoundingBox(): BoundingBox {
    const boxes = this._layers
      .flatMap((l) => l.objects)
      .filter((o) => o.visible)
      .map((o) => o.getWorldBoundingBox())
    if (boxes.length === 0) return new BoundingBox(0, 0, 0, 0)
    return boxes.reduce((acc, box) => acc.union(box))
  }

  // ---------------------------------------------------------------------------
  // Resize
  // ---------------------------------------------------------------------------

  /**
   * Notify the stage that the canvas has been resized.
   * Pass the new physical pixel dimensions (canvas.width / canvas.height).
   * The stage recreates the WebGL surface and updates the viewport.
   *
   * @example
   * ```ts
   * window.addEventListener('resize', () => {
   *   canvas.width = Math.floor(canvas.offsetWidth * devicePixelRatio)
   *   canvas.height = Math.floor(canvas.offsetHeight * devicePixelRatio)
   *   stage.resize(canvas.width, canvas.height)
   * })
   * ```
   */
  resize(physicalWidth: number, physicalHeight: number): void {
    if (this._destroyed) return
    // Update viewport in CSS pixels
    this.viewport.setSize(physicalWidth / this._pixelRatio, physicalHeight / this._pixelRatio)
    // Invalidate cached canvas rect so event coordinates are recalculated after resize
    this._events.invalidateRect()
    // Recreate the CanvasKit surface — it is invalidated when canvas dimensions change
    if (this._surface) {
      this._surface.dispose()
      this._surface = null
    }
    const ck = this.canvasKit as MinimalCK
    const surface = ck.MakeWebGLCanvasSurface(this.canvas, ck.ColorSpace.SRGB)
    if (surface) {
      this._surface = surface
    } else {
      console.error('[nexvas:stage] Failed to recreate WebGL surface after resize')
    }
    this.markDirty()
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  /** Mark the stage as needing a redraw. Called automatically on mutations. */
  markDirty(): void {
    this._dirty = true
  }

  /**
   * Render one frame synchronously. Uses the CanvasKit surface to draw the full
   * scene graph. In loop mode this is called automatically; calling it directly
   * is useful for static or test rendering.
   */
  render(): void {
    if (this._destroyed || this._surface === null) return
    this._dirty = false

    const ck = this.canvasKit as MinimalCK
    const skCanvas = this._surface.getCanvas()
    const vp = this.viewport.getState()

    // Clear to transparent
    skCanvas.clear(ck.Color4f(0, 0, 0, 0))

    // Apply DPR scaling first so the entire scene is in CSS-pixel space.
    // EventSystem converts DOM events using CSS pixels, so all world coordinates
    // are CSS-pixel based. Scaling by pixelRatio maps CSS→physical pixels correctly.
    skCanvas.save()
    skCanvas.scale(this._pixelRatio, this._pixelRatio)
    skCanvas.translate(vp.x, vp.y)
    skCanvas.scale(vp.scale, vp.scale)

    const ctx: RenderContext = {
      skCanvas,
      canvasKit: this.canvasKit,
      fontManager: this.fonts,
      pixelRatio: this._pixelRatio,
      viewport: vp,
      stage: this,
    }

    // Pre-render passes (e.g. grid background)
    for (const pass of this._renderPasses) {
      if (pass.phase === 'pre') pass.render(ctx)
    }

    // Main scene — layers back to front
    for (const layer of this._layers) {
      layer.render(ctx)
    }

    // Post-render passes (e.g. selection handles, guides)
    for (const pass of this._renderPasses) {
      if (pass.phase === 'post') pass.render(ctx)
    }

    skCanvas.restore()
    this._surface.flush()

    this._events.emitStage('render', { timestamp: performance.now() })
  }

  /**
   * Start a requestAnimationFrame render loop.
   * The loop skips frames where nothing changed (dirty flag).
   *
   * By default waits for all fonts to finish loading before starting, so that
   * Text objects render correctly on the first frame. Pass `{ waitForFonts: false }`
   * to start immediately without waiting.
   *
   * @example
   * ```ts
   * // Recommended — fonts are guaranteed ready on first render:
   * await stage.startLoop()
   *
   * // Opt out of waiting if you know fonts are already loaded:
   * stage.startLoop({ waitForFonts: false })
   * ```
   */
  async startLoop(options?: StartLoopOptions): Promise<void> {
    if (options?.waitForFonts !== false) {
      await this.fonts.waitForReady()
    }
    if (this._rafId !== null) return
    const loop = (): void => {
      if (this._destroyed) return
      if (this._dirty) this.render()
      this._rafId = requestAnimationFrame(loop)
    }
    this._rafId = requestAnimationFrame(loop)
  }

  stopLoop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  /**
   * Register a custom object type for deserialization.
   * Once registered, `loadJSON()` will call `deserializer` whenever it encounters
   * an object whose `type` field equals `typeName`.
   *
   * Must be called before `loadJSON()` for the registration to take effect.
   * Registering the same `typeName` twice replaces the previous deserializer.
   *
   * @example
   * ```ts
   * stage.registerObject('Node', (json) => NodeObject.fromJSON(json))
   * stage.loadJSON(savedScene)
   * ```
   */
  registerObject(typeName: string, deserializer: ObjectDeserializer): void {
    this._objectRegistry.set(typeName, deserializer)
  }

  toJSON(): SceneJSON {
    return {
      version: '1.0.0',
      layers: this._layers.map((l) => l.toJSON()),
    }
  }

  /**
   * Replace the current scene with the one described by `json`.
   * All existing layers and objects are removed before loading.
   *
   * @throws If the JSON schema version is not recognized.
   */
  loadJSON(json: SceneJSON): void {
    if (!json.version.startsWith('1.')) {
      throw new Error(
        `[nexvas:stage] loadJSON: unsupported schema version "${json.version}". Expected "1.x".`,
      )
    }
    // Remove all existing layers
    for (const layer of [...this._layers]) {
      this.removeLayer(layer)
    }
    for (const layerJson of json.layers) {
      const layer = Layer.fromJSON(layerJson, this._objectRegistry)
      this._layers.push(layer)
    }
    this.markDirty()
  }

  // ---------------------------------------------------------------------------
  // Resize handling
  // ---------------------------------------------------------------------------

  private _onContextLost(e: Event): void {
    // Prevent the browser from discarding the context before we can handle restoration.
    e.preventDefault()
    this._surface?.dispose()
    this._surface = null
  }

  private _onContextRestored(): void {
    const ck = this.canvasKit as MinimalCK
    const surface = ck.MakeWebGLCanvasSurface(this.canvas, ck.ColorSpace.SRGB)
    if (surface) {
      this._surface = surface
      this.markDirty()
    }
  }

  private _onResize = (): void => {
    this._syncCanvasSize()
    this.markDirty()
  }

  private _syncCanvasSize(): void {
    const { canvas, _pixelRatio: dpr } = this
    const cssWidth = canvas.clientWidth || canvas.width
    const cssHeight = canvas.clientHeight || canvas.height
    canvas.width = Math.round(cssWidth * dpr)
    canvas.height = Math.round(cssHeight * dpr)
    this.viewport.setSize(cssWidth, cssHeight)
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    if (this._destroyed) return
    this._destroyed = true
    this.stopLoop()
    this.plugins.destroyAll()
    this._events.destroy()
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onResize)
    }
    this.canvas.removeEventListener('webglcontextlost', this._boundContextLost)
    this.canvas.removeEventListener('webglcontextrestored', this._boundContextRestored)
    for (const layer of this._layers) {
      layer.setObjectMutationHandler(null)
      layer.clear()
    }
    this._layers = []
    this._surface?.dispose()
    this._surface = null
  }
}
