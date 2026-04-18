import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HistoryPlugin, type HistoryCommand } from '../src/HistoryPlugin.js'
import type { StageInterface, Viewport, FontManager, BaseObject, Layer, ObjectMutationEvent } from '@nexvas/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type StageEventHandler = (data: unknown) => void

function makeStage(): StageInterface & { _handlers: Record<string, StageEventHandler[]> } {
  const handlers: Record<string, StageEventHandler[]> = {}
  return {
    id: 'test-stage',
    canvasKit: {},
    layers: [],
    viewport: { x: 0, y: 0, scale: 1, width: 800, height: 600, getState: () => ({ x: 0, y: 0, scale: 1, width: 800, height: 600 }) } as unknown as Viewport,
    fonts: {} as unknown as FontManager,
    on: vi.fn((event: string, handler: StageEventHandler) => {
      ;(handlers[event] ??= []).push(handler)
    }),
    off: vi.fn((event: string, handler: StageEventHandler) => {
      handlers[event] = (handlers[event] ?? []).filter((h) => h !== handler)
    }),
    addRenderPass: vi.fn(),
    removeRenderPass: vi.fn(),
    getBoundingBox: vi.fn(),
    render: vi.fn(),
    markDirty: vi.fn(),
    emit: vi.fn((event: string, data: unknown) => {
      for (const h of handlers[event] ?? []) h(data)
    }),
    resize: vi.fn(),
    _handlers: handlers,
  } as unknown as StageInterface & { _handlers: Record<string, StageEventHandler[]> }
}

function makeCommand(label?: string): HistoryCommand & { applyCalls: number; undoCalls: number } {
  const cmd = {
    label,
    applyCalls: 0,
    undoCalls: 0,
    apply() {
      this.applyCalls++
    },
    undo() {
      this.undoCalls++
    },
  }
  return cmd
}

function makeMutation(
  obj: Record<string, unknown>,
  property: string,
  oldValue: unknown,
  newValue: unknown,
): ObjectMutationEvent {
  obj[property] = newValue
  return { object: obj as unknown as BaseObject, property, oldValue, newValue }
}

function makeLayer(objects: BaseObject[]): Layer {
  return {
    moveTo: vi.fn((obj: BaseObject, index: number) => {
      const i = objects.indexOf(obj)
      if (i === -1) return
      const clamped = Math.max(0, Math.min(objects.length - 1, index))
      objects.splice(i, 1)
      objects.splice(clamped, 0, obj)
    }),
  } as unknown as Layer
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('HistoryPlugin', () => {
  let plugin: HistoryPlugin
  let stage: ReturnType<typeof makeStage>

  beforeEach(() => {
    plugin = new HistoryPlugin()
    stage = makeStage()
    plugin.install(stage)
  })

  // — existing tests ——————————————————————————————————————————————————————————

  it('installs and uninstalls without error', () => {
    expect(plugin.canUndo).toBe(false)
    expect(plugin.canRedo).toBe(false)
    plugin.uninstall(stage)
  })

  it('record applies command immediately', () => {
    const cmd = makeCommand()
    plugin.record(cmd)
    expect(cmd.applyCalls).toBe(1)
    expect(plugin.canUndo).toBe(true)
  })

  it('undo calls undo on last command', () => {
    const cmd = makeCommand()
    plugin.record(cmd)
    plugin.undo()
    expect(cmd.undoCalls).toBe(1)
    expect(plugin.canUndo).toBe(false)
    expect(plugin.canRedo).toBe(true)
  })

  it('redo re-applies the undone command', () => {
    const cmd = makeCommand()
    plugin.record(cmd)
    plugin.undo()
    plugin.redo()
    expect(cmd.applyCalls).toBe(2)
    expect(plugin.canRedo).toBe(false)
    expect(plugin.canUndo).toBe(true)
  })

  it('record after undo clears redo stack', () => {
    const cmd1 = makeCommand()
    const cmd2 = makeCommand()
    plugin.record(cmd1)
    plugin.undo()
    plugin.record(cmd2)
    expect(plugin.canRedo).toBe(false)
  })

  it('undo on empty stack does nothing', () => {
    expect(() => plugin.undo()).not.toThrow()
  })

  it('redo on empty stack does nothing', () => {
    expect(() => plugin.redo()).not.toThrow()
  })

  it('clear resets both stacks', () => {
    plugin.record(makeCommand())
    plugin.record(makeCommand())
    plugin.undo()
    plugin.clear()
    expect(plugin.canUndo).toBe(false)
    expect(plugin.canRedo).toBe(false)
  })

  it('respects maxSize', () => {
    const limited = new HistoryPlugin({ maxSize: 2 })
    limited.install(stage)

    limited.record(makeCommand('a'))
    limited.record(makeCommand('b'))
    limited.record(makeCommand('c')) // oldest 'a' is evicted

    // Can undo twice (b, c) but not a third time
    limited.undo()
    limited.undo()
    expect(limited.canUndo).toBe(false)

    limited.uninstall(stage)
  })

  it('Ctrl+Z triggers undo', () => {
    const cmd = makeCommand()
    plugin.record(cmd)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    expect(cmd.undoCalls).toBe(1)
  })

  it('Ctrl+Y triggers redo', () => {
    const cmd = makeCommand()
    plugin.record(cmd)
    plugin.undo()

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }))
    expect(cmd.applyCalls).toBe(2)
  })

  it('Ctrl+Shift+Z triggers redo', () => {
    const cmd = makeCommand()
    plugin.record(cmd)
    plugin.undo()

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true }),
    )
    expect(cmd.applyCalls).toBe(2)
  })

  it('uninstall removes keyboard listener', () => {
    const cmd = makeCommand()
    plugin.record(cmd)
    plugin.uninstall(stage)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }))
    expect(cmd.undoCalls).toBe(0)
  })

  it('multiple undo/redo cycling works correctly', () => {
    const cmd1 = makeCommand()
    const cmd2 = makeCommand()
    plugin.record(cmd1)
    plugin.record(cmd2)

    plugin.undo()
    plugin.undo()
    expect(plugin.canUndo).toBe(false)

    plugin.redo()
    plugin.redo()
    expect(plugin.canRedo).toBe(false)

    expect(cmd1.applyCalls).toBe(2)
    expect(cmd2.applyCalls).toBe(2)
  })

  // — batch:commit integration ———————————————————————————————————————————————

  it('batch:commit creates one undo entry', () => {
    const obj: Record<string, unknown> = { x: 0 }
    const mutation = makeMutation(obj, 'x', 0, 100)

    stage.emit('batch:commit', { mutations: [mutation] })

    expect(plugin.canUndo).toBe(true)
    expect(plugin.canRedo).toBe(false)
  })

  it('batch:commit undo restores old values in reverse order', () => {
    const obj: Record<string, unknown> = { x: 0, y: 0 }
    const m1 = makeMutation(obj, 'x', 0, 100)
    const m2 = makeMutation(obj, 'y', 0, 200)

    stage.emit('batch:commit', { mutations: [m1, m2] })
    expect(obj.x).toBe(100)
    expect(obj.y).toBe(200)

    plugin.undo()
    expect(obj.x).toBe(0)
    expect(obj.y).toBe(0)
    expect(plugin.canRedo).toBe(true)
  })

  it('batch:commit redo re-applies mutations', () => {
    const obj: Record<string, unknown> = { x: 0 }
    const mutation = makeMutation(obj, 'x', 0, 42)

    stage.emit('batch:commit', { mutations: [mutation] })
    plugin.undo()
    expect(obj.x).toBe(0)

    plugin.redo()
    expect(obj.x).toBe(42)
  })

  it('empty batch:commit is ignored', () => {
    stage.emit('batch:commit', { mutations: [] })
    expect(plugin.canUndo).toBe(false)
  })

  it('batch:commit clears redo stack', () => {
    plugin.record(makeCommand())
    plugin.undo()
    expect(plugin.canRedo).toBe(true)

    const obj: Record<string, unknown> = { x: 0 }
    stage.emit('batch:commit', { mutations: [makeMutation(obj, 'x', 0, 1)] })
    expect(plugin.canRedo).toBe(false)
  })

  it('batch:commit is suppressed during record()', () => {
    // A command that fires batch:commit internally should not double-record
    let batchFired = false
    const cmd: HistoryCommand = {
      apply() {
        batchFired = true
        const obj: Record<string, unknown> = { x: 0 }
        // simulate batch:commit firing while record is in progress
        stage.emit('batch:commit', { mutations: [makeMutation(obj, 'x', 0, 1)] })
      },
      undo() {},
    }
    plugin.record(cmd)
    // Only the outer record() should add an entry, not the inner batch:commit
    expect(plugin.canUndo).toBe(true)
    plugin.undo()
    expect(plugin.canUndo).toBe(false) // only one entry was pushed
    expect(batchFired).toBe(true)
  })

  // — zorder:change integration ——————————————————————————————————————————————

  it('zorder:change creates one undo entry', () => {
    const objects = [
      { id: 'a' } as unknown as BaseObject,
      { id: 'b' } as unknown as BaseObject,
    ]
    const layer = makeLayer(objects)

    stage.emit('zorder:change', { object: objects[0]!, layer, oldIndex: 0, newIndex: 1 })
    expect(plugin.canUndo).toBe(true)
  })

  it('zorder:change undo restores old index via layer.moveTo', () => {
    const objects = [
      { id: 'a' } as unknown as BaseObject,
      { id: 'b' } as unknown as BaseObject,
    ]
    const layer = makeLayer(objects)
    // Simulate move: a went from index 0 to index 1
    ;[objects[0], objects[1]] = [objects[1]!, objects[0]!]

    stage.emit('zorder:change', { object: objects[1]!, layer, oldIndex: 0, newIndex: 1 })
    plugin.undo()
    expect(layer.moveTo).toHaveBeenCalledWith(expect.anything(), 0)
  })

  it('zorder:change redo calls moveTo with newIndex', () => {
    const objects = [
      { id: 'a' } as unknown as BaseObject,
      { id: 'b' } as unknown as BaseObject,
    ]
    const layer = makeLayer(objects)
    const objA = objects[0]!

    stage.emit('zorder:change', { object: objA, layer, oldIndex: 0, newIndex: 1 })
    plugin.undo()
    plugin.redo()
    expect(layer.moveTo).toHaveBeenLastCalledWith(objA, 1)
  })

  it('zorder:change is suppressed during undo/redo', () => {
    // Record a zorder command, then undo — should NOT push another entry
    const objects = [
      { id: 'a' } as unknown as BaseObject,
      { id: 'b' } as unknown as BaseObject,
    ]
    const layer = makeLayer(objects)
    stage.emit('zorder:change', { object: objects[0]!, layer, oldIndex: 0, newIndex: 1 })

    expect(plugin.canUndo).toBe(true)
    plugin.undo() // calls layer.moveTo(), which does NOT emit zorder:change (correct)
    expect(plugin.canUndo).toBe(false)
    expect(plugin.canRedo).toBe(true)
  })

  // — uninstall removes event listeners ————————————————————————————————————

  it('uninstall removes batch:commit and zorder:change listeners', () => {
    plugin.uninstall(stage)

    const obj: Record<string, unknown> = { x: 0 }
    stage.emit('batch:commit', { mutations: [makeMutation(obj, 'x', 0, 1)] })
    expect(plugin.canUndo).toBe(false)
  })

  // — checkpoint() ——————————————————————————————————————————————————————————

  it('checkpoint() stores a save-point with correct stackIndex', () => {
    plugin.record(makeCommand())
    plugin.record(makeCommand())
    plugin.checkpoint('after-save')

    expect(plugin.checkpoints).toHaveLength(1)
    expect(plugin.checkpoints[0]!.label).toBe('after-save')
    expect(plugin.checkpoints[0]!.stackIndex).toBe(2)
  })

  it('checkpoint() without label stores undefined label', () => {
    plugin.checkpoint()
    expect(plugin.checkpoints[0]!.label).toBeUndefined()
  })

  it('checkpoint() emits history:checkpoint on stage', () => {
    plugin.checkpoint('v1')
    expect(stage.emit).toHaveBeenCalledWith('history:checkpoint', { label: 'v1' })
  })

  it('checkpoint() does not clear redo stack', () => {
    plugin.record(makeCommand())
    plugin.undo()
    plugin.checkpoint()
    expect(plugin.canRedo).toBe(true)
  })

  it('clear() resets checkpoints', () => {
    plugin.checkpoint('a')
    plugin.checkpoint('b')
    plugin.clear()
    expect(plugin.checkpoints).toHaveLength(0)
  })

  it('multiple checkpoints accumulate', () => {
    plugin.record(makeCommand())
    plugin.checkpoint('first')
    plugin.record(makeCommand())
    plugin.checkpoint('second')

    expect(plugin.checkpoints).toHaveLength(2)
    expect(plugin.checkpoints[0]!.stackIndex).toBe(1)
    expect(plugin.checkpoints[1]!.stackIndex).toBe(2)
  })
})
