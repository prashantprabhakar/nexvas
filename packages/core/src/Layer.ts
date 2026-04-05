import type { BaseObject } from './objects/BaseObject.js'
import { Group } from './objects/Group.js'
import { objectFromJSON } from './objects/objectFromJSON.js'
import { BoundingBox } from './math/BoundingBox.js'
import type { RenderContext, LayerJSON } from './types.js'

/**
 * A named grouping within the Stage. Layers control render order.
 * Internally a Layer is a flat list of objects (not a Group), but shares
 * the same hit-testing and rendering traversal logic.
 */
export class Layer {
  readonly id: string
  name: string
  visible: boolean
  locked: boolean

  private _objects: BaseObject[] = []
  private _onObjectMutation: ((type: 'added' | 'removed', obj: BaseObject) => void) | null = null

  constructor(options: { id?: string; name?: string; visible?: boolean; locked?: boolean } = {}) {
    this.id = options.id ?? `layer_${Date.now().toString(36)}`
    this.name = options.name ?? 'Layer'
    this.visible = options.visible ?? true
    this.locked = options.locked ?? false
  }

  get objects(): readonly BaseObject[] {
    return this._objects
  }

  // ---------------------------------------------------------------------------
  // Object management
  // ---------------------------------------------------------------------------

  /**
   * Register a callback invoked when objects are added to or removed from this layer.
   * Used internally by Stage to emit `object:added` / `object:removed` stage events.
   * @internal
   */
  setObjectMutationHandler(
    fn: ((type: 'added' | 'removed', obj: BaseObject) => void) | null,
  ): void {
    this._onObjectMutation = fn
  }

  add(object: BaseObject): this {
    if (object.parent !== null) {
      throw new Error(`Object "${object.id}" already has a parent. Remove it first.`)
    }
    this._objects.push(object)
    this._onObjectMutation?.('added', object)
    return this
  }

  remove(object: BaseObject): this {
    const index = this._objects.indexOf(object)
    if (index === -1) return this
    this._objects.splice(index, 1)
    object.parent = null
    this._onObjectMutation?.('removed', object)
    return this
  }

  clear(): this {
    for (const obj of this._objects) {
      obj.destroy()
      this._onObjectMutation?.('removed', obj)
    }
    this._objects = []
    return this
  }

  /**
   * Remove an object from the layer. Throws if the object is not in this layer.
   * Use `remove()` for a silent no-op if the object might not be present.
   */
  strictRemove(object: BaseObject): this {
    const index = this._objects.indexOf(object)
    if (index === -1) {
      throw new Error(
        `[nexvas:layer] strictRemove: object "${object.id}" is not in layer "${this.id}".`,
      )
    }
    this._objects.splice(index, 1)
    object.parent = null
    this._onObjectMutation?.('removed', object)
    return this
  }

  getById(id: string): BaseObject | undefined {
    for (const obj of this._objects) {
      if (obj.id === id) return obj
      if (obj instanceof Group) {
        const found = obj.getById(id)
        if (found !== undefined) return found
      }
    }
    return undefined
  }

  // ---------------------------------------------------------------------------
  // Z-order
  // ---------------------------------------------------------------------------

  moveUp(object: BaseObject): void {
    const i = this._objects.indexOf(object)
    if (i < this._objects.length - 1) {
      this._objects.splice(i, 1)
      this._objects.splice(i + 1, 0, object)
    }
  }

  moveDown(object: BaseObject): void {
    const i = this._objects.indexOf(object)
    if (i > 0) {
      this._objects.splice(i, 1)
      this._objects.splice(i - 1, 0, object)
    }
  }

  moveToTop(object: BaseObject): void {
    const i = this._objects.indexOf(object)
    if (i !== -1) {
      this._objects.splice(i, 1)
      this._objects.push(object)
    }
  }

  moveToBottom(object: BaseObject): void {
    const i = this._objects.indexOf(object)
    if (i !== -1) {
      this._objects.splice(i, 1)
      this._objects.unshift(object)
    }
  }

  // ---------------------------------------------------------------------------
  // Hit testing
  // ---------------------------------------------------------------------------

  /** Returns the topmost object at the given world-space point, or null. */
  hitTest(worldX: number, worldY: number, tolerance = 4): BaseObject | null {
    if (!this.visible || this.locked) return null
    for (let i = this._objects.length - 1; i >= 0; i--) {
      const obj = this._objects[i]!
      if (obj instanceof Group) {
        const hit = obj.hitTestChild(worldX, worldY, tolerance)
        if (hit !== null) return hit
      } else if (obj.hitTest(worldX, worldY, obj.hitTolerance)) {
        return obj
      }
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render(ctx: RenderContext): void {
    if (!this.visible) return

    // Compute world-space viewport rect for culling.
    // When viewport dimensions are zero (e.g. test environments) culling is skipped.
    const vp = ctx.viewport
    let viewportWorld: BoundingBox | null = null
    if (vp.width > 0 && vp.height > 0) {
      const minX = -vp.x / vp.scale
      const minY = -vp.y / vp.scale
      viewportWorld = new BoundingBox(minX, minY, vp.width / vp.scale, vp.height / vp.scale)
    }

    for (const obj of this._objects) {
      if (!obj.visible) continue
      if (viewportWorld !== null && !obj.getWorldBoundingBox().intersects(viewportWorld)) continue
      try {
        obj.render(ctx)
      } catch (err) {
        console.error(`[nexvas:layer] Render error in object "${obj.id}" (${obj.getType()}):`, err)
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  toJSON(): LayerJSON {
    return {
      id: this.id,
      name: this.name,
      visible: this.visible,
      locked: this.locked,
      objects: this._objects.map((o) => o.toJSON()),
    }
  }

  /**
   * Restore a layer from its serialized JSON representation.
   * All built-in object types are supported. Unknown types throw.
   */
  static fromJSON(json: LayerJSON): Layer {
    const layer = new Layer({ id: json.id, name: json.name, visible: json.visible, locked: json.locked })
    for (const objJson of json.objects) {
      layer.add(objectFromJSON(objJson))
    }
    return layer
  }
}
