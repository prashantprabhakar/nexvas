import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ClipboardPlugin, type ClipboardPluginAPI } from '../src/ClipboardPlugin.js'
import { Rect, Layer, BoundingBox } from '@nexvas/core'
import type { StageInterface, Viewport, FontManager, RenderPass, BaseObject } from '@nexvas/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SelectionLike {
  selected: readonly BaseObject[]
  select(obj: BaseObject): void
  addToSelection(obj: BaseObject): void
  clearSelection(): void
}

function makeStage(selectionPlugin?: SelectionLike): {
  stage: StageInterface
  layer: Layer
  emitted: Map<string, unknown[]>
} {
  const layer = new Layer()
  const handlers = new Map<string, Set<(e: unknown) => void>>()
  const passes: RenderPass[] = []
  const emitted = new Map<string, unknown[]>()

  const stage: StageInterface = {
    id: 'test-stage',
    canvasKit: {},
    get layers() {
      return [layer] as unknown as readonly Layer[]
    },
    viewport: { x: 0, y: 0, scale: 1, width: 800, height: 600 } as unknown as Viewport,
    fonts: {} as unknown as FontManager,
    on(event: string, handler: (e: unknown) => void) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    },
    off(event: string, handler: (e: unknown) => void) {
      handlers.get(event)?.delete(handler)
    },
    emit(event: string, data: unknown) {
      if (!emitted.has(event)) emitted.set(event, [])
      emitted.get(event)!.push(data)
      handlers.get(event)?.forEach((h) => h(data))
    },
    addRenderPass(pass: RenderPass) {
      passes.push(pass)
    },
    removeRenderPass(pass: RenderPass) {
      const i = passes.indexOf(pass)
      if (i !== -1) passes.splice(i, 1)
    },
    getBoundingBox() {
      return new BoundingBox(0, 0, 800, 600)
    },
    render() {},
    markDirty() {},
    resize() {},
    find: () => [],
    findByType: () => [],
    getObjectById: () => undefined,
    registerObject: () => {},
    getObjectLayer(obj: BaseObject) {
      return layer.objects.includes(obj) ? layer : null
    },
    bringToFront: () => {},
    sendToBack: () => {},
    bringForward: () => {},
    sendBackward: () => {},
    groupObjects: () => {
      throw new Error('not implemented')
    },
    ungroupObject: () => [],
    batch(fn: () => void) {
      fn()
    },
  } as unknown as StageInterface

  if (selectionPlugin) {
    ;(stage as unknown as { selection: SelectionLike }).selection = selectionPlugin
  }

  return { stage, layer, emitted }
}

function makeSelection(objects: BaseObject[] = []): SelectionLike & { _objects: BaseObject[] } {
  const _objects: BaseObject[] = [...objects]
  return {
    _objects,
    get selected() {
      return _objects as readonly BaseObject[]
    },
    select(obj: BaseObject) {
      _objects.length = 0
      _objects.push(obj)
    },
    addToSelection(obj: BaseObject) {
      _objects.push(obj)
    },
    clearSelection() {
      _objects.length = 0
    },
  }
}

function makeRect(x = 0, y = 0, w = 100, h = 100): Rect {
  return new Rect({ x, y, width: w, height: h })
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClipboardPlugin', () => {
  describe('lifecycle', () => {
    it('installs without throwing', () => {
      const { stage } = makeStage()
      expect(() => new ClipboardPlugin().install(stage)).not.toThrow()
    })

    it('exposes clipboard controller after install', () => {
      const plugin = new ClipboardPlugin()
      const { stage } = makeStage()
      plugin.install(stage)
      expect((stage as unknown as ClipboardPluginAPI).clipboard).toBeDefined()
    })

    it('uninstalls cleanly', () => {
      const plugin = new ClipboardPlugin()
      const { stage } = makeStage()
      plugin.install(stage)
      plugin.uninstall(stage)
      expect((stage as unknown as Partial<ClipboardPluginAPI>).clipboard).toBeUndefined()
    })

    it('install → uninstall → re-install works', () => {
      const plugin = new ClipboardPlugin()
      const { stage } = makeStage()
      plugin.install(stage)
      plugin.uninstall(stage)
      const { stage: stage2 } = makeStage()
      plugin.install(stage2)
      expect((stage2 as unknown as ClipboardPluginAPI).clipboard).toBeDefined()
      plugin.uninstall(stage2)
    })
  })

  describe('copy', () => {
    it('returns 0 when no SelectionPlugin is installed', () => {
      const plugin = new ClipboardPlugin()
      const { stage } = makeStage()
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      expect(ctrl.copy()).toBe(0)
      expect(ctrl.hasContent).toBe(false)
    })

    it('returns 0 when selection is empty', () => {
      const sel = makeSelection([])
      const plugin = new ClipboardPlugin()
      const { stage } = makeStage(sel)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      expect(ctrl.copy()).toBe(0)
      expect(ctrl.hasContent).toBe(false)
    })

    it('returns count of copied objects', () => {
      const r1 = makeRect(10, 10)
      const r2 = makeRect(50, 50)
      const sel = makeSelection([r1, r2])
      const plugin = new ClipboardPlugin()
      const { stage } = makeStage(sel)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      expect(ctrl.copy()).toBe(2)
      expect(ctrl.hasContent).toBe(true)
      expect(ctrl.count).toBe(2)
    })

    it('does not remove objects from the stage', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      expect(layer.objects).toContain(r1)
    })
  })

  describe('paste', () => {
    it('returns empty array when clipboard is empty', () => {
      const plugin = new ClipboardPlugin()
      const { stage } = makeStage()
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      expect(ctrl.paste()).toEqual([])
    })

    it('adds new objects to the first layer', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const pasted = ctrl.paste()
      expect(pasted).toHaveLength(1)
      expect(layer.objects).toContain(pasted[0])
    })

    it('generates new IDs — pasted object has a different id than original', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const [pasted] = ctrl.paste()!
      expect(pasted!.id).not.toBe(r1.id)
    })

    it('applies PASTE_OFFSET on first paste', () => {
      const r1 = makeRect(100, 100)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const [pasted] = ctrl.paste()!
      expect(pasted!.x).toBe(120) // 100 + 20
      expect(pasted!.y).toBe(120)
    })

    it('accumulates offset with successive pastes', () => {
      const r1 = makeRect(0, 0)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const [p1] = ctrl.paste()!
      const [p2] = ctrl.paste()!
      expect(p1!.x).toBe(20)
      expect(p2!.x).toBe(40)
    })

    it('paste with explicit position places at that position', () => {
      const r1 = makeRect(50, 50)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const [pasted] = ctrl.paste({ x: 200, y: 300 })!
      expect(pasted!.x).toBe(200)
      expect(pasted!.y).toBe(300)
    })

    it("emits 'clipboard:paste' event with pasted objects", () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer, emitted } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const pasted = ctrl.paste()
      const events = emitted.get('clipboard:paste') ?? []
      expect(events).toHaveLength(1)
      expect((events[0] as { objects: BaseObject[] }).objects).toEqual(pasted)
    })

    it('resets selection to pasted objects', () => {
      const r1 = makeRect(0, 0)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const pasted = ctrl.paste()
      expect(sel._objects).toEqual(pasted)
    })

    it('preserves object properties (type, dimensions, fill)', () => {
      const r1 = new Rect({
        x: 10,
        y: 20,
        width: 80,
        height: 60,
        fill: { type: 'solid', color: { r: 1, g: 0, b: 0, a: 1 } },
      })
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const [pasted] = ctrl.paste()!
      expect(pasted).toBeInstanceOf(Rect)
      expect(pasted!.width).toBe(80)
      expect(pasted!.height).toBe(60)
    })

    it('original objects are not mutated by paste', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      ctrl.paste()
      expect(r1.x).toBe(10)
      expect(r1.y).toBe(10)
    })

    it('copy resets paste offset counter', () => {
      const r1 = makeRect(0, 0)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      ctrl.paste() // offset 20
      ctrl.paste() // offset 40
      // Restore selection to r1 so the second copy snapshots x=0 again
      sel._objects.length = 0
      sel._objects.push(r1)
      ctrl.copy()  // resets counter, snapshots r1 at x=0
      const [p] = ctrl.paste()! // offset 20 again
      expect(p!.x).toBe(20)
    })
  })

  describe('cut', () => {
    it('removes original objects from the stage', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.cut()
      expect(layer.objects).not.toContain(r1)
    })

    it('stores snapshot that can be pasted', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.cut()
      expect(ctrl.hasContent).toBe(true)
      const pasted = ctrl.paste()
      expect(pasted).toHaveLength(1)
      expect(layer.objects).toContain(pasted[0])
    })

    it('returns 0 when nothing is selected', () => {
      const sel = makeSelection([])
      const plugin = new ClipboardPlugin()
      const { stage } = makeStage(sel)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      expect(ctrl.cut()).toBe(0)
    })
  })

  describe('duplicate', () => {
    it('copies and pastes selected objects without touching clipboard state externally', () => {
      const r1 = makeRect(0, 0)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      const duped = ctrl.duplicate()
      expect(duped).toHaveLength(1)
      expect(layer.objects).toContain(duped[0])
      expect(duped[0]!.id).not.toBe(r1.id)
    })

    it('pasted duplicate is offset', () => {
      const r1 = makeRect(50, 50)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      const [duped] = ctrl.duplicate()!
      expect(duped!.x).toBe(70)
      expect(duped!.y).toBe(70)
    })
  })

  describe('multiple objects', () => {
    it('pastes all copied objects', () => {
      const r1 = makeRect(0, 0)
      const r2 = makeRect(100, 100)
      const sel = makeSelection([r1, r2])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      layer.add(r2)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const pasted = ctrl.paste()
      expect(pasted).toHaveLength(2)
      for (const p of pasted) expect(layer.objects).toContain(p)
    })

    it('all pasted objects have unique IDs differing from originals', () => {
      const r1 = makeRect(0, 0)
      const r2 = makeRect(100, 100)
      const sel = makeSelection([r1, r2])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      layer.add(r2)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const pasted = ctrl.paste()
      const originalIds = new Set([r1.id, r2.id])
      for (const p of pasted) expect(originalIds.has(p.id)).toBe(false)
      // All pasted IDs are unique
      const pastedIds = pasted.map((p) => p.id)
      expect(new Set(pastedIds).size).toBe(pastedIds.length)
    })
  })

  describe('keyboard shortcuts', () => {
    it('Ctrl+C triggers copy', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      const copySpy = vi.spyOn(ctrl, 'copy')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))
      expect(copySpy).toHaveBeenCalledOnce()
      plugin.uninstall(stage)
    })

    it('Ctrl+X triggers cut', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      const cutSpy = vi.spyOn(ctrl, 'cut')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'x', ctrlKey: true, bubbles: true }))
      expect(cutSpy).toHaveBeenCalledOnce()
      plugin.uninstall(stage)
    })

    it('Ctrl+V triggers paste', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      ctrl.copy()
      const pasteSpy = vi.spyOn(ctrl, 'paste')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }))
      expect(pasteSpy).toHaveBeenCalledOnce()
      plugin.uninstall(stage)
    })

    it('Ctrl+D triggers duplicate', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      const dupeSpy = vi.spyOn(ctrl, 'duplicate')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd', ctrlKey: true, bubbles: true }))
      expect(dupeSpy).toHaveBeenCalledOnce()
      plugin.uninstall(stage)
    })

    it('uninstall removes keyboard listener', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      plugin.uninstall(stage)
      const copySpy = vi.spyOn(ctrl, 'copy')
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))
      expect(copySpy).not.toHaveBeenCalled()
    })

    it('does not intercept shortcuts when focus is on an input', () => {
      const r1 = makeRect(10, 10)
      const sel = makeSelection([r1])
      const plugin = new ClipboardPlugin()
      const { stage, layer } = makeStage(sel)
      layer.add(r1)
      plugin.install(stage)
      const ctrl = (stage as unknown as ClipboardPluginAPI).clipboard
      const copySpy = vi.spyOn(ctrl, 'copy')
      const input = document.createElement('input')
      document.body.appendChild(input)
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true }))
      expect(copySpy).not.toHaveBeenCalled()
      document.body.removeChild(input)
      plugin.uninstall(stage)
    })
  })
})
