import { BaseObject, type BaseObjectProps } from './BaseObject.js'
import { BoundingBox } from '../math/BoundingBox.js'
import { objectFromJSON } from './objectFromJSON.js'
import { makeEffectPaint, effectsCacheKey, type EffectCK, type SkPaint } from '../renderer/paint.js'
import type { RenderContext, ObjectJSON, ObjectEventMap, ObjectDeserializer } from '../types.js'

interface SkCanvas {
  save(): number
  restore(): void
  concat(matrix: ArrayLike<number>): void
  saveLayer(paint: unknown): number
  clipRect(rect: ArrayLike<number>, op: unknown, doAntiAlias: boolean): void
}

interface GroupCK {
  LTRBRect(l: number, t: number, r: number, b: number): Float32Array
  ClipOp: { Intersect: unknown }
}

export interface GroupProps extends BaseObjectProps {
  /** When true, children are clipped to the group's bounding box. Default: false. */
  clip?: boolean
}

/** Container for other objects. Transforms compose onto all children. */
export class Group extends BaseObject {
  /** When true, children are clipped to this group's local bounds. */
  clip: boolean
  private _children: BaseObject[] = []

  constructor(props: GroupProps = {}) {
    super(props)
    this.clip = props.clip ?? false
  }

  get children(): readonly BaseObject[] {
    return this._children
  }

  // ---------------------------------------------------------------------------
  // Child management
  // ---------------------------------------------------------------------------

  add(object: BaseObject): this {
    if (object.parent !== null) {
      throw new Error(`Object "${object.id}" already has a parent. Remove it first.`)
    }
    this._children.push(object)
    object.parent = this
    this._invalidateBBox()
    return this
  }

  remove(object: BaseObject): this {
    const index = this._children.indexOf(object)
    if (index === -1) return this
    this._children.splice(index, 1)
    object.parent = null
    this._invalidateBBox()
    return this
  }

  /** Remove all children, destroying their CanvasKit resources. */
  clear(): this {
    for (const child of this._children) {
      child.parent = null
      child.destroy()
    }
    this._children = []
    this._invalidateBBox()
    return this
  }

  getById(id: string): BaseObject | undefined {
    for (const child of this._children) {
      if (child.id === id) return child
      if (child instanceof Group) {
        const found = child.getById(id)
        if (found !== undefined) return found
      }
    }
    return undefined
  }

  // ---------------------------------------------------------------------------
  // Transform & bounds
  // ---------------------------------------------------------------------------

  /**
   * Local bounding box of this group: the union of all visible children's
   * bounding boxes expressed in the group's own coordinate space.
   *
   * Unlike `getWorldBoundingBox()` (which operates in world space), this
   * method applies only each child's local transform — leaving the group's
   * own x/y/rotation out of the result. That keeps the contract consistent
   * with how all other objects define their local bbox (shape at the origin,
   * transform applied separately by `getWorldBoundingBox()`).
   */
  getLocalBoundingBox(): BoundingBox {
    if (this._children.length === 0) return new BoundingBox(0, 0, 0, 0)
    let result: BoundingBox | null = null
    for (const child of this._children) {
      if (!child.visible) continue
      const childBB = child.getLocalBoundingBox().transform(child.getLocalTransform())
      result = result === null ? childBB : result.union(childBB)
    }
    return result ?? new BoundingBox(0, 0, 0, 0)
  }

  /** Group's world bbox is the union of all visible children's world bounding boxes. */
  protected override _computeWorldBoundingBox(): BoundingBox {
    if (this._children.length === 0) {
      return new BoundingBox(this.x, this.y, 0, 0)
    }
    let result: BoundingBox | null = null
    for (const child of this._children) {
      if (!child.visible) continue
      const bb = child.getWorldBoundingBox()
      result = result === null ? bb : result.union(bb)
    }
    return result ?? new BoundingBox(this.x, this.y, 0, 0)
  }

  /**
   * When this group's own transform changes, all descendant world-bbox caches go stale
   * because they incorporate ancestor transforms. Cascade the clear downward.
   * @internal
   */
  protected override _invalidateBBox(): void {
    // Clear children first so that when super fires the Layer's index-update callback,
    // any recomputation of this group's world bbox picks up fresh child values.
    for (const child of this._children) {
      child._clearBBoxCacheDeep()
    }
    super._invalidateBBox()
  }

  /** @internal */
  override _clearBBoxCacheDeep(): void {
    this._worldBBoxCache = null
    for (const child of this._children) {
      child._clearBBoxCacheDeep()
    }
  }

  // ---------------------------------------------------------------------------
  // Hit testing — checks children in reverse order (top-most first)
  // ---------------------------------------------------------------------------

  hitTest(worldX: number, worldY: number, tolerance = 4): boolean {
    if (!this.visible) return false
    for (let i = this._children.length - 1; i >= 0; i--) {
      if (this._children[i]!.hitTest(worldX, worldY, this._children[i]!.hitTolerance)) return true
    }
    return false
  }

  /** Returns the topmost child that contains the point, or null. */
  hitTestChild(worldX: number, worldY: number, tolerance = 4): BaseObject | null {
    for (let i = this._children.length - 1; i >= 0; i--) {
      const child = this._children[i]!
      if (child instanceof Group) {
        const hit = child.hitTestChild(worldX, worldY, tolerance)
        if (hit !== null) return hit
      } else if (child.hitTest(worldX, worldY, child.hitTolerance)) {
        return child
      }
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  render(ctx: RenderContext): void {
    if (!this.visible || this.opacity === 0 || !ctx.skCanvas) return
    const canvas = ctx.skCanvas as SkCanvas
    const ck = ctx.canvasKit as unknown as GroupCK

    canvas.save()
    // Push this group's local transform — children will push their own,
    // building up the full world transform via canvas state accumulation.
    canvas.concat(this.getLocalTransform().values)

    const hasEffects = this.effects.length > 0
    if (hasEffects) {
      const key = effectsCacheKey(this.effects)
      if (this._effectPaintCache?.key !== key) {
        ;(this._effectPaintCache?.paint as SkPaint | undefined)?.delete()
        this._effectPaintCache = { paint: makeEffectPaint(ctx.canvasKit as unknown as EffectCK, this.effects), key }
      }
      canvas.saveLayer(this._effectPaintCache!.paint)
    }

    if (this.clip) {
      canvas.clipRect(ck.LTRBRect(0, 0, this.width, this.height), ck.ClipOp.Intersect, true)
    }

    for (const child of this._children) {
      if (child.visible) child.render(ctx)
    }

    if (hasEffects) canvas.restore()
    canvas.restore()
  }

  // ---------------------------------------------------------------------------
  // Events — bubble up from children
  // ---------------------------------------------------------------------------

  emit<K extends keyof ObjectEventMap>(event: K, data: ObjectEventMap[K]): void {
    super.emit(event, data)
  }

  // ---------------------------------------------------------------------------
  // Serialization
  // ---------------------------------------------------------------------------

  getType(): string {
    return 'Group'
  }

  toJSON(): ObjectJSON {
    return {
      ...super.toJSON(),
      clip: this.clip,
      children: this._children.map((c) => c.toJSON()),
    }
  }

  static fromJSON(
    json: ObjectJSON,
    registry?: ReadonlyMap<string, ObjectDeserializer>,
  ): Group {
    const obj = new Group({ clip: json['clip'] === true })
    obj.applyBaseJSON(json)
    const children = json['children']
    if (Array.isArray(children)) {
      for (const childJson of children as ObjectJSON[]) {
        obj.add(objectFromJSON(childJson, registry))
      }
    }
    return obj
  }

  destroy(): void {
    for (const child of this._children) {
      child.destroy()
    }
    this._children = []
    super.destroy()
  }
}
