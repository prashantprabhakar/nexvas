import { describe, it, expect, vi } from 'vitest'
import { Stage } from '../src/Stage.js'
import { Rect } from '../src/objects/Rect.js'
import { Circle } from '../src/objects/Circle.js'
import { Group } from '../src/objects/Group.js'
import { BaseObject } from '../src/objects/BaseObject.js'
import { BoundingBox } from '../src/math/BoundingBox.js'
import { createMockCK, createMockHTMLCanvas } from './__mocks__/canvaskit.js'
import type { ObjectJSON, ObjectMutationEvent, RenderContext } from '../src/types.js'

// ---------------------------------------------------------------------------
// Minimal custom object type used by NV-004 tests
// ---------------------------------------------------------------------------

class CustomNode extends BaseObject {
  customProp: string

  constructor(props: { customProp?: string } = {}) {
    super()
    this.customProp = props.customProp ?? ''
  }

  getType(): string {
    return 'CustomNode'
  }

  getLocalBoundingBox(): BoundingBox {
    return new BoundingBox(0, 0, this.width, this.height)
  }

  render(_ctx: RenderContext): void {
    // no-op in tests
  }

  toJSON(): ObjectJSON {
    return { ...super.toJSON(), customProp: this.customProp }
  }

  static fromJSON(json: ObjectJSON): CustomNode {
    const node = new CustomNode({ customProp: json['customProp'] as string | undefined })
    node.applyBaseJSON(json)
    return node
  }
}

function makeStage() {
  const ck = createMockCK()
  const canvas = createMockHTMLCanvas()
  return { stage: new Stage({ canvas, canvasKit: ck }), ck, canvas }
}

describe('Stage', () => {
  it('constructs without error', () => {
    expect(() => makeStage()).not.toThrow()
  })

  it('throws when surface creation fails', () => {
    const ck = createMockCK()
    ;(ck as unknown as { MakeWebGLCanvasSurface: () => null }).MakeWebGLCanvasSurface = () => null
    const canvas = createMockHTMLCanvas()
    expect(() => new Stage({ canvas, canvasKit: ck })).toThrow(/Failed to create CanvasKit/)
  })

  it('addLayer and removeLayer', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    expect(stage.layers).toHaveLength(1)
    stage.removeLayer(layer)
    expect(stage.layers).toHaveLength(0)
  })

  it('getObjectById finds across layers', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 0, y: 0, width: 50, height: 50 })
    layer.add(rect)
    expect(stage.getObjectById(rect.id)).toBe(rect)
  })

  it('render calls surface.flush()', () => {
    const { stage, ck } = makeStage()
    const flushSpy = vi.spyOn(ck.surface, 'flush')
    stage.render()
    expect(flushSpy).toHaveBeenCalledOnce()
  })

  it('render skips when destroyed', () => {
    const { stage, ck } = makeStage()
    const flushSpy = vi.spyOn(ck.surface, 'flush')
    stage.destroy()
    stage.render()
    expect(flushSpy).not.toHaveBeenCalled()
  })

  it('markDirty re-triggers render on next startLoop tick', () => {
    const { stage } = makeStage()
    stage.markDirty()
    expect(stage['_dirty']).toBe(true)
  })

  it('plugin use() installs and uninstalls', () => {
    const { stage } = makeStage()
    const installed = vi.fn()
    const uninstalled = vi.fn()
    const plugin = {
      name: 'test',
      version: '1.0.0',
      install: installed,
      uninstall: uninstalled,
    }
    stage.use(plugin)
    expect(installed).toHaveBeenCalledOnce()
    stage.plugins.uninstall('test')
    expect(uninstalled).toHaveBeenCalledOnce()
  })

  it('toJSON serializes layers', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer({ name: 'BG' })
    layer.add(new Rect({ x: 1, y: 2, width: 3, height: 4 }))
    const json = stage.toJSON()
    expect(json.version).toBe('1.0.0')
    expect(json.layers).toHaveLength(1)
    expect(json.layers[0]!.name).toBe('BG')
    expect(json.layers[0]!.objects).toHaveLength(1)
  })

  it('addRenderPass and removeRenderPass', () => {
    const { stage } = makeStage()
    const pass = { phase: 'pre' as const, order: 0, render: vi.fn() }
    stage.addRenderPass(pass)
    stage.render()
    expect(pass.render).toHaveBeenCalledOnce()
    stage.removeRenderPass(pass)
    stage.render()
    expect(pass.render).toHaveBeenCalledOnce() // still once
  })

  it('destroy cleans up surface', () => {
    const { stage, ck } = makeStage()
    const disposeSpy = vi.spyOn(ck.surface, 'dispose')
    stage.destroy()
    expect(disposeSpy).toHaveBeenCalledOnce()
  })

  it('loadJSON restores scene from toJSON snapshot', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer({ name: 'Main' })
    layer.add(new Rect({ x: 10, y: 20, width: 100, height: 50, name: 'R1' }))
    layer.add(new Circle({ x: 200, y: 200, width: 80, height: 80, name: 'C1' }))
    const json = stage.toJSON()

    // Load into a fresh stage
    const { stage: stage2 } = makeStage()
    stage2.loadJSON(json)

    expect(stage2.layers).toHaveLength(1)
    expect(stage2.layers[0]!.name).toBe('Main')
    const objs = stage2.layers[0]!.objects
    expect(objs).toHaveLength(2)
    expect(objs[0]!.name).toBe('R1')
    expect(objs[0]!.x).toBe(10)
    expect(objs[1]!.name).toBe('C1')
  })

  it('loadJSON replaces existing layers', () => {
    const { stage } = makeStage()
    stage.addLayer({ name: 'Old' })
    const { stage: stage2 } = makeStage()
    const layer2 = stage2.addLayer({ name: 'New' })
    layer2.add(new Rect({ x: 0, y: 0, width: 10, height: 10 }))
    stage.loadJSON(stage2.toJSON())
    expect(stage.layers).toHaveLength(1)
    expect(stage.layers[0]!.name).toBe('New')
  })

  it('loadJSON throws on unsupported schema version', () => {
    const { stage } = makeStage()
    expect(() => stage.loadJSON({ version: '2.0.0', layers: [] })).toThrow(/unsupported schema version/)
  })

  it('loadJSON round-trips Group with children', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const group = new Group({ x: 0, y: 0, width: 200, height: 200 })
    group.add(new Rect({ x: 5, y: 5, width: 50, height: 50, name: 'child' }))
    layer.add(group)
    const json = stage.toJSON()

    const { stage: stage2 } = makeStage()
    stage2.loadJSON(json)
    const restoredGroup = stage2.layers[0]!.objects[0]!
    expect(restoredGroup.getType()).toBe('Group')
    const children = (restoredGroup as Group).children
    expect(children).toHaveLength(1)
    expect(children[0]!.name).toBe('child')
  })

  it('resize() updates viewport size and recreates surface', () => {
    const { stage, ck } = makeStage()
    const disposeSpy = vi.spyOn(ck.surface, 'dispose')
    const makeWebGLSpy = vi.spyOn(ck, 'MakeWebGLCanvasSurface')

    stage.resize(1600, 900) // physical pixels (e.g. 2× DPR on 800×450 CSS)

    // Surface should be recreated
    expect(disposeSpy).toHaveBeenCalledOnce()
    expect(makeWebGLSpy).toHaveBeenCalledOnce()

    // Viewport size should be in CSS pixels (1600/dpr, 900/dpr)
    const dpr = window.devicePixelRatio || 1
    expect(stage.viewport.width).toBeCloseTo(1600 / dpr)
    expect(stage.viewport.height).toBeCloseTo(900 / dpr)

    // Stage should be dirty for redraw
    expect(stage['_dirty']).toBe(true)
  })

  it('resize() is a no-op after destroy', () => {
    const { stage, ck } = makeStage()
    stage.destroy()
    const makeWebGLSpy = vi.spyOn(ck, 'MakeWebGLCanvasSurface')
    expect(() => stage.resize(800, 600)).not.toThrow()
    expect(makeWebGLSpy).not.toHaveBeenCalled()
  })

  it('getBoundingBox returns union of all visible objects', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    layer.add(new Rect({ x: 0, y: 0, width: 100, height: 50 }))
    layer.add(new Rect({ x: 50, y: 50, width: 100, height: 50 }))
    const bb = stage.getBoundingBox()
    expect(bb.width).toBe(150)
    expect(bb.height).toBe(100)
  })

  describe('NV-032 Stage.find() and findByType()', () => {
    it('find() returns objects matching predicate', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const r = new Rect({ x: 0, y: 0, width: 50, height: 50, name: 'myRect' })
      const c = new Circle({ x: 100, y: 100, width: 50, height: 50, name: 'myCircle' })
      layer.add(r).add(c)
      const found = stage.find((obj) => obj.name === 'myRect')
      expect(found).toHaveLength(1)
      expect(found[0]).toBe(r)
    })

    it('findByType() returns only objects of that type', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      layer.add(new Rect({ x: 0, y: 0, width: 10, height: 10 }))
      layer.add(new Rect({ x: 10, y: 10, width: 10, height: 10 }))
      layer.add(new Circle({ x: 50, y: 50, width: 20, height: 20 }))
      const rects = stage.findByType('Rect')
      expect(rects).toHaveLength(2)
      const circles = stage.findByType('Circle')
      expect(circles).toHaveLength(1)
    })

    it('find() returns empty array when nothing matches', () => {
      const { stage } = makeStage()
      stage.addLayer()
      expect(stage.find(() => false)).toHaveLength(0)
    })
  })

  describe('NV-004 registerObject() — custom type deserialization', () => {
    it('registerObject allows loadJSON to restore custom types', () => {
      const { stage } = makeStage()
      stage.registerObject('CustomNode', CustomNode.fromJSON)

      const layer = stage.addLayer({ name: 'Main' })
      const node = new CustomNode({ customProp: 'hello' })
      layer.add(node)
      const json = stage.toJSON()

      const { stage: stage2 } = makeStage()
      stage2.registerObject('CustomNode', CustomNode.fromJSON)
      stage2.loadJSON(json)

      const objs = stage2.layers[0]!.objects
      expect(objs).toHaveLength(1)
      expect(objs[0]!.getType()).toBe('CustomNode')
      expect((objs[0] as CustomNode).customProp).toBe('hello')
    })

    it('loadJSON throws on unknown type when no deserializer is registered', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      layer.add(new CustomNode())
      const json = stage.toJSON()

      const { stage: stage2 } = makeStage()
      // No registerObject call — should throw
      expect(() => stage2.loadJSON(json)).toThrow(/unknown object type "CustomNode"/i)
    })

    it('registerObject overwrites a previous deserializer for the same type', () => {
      const { stage } = makeStage()
      const first = vi.fn().mockImplementation(CustomNode.fromJSON)
      const second = vi.fn().mockImplementation(CustomNode.fromJSON)

      stage.registerObject('CustomNode', first)
      stage.registerObject('CustomNode', second)

      const layer = stage.addLayer()
      layer.add(new CustomNode())
      const json = stage.toJSON()

      stage.loadJSON(json)
      expect(second).toHaveBeenCalledOnce()
      expect(first).not.toHaveBeenCalled()
    })

    it('custom types inside a Group are deserialized correctly', () => {
      const { stage } = makeStage()
      stage.registerObject('CustomNode', CustomNode.fromJSON)

      const layer = stage.addLayer()
      const group = new Group({ x: 0, y: 0, width: 200, height: 200 })
      group.add(new CustomNode({ customProp: 'nested' }))
      layer.add(group)
      const json = stage.toJSON()

      const { stage: stage2 } = makeStage()
      stage2.registerObject('CustomNode', CustomNode.fromJSON)
      stage2.loadJSON(json)

      const restoredGroup = stage2.layers[0]!.objects[0] as Group
      expect(restoredGroup.getType()).toBe('Group')
      expect(restoredGroup.children).toHaveLength(1)
      expect(restoredGroup.children[0]!.getType()).toBe('CustomNode')
      expect((restoredGroup.children[0] as CustomNode).customProp).toBe('nested')
    })

    it('mixed built-in and custom types in one layer all round-trip correctly', () => {
      const { stage } = makeStage()
      stage.registerObject('CustomNode', CustomNode.fromJSON)

      const layer = stage.addLayer()
      layer.add(new Rect({ x: 0, y: 0, width: 50, height: 50, name: 'r' }))
      layer.add(new CustomNode({ customProp: 'c' }))
      const json = stage.toJSON()

      const { stage: stage2 } = makeStage()
      stage2.registerObject('CustomNode', CustomNode.fromJSON)
      stage2.loadJSON(json)

      const objs = stage2.layers[0]!.objects
      expect(objs).toHaveLength(2)
      expect(objs[0]!.getType()).toBe('Rect')
      expect(objs[0]!.name).toBe('r')
      expect(objs[1]!.getType()).toBe('CustomNode')
      expect((objs[1] as CustomNode).customProp).toBe('c')
    })
  })

  describe('NV-033 Stage.batch()', () => {
    it('suppresses individual object:mutated events during batch', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 100 })
      layer.add(rect)

      const mutations: ObjectMutationEvent[] = []
      stage.on('object:mutated', (e) => mutations.push(e))

      stage.batch(() => {
        rect.x = 10
        rect.y = 20
        // During batch — mutations must not fire yet
        expect(mutations).toHaveLength(0)
      })

      // After batch — all three should have fired
      expect(mutations).toHaveLength(2)
      expect(mutations[0]!.property).toBe('x')
      expect(mutations[1]!.property).toBe('y')
    })

    it('emits batch:commit with all mutations after batch exits', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 100 })
      layer.add(rect)

      const commits: { mutations: ObjectMutationEvent[] }[] = []
      stage.on('batch:commit', (e) => commits.push(e))

      stage.batch(() => {
        rect.x = 50
        rect.y = 60
        rect.width = 200
      })

      expect(commits).toHaveLength(1)
      expect(commits[0]!.mutations).toHaveLength(3)
      expect(commits[0]!.mutations[0]!.property).toBe('x')
      expect(commits[0]!.mutations[1]!.property).toBe('y')
      expect(commits[0]!.mutations[2]!.property).toBe('width')
    })

    it('does not emit batch:commit when batch has no mutations', () => {
      const { stage } = makeStage()
      const commits: unknown[] = []
      stage.on('batch:commit', (e) => commits.push(e))
      stage.batch(() => { /* no mutations */ })
      expect(commits).toHaveLength(0)
    })

    it('nested batches flush only when outermost exits', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 100 })
      layer.add(rect)

      const mutations: ObjectMutationEvent[] = []
      const commits: unknown[] = []
      stage.on('object:mutated', (e) => mutations.push(e))
      stage.on('batch:commit', (e) => commits.push(e))

      stage.batch(() => {
        rect.x = 10
        stage.batch(() => {
          rect.y = 20
          expect(mutations).toHaveLength(0)
          expect(commits).toHaveLength(0)
        })
        // Still inside outer batch
        expect(mutations).toHaveLength(0)
        expect(commits).toHaveLength(0)
      })

      expect(mutations).toHaveLength(2)
      expect(commits).toHaveLength(1)
    })

    it('flushes and emits batch:commit even if fn throws', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 100 })
      layer.add(rect)

      const mutations: ObjectMutationEvent[] = []
      stage.on('object:mutated', (e) => mutations.push(e))

      expect(() => {
        stage.batch(() => {
          rect.x = 99
          throw new Error('oops')
        })
      }).toThrow('oops')

      // The mutation queued before the throw must still flush
      expect(mutations).toHaveLength(1)
      expect(mutations[0]!.property).toBe('x')
    })

    it('mutations outside batch still fire immediately', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 100 })
      layer.add(rect)

      const mutations: ObjectMutationEvent[] = []
      stage.on('object:mutated', (e) => mutations.push(e))

      rect.x = 42
      expect(mutations).toHaveLength(1)
      expect(mutations[0]!.newValue).toBe(42)
    })
  })

  describe('Z-order API', () => {
    it('getObjectLayer returns the layer containing the object', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const rect = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      layer.add(rect)
      expect(stage.getObjectLayer(rect)).toBe(layer)
    })

    it('getObjectLayer returns null for an object not in any layer', () => {
      const { stage } = makeStage()
      stage.addLayer()
      const rect = new Rect()
      expect(stage.getObjectLayer(rect)).toBeNull()
    })

    it('bringToFront moves object to highest z-order', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const a = new Rect()
      const b = new Rect()
      const c = new Rect()
      layer.add(a).add(b).add(c)
      stage.bringToFront(a)
      const objs = layer.objects
      expect(objs[objs.length - 1]).toBe(a)
    })

    it('sendToBack moves object to lowest z-order', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const a = new Rect()
      const b = new Rect()
      const c = new Rect()
      layer.add(a).add(b).add(c)
      stage.sendToBack(c)
      expect(layer.objects[0]).toBe(c)
    })

    it('bringForward moves object one step up', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const a = new Rect()
      const b = new Rect()
      const c = new Rect()
      layer.add(a).add(b).add(c)
      stage.bringForward(a)
      expect(layer.objects[1]).toBe(a)
    })

    it('sendBackward moves object one step down', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const a = new Rect()
      const b = new Rect()
      const c = new Rect()
      layer.add(a).add(b).add(c)
      stage.sendBackward(c)
      expect(layer.objects[1]).toBe(c)
    })

    it('bringToFront is a no-op for object not in any layer', () => {
      const { stage } = makeStage()
      stage.addLayer()
      const rect = new Rect()
      expect(() => stage.bringToFront(rect)).not.toThrow()
    })

    it('bringToFront emits zorder:change with correct indices', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const a = new Rect()
      const b = new Rect()
      const c = new Rect()
      layer.add(a).add(b).add(c)

      const events: Array<{ oldIndex: number; newIndex: number }> = []
      stage.on('zorder:change', (e) => events.push({ oldIndex: e.oldIndex, newIndex: e.newIndex }))

      stage.bringToFront(a)
      expect(events).toHaveLength(1)
      expect(events[0]!.oldIndex).toBe(0)
      expect(events[0]!.newIndex).toBe(2)
    })

    it('sendToBack emits zorder:change with correct indices', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const a = new Rect()
      const b = new Rect()
      const c = new Rect()
      layer.add(a).add(b).add(c)

      const events: Array<{ oldIndex: number; newIndex: number }> = []
      stage.on('zorder:change', (e) => events.push({ oldIndex: e.oldIndex, newIndex: e.newIndex }))

      stage.sendToBack(c)
      expect(events).toHaveLength(1)
      expect(events[0]!.oldIndex).toBe(2)
      expect(events[0]!.newIndex).toBe(0)
    })

    it('bringToFront does not emit zorder:change when already at top', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const a = new Rect()
      const b = new Rect()
      layer.add(a).add(b)

      const events: unknown[] = []
      stage.on('zorder:change', (e) => events.push(e))

      stage.bringToFront(b) // already at top
      expect(events).toHaveLength(0)
    })

    it('bringForward emits zorder:change', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const a = new Rect()
      const b = new Rect()
      layer.add(a).add(b)

      const events: Array<{ oldIndex: number; newIndex: number }> = []
      stage.on('zorder:change', (e) => events.push({ oldIndex: e.oldIndex, newIndex: e.newIndex }))

      stage.bringForward(a)
      expect(events).toHaveLength(1)
      expect(events[0]!.oldIndex).toBe(0)
      expect(events[0]!.newIndex).toBe(1)
    })

    it('markDirty is called after z-order change', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const a = new Rect()
      const b = new Rect()
      layer.add(a).add(b)
      stage['_dirty'] = false
      stage.bringToFront(a)
      expect(stage['_dirty']).toBe(true)
    })
  })

  describe('object:added / object:removed events', () => {
    it('emits object:added when an object is added to a stage-owned layer', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const addedHandler = vi.fn()
      stage.on('object:added', addedHandler)
      const rect = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      layer.add(rect)
      expect(addedHandler).toHaveBeenCalledOnce()
      expect(addedHandler.mock.calls[0]![0].object).toBe(rect)
    })

    it('emits object:removed when an object is removed from a stage-owned layer', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const rect = new Rect()
      layer.add(rect)
      const removedHandler = vi.fn()
      stage.on('object:removed', removedHandler)
      layer.remove(rect)
      expect(removedHandler).toHaveBeenCalledOnce()
      expect(removedHandler.mock.calls[0]![0].object).toBe(rect)
    })

    it('stops emitting events after the layer is removed from the stage', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const addedHandler = vi.fn()
      stage.on('object:added', addedHandler)
      stage.removeLayer(layer)
      layer.add(new Rect())
      expect(addedHandler).not.toHaveBeenCalled()
    })
  })

  describe('groupObjects() / ungroupObject()', () => {
    it('groupObjects creates a Group containing the given objects', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const r1 = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      const r2 = new Rect({ x: 100, y: 0, width: 50, height: 50 })
      layer.add(r1).add(r2)

      const group = stage.groupObjects([r1, r2])
      expect(group).toBeInstanceOf(Group)
      expect(group.children).toHaveLength(2)
      expect(layer.objects).toHaveLength(1)
      expect(layer.objects[0]).toBe(group)
    })

    it('groupObjects places group at union-bbox origin', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const r1 = new Rect({ x: 20, y: 30, width: 50, height: 50 })
      const r2 = new Rect({ x: 80, y: 10, width: 40, height: 40 })
      layer.add(r1).add(r2)

      const group = stage.groupObjects([r1, r2])
      // Union bbox: x=20, y=10 (min corners)
      expect(group.x).toBe(20)
      expect(group.y).toBe(10)
    })

    it('groupObjects preserves world positions of children', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const r = new Rect({ x: 100, y: 200, width: 50, height: 50 })
      layer.add(r)

      const group = stage.groupObjects([r])
      // group is at (100, 200), child should be at (0, 0) in group space
      expect(group.x).toBe(100)
      expect(group.y).toBe(200)
      expect(r.x).toBe(0)
      expect(r.y).toBe(0)
    })

    it('groupObjects accepts explicit layer by instance', () => {
      const { stage } = makeStage()
      const layer1 = stage.addLayer()
      const layer2 = stage.addLayer()
      const r = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      layer1.add(r)

      const group = stage.groupObjects([r], layer2)
      expect(layer2.objects).toContain(group)
      expect(layer1.objects).toHaveLength(0)
    })

    it('groupObjects accepts explicit layer by id string', () => {
      const { stage } = makeStage()
      const layer1 = stage.addLayer({ id: 'grp-layer1' })
      const layer2 = stage.addLayer({ id: 'grp-layer2' })
      const r = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      layer1.add(r)

      const group = stage.groupObjects([r], 'grp-layer2')
      expect(layer2.objects).toContain(group)
    })

    it('groupObjects throws on empty array', () => {
      const { stage } = makeStage()
      expect(() => stage.groupObjects([])).toThrow(/empty/)
    })

    it('groupObjects throws when object is not in any layer', () => {
      const { stage } = makeStage()
      stage.addLayer()
      const r = new Rect()
      expect(() => stage.groupObjects([r])).toThrow(/not in any layer/)
    })

    it('groupObjects throws on unknown layerId string', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const r = new Rect({ x: 0, y: 0, width: 10, height: 10 })
      layer.add(r)
      expect(() => stage.groupObjects([r], 'nonexistent')).toThrow(/not found/)
    })

    it('ungroupObject moves children back to the layer', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const r1 = new Rect({ x: 10, y: 10, width: 50, height: 50 })
      const r2 = new Rect({ x: 70, y: 10, width: 50, height: 50 })
      layer.add(r1).add(r2)

      const group = stage.groupObjects([r1, r2])
      const ungrouped = stage.ungroupObject(group)

      expect(ungrouped).toHaveLength(2)
      expect(layer.objects).toHaveLength(2)
      expect(layer.objects).not.toContain(group)
      expect(layer.objects).toContain(r1)
      expect(layer.objects).toContain(r2)
    })

    it('ungroupObject restores world positions (no rotation on group)', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const r = new Rect({ x: 100, y: 200, width: 50, height: 50 })
      layer.add(r)

      stage.groupObjects([r])
      stage.ungroupObject(layer.objects[0] as Group)

      // World position must be restored
      expect(r.x).toBeCloseTo(100)
      expect(r.y).toBeCloseTo(200)
    })

    it('ungroupObject restores world positions when group has rotation', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const r = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      layer.add(r)

      const group = stage.groupObjects([r])
      // Rotate the group 90 degrees and translate it
      group.x = 50
      group.y = 100
      group.rotation = 90

      const worldBefore = group.getWorldTransform().multiply(r.getLocalTransform())
      const expectedX = worldBefore.values[2]
      const expectedY = worldBefore.values[5]

      stage.ungroupObject(group)

      expect(r.x).toBeCloseTo(expectedX)
      expect(r.y).toBeCloseTo(expectedY)
      expect(r.rotation).toBeCloseTo(90)
    })

    it('ungroupObject throws when group is not in any layer', () => {
      const { stage } = makeStage()
      const group = new Group()
      expect(() => stage.ungroupObject(group)).toThrow(/not in any layer/)
    })

    it('groupObjects emits group:created event', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const r1 = new Rect({ x: 0, y: 0, width: 50, height: 50 })
      const r2 = new Rect({ x: 60, y: 0, width: 50, height: 50 })
      layer.add(r1).add(r2)

      const events: unknown[] = []
      stage.on('group:created', (e) => events.push(e))

      const group = stage.groupObjects([r1, r2])
      expect(events).toHaveLength(1)
      const evt = events[0] as { group: Group; layer: unknown; members: unknown[] }
      expect(evt.group).toBe(group)
      expect(evt.layer).toBe(layer)
      expect(evt.members).toEqual([r1, r2])
    })

    it('ungroupObject emits group:dissolved event', () => {
      const { stage } = makeStage()
      const layer = stage.addLayer()
      const r = new Rect({ x: 10, y: 20, width: 50, height: 50 })
      layer.add(r)
      const group = stage.groupObjects([r])

      const events: unknown[] = []
      stage.on('group:dissolved', (e) => events.push(e))

      const children = stage.ungroupObject(group)
      expect(events).toHaveLength(1)
      const evt = events[0] as { group: Group; layer: unknown; members: unknown[] }
      expect(evt.group).toBe(group)
      expect(evt.layer).toBe(layer)
      expect(evt.members).toEqual(children)
    })
  })
})
