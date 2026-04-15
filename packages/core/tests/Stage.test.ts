import { describe, it, expect, vi } from 'vitest'
import { Stage } from '../src/Stage.js'
import { Rect } from '../src/objects/Rect.js'
import { Circle } from '../src/objects/Circle.js'
import { Group } from '../src/objects/Group.js'
import { BaseObject } from '../src/objects/BaseObject.js'
import { BoundingBox } from '../src/math/BoundingBox.js'
import { createMockCK, createMockHTMLCanvas } from './__mocks__/canvaskit.js'
import type { ObjectJSON, RenderContext } from '../src/types.js'

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
      expect(() => stage2.loadJSON(json)).toThrow(/unknown object type "CustomNode"/)
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
})
