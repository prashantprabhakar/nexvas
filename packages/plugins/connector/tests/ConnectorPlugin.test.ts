import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConnectorPlugin } from '../src/ConnectorPlugin.js'
import { Rect, Layer, Connector } from '@nexvas/core'
import type { StageInterface, CanvasPointerEvent, RenderPass, BoundingBox, Viewport, FontManager } from '@nexvas/core'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePointerEvent(opts: { worldX?: number; worldY?: number } = {}): CanvasPointerEvent {
  return {
    world: { x: opts.worldX ?? 0, y: opts.worldY ?? 0 },
    screen: { x: opts.worldX ?? 0, y: opts.worldY ?? 0 },
    originalEvent: {} as MouseEvent,
    stopped: false,
    stopPropagation() { this.stopped = true },
  }
}

type EventHandler = (e: unknown) => void

function makeStage(layerObjects: Rect[] = []): StageInterface {
  const layer = new Layer()
  for (const obj of layerObjects) layer.add(obj)

  const handlers = new Map<string, Set<EventHandler>>()
  const passes: RenderPass[] = []

  const stage: StageInterface = {
    id: 'test-stage',
    canvasKit: {},
    get layers() {
      return [layer] as unknown as readonly Layer[]
    },
    viewport: {
      x: 0,
      y: 0,
      scale: 1,
      width: 800,
      height: 600,
      getState: () => ({ x: 0, y: 0, scale: 1, width: 800, height: 600 }),
    } as unknown as Viewport,
    fonts: {} as unknown as FontManager,
    on(event: string, handler: EventHandler) {
      if (!handlers.has(event)) handlers.set(event, new Set())
      handlers.get(event)!.add(handler)
    },
    off(event: string, handler: EventHandler) {
      handlers.get(event)?.delete(handler)
    },
    addRenderPass(pass: RenderPass) {
      passes.push(pass)
    },
    removeRenderPass(pass: RenderPass) {
      const i = passes.indexOf(pass)
      if (i !== -1) passes.splice(i, 1)
    },
    getBoundingBox() {
      const { BoundingBox: BB } = require('@nexvas/core') as {
        BoundingBox: new (x: number, y: number, w: number, h: number) => BoundingBox
      }
      return new BB(0, 0, 800, 600)
    },
    render: vi.fn(),
    markDirty: vi.fn(),
    emit: vi.fn(),
    resize: vi.fn(),
    find: vi.fn(() => []),
    findByType: vi.fn(() => []),
    getObjectById: vi.fn(() => undefined),
    _fire(event: string, data: unknown) {
      handlers.get(event)?.forEach((h) => h(data))
    },
  } as unknown as StageInterface

  return stage
}

function fire(stage: StageInterface, event: string, data: unknown) {
  ;(stage as unknown as { _fire: (e: string, d: unknown) => void })._fire(event, data)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectorPlugin', () => {
  let plugin: ConnectorPlugin
  let stage: StageInterface

  beforeEach(() => {
    plugin = new ConnectorPlugin()
    stage = makeStage()
    plugin.install(stage)
  })

  it('installs without throwing', () => {
    expect(() => plugin.install(makeStage())).not.toThrow()
  })

  it('uninstalls cleanly', () => {
    plugin.uninstall(stage)
    expect(plugin.isConnectMode()).toBe(false)
    expect(plugin.isConnecting()).toBe(false)
  })

  it('install → uninstall → re-install works', () => {
    plugin.uninstall(stage)
    const stage2 = makeStage()
    expect(() => plugin.install(stage2)).not.toThrow()
    plugin.uninstall(stage2)
  })

  it('isConnectMode starts as false', () => {
    expect(plugin.isConnectMode()).toBe(false)
  })

  it('startConnectMode / stopConnectMode toggle the mode', () => {
    plugin.startConnectMode()
    expect(plugin.isConnectMode()).toBe(true)

    plugin.stopConnectMode()
    expect(plugin.isConnectMode()).toBe(false)
  })

  it('isConnecting is false before mousedown', () => {
    plugin.startConnectMode()
    expect(plugin.isConnecting()).toBe(false)
  })

  it('isConnecting becomes true after mousedown in connect mode', () => {
    plugin.startConnectMode()
    fire(stage, 'mousedown', makePointerEvent({ worldX: 50, worldY: 50 }))
    expect(plugin.isConnecting()).toBe(true)
  })

  it('isConnecting becomes false after mouseup', () => {
    plugin.startConnectMode()
    fire(stage, 'mousedown', makePointerEvent({ worldX: 50, worldY: 50 }))
    fire(stage, 'mouseup', makePointerEvent({ worldX: 200, worldY: 200 }))
    expect(plugin.isConnecting()).toBe(false)
  })

  it('does not start connecting when connect mode is off', () => {
    fire(stage, 'mousedown', makePointerEvent({ worldX: 50, worldY: 50 }))
    expect(plugin.isConnecting()).toBe(false)
  })

  it('creates a connector on mouseup with sufficient distance', () => {
    const layer = stage.layers[0]!
    const initialCount = layer.objects.length

    plugin.startConnectMode()
    fire(stage, 'mousedown', makePointerEvent({ worldX: 0, worldY: 0 }))
    fire(stage, 'mouseup', makePointerEvent({ worldX: 200, worldY: 0 }))

    expect(layer.objects.length).toBe(initialCount + 1)
    expect(layer.objects[layer.objects.length - 1]).toBeInstanceOf(Connector)
  })

  it('does not create a connector when distance is trivial (< 4px)', () => {
    const layer = stage.layers[0]!
    const initialCount = layer.objects.length

    plugin.startConnectMode()
    fire(stage, 'mousedown', makePointerEvent({ worldX: 100, worldY: 100 }))
    fire(stage, 'mouseup', makePointerEvent({ worldX: 101, worldY: 100 })) // 1px apart

    expect(layer.objects.length).toBe(initialCount)
  })

  it('calls onConnect callback when connector is created', () => {
    const onConnect = vi.fn()
    const p = new ConnectorPlugin({ onConnect })
    p.install(stage)
    p.startConnectMode()

    fire(stage, 'mousedown', makePointerEvent({ worldX: 0, worldY: 0 }))
    fire(stage, 'mouseup', makePointerEvent({ worldX: 300, worldY: 0 }))

    expect(onConnect).toHaveBeenCalledOnce()
    expect(onConnect.mock.calls[0][0]).toBeInstanceOf(Connector)
    p.uninstall(stage)
  })

  it('uninstall stops event handling', () => {
    plugin.startConnectMode()
    plugin.uninstall(stage)

    fire(stage, 'mousedown', makePointerEvent({ worldX: 0, worldY: 0 }))
    expect(plugin.isConnecting()).toBe(false)
  })

  it('mouseleave cancels active draw', () => {
    plugin.startConnectMode()
    fire(stage, 'mousedown', makePointerEvent({ worldX: 0, worldY: 0 }))
    expect(plugin.isConnecting()).toBe(true)
    fire(stage, 'mouseleave', makePointerEvent())
    expect(plugin.isConnecting()).toBe(false)
  })

  it('stopConnectMode cancels active draw', () => {
    plugin.startConnectMode()
    fire(stage, 'mousedown', makePointerEvent({ worldX: 0, worldY: 0 }))
    plugin.stopConnectMode()
    expect(plugin.isConnecting()).toBe(false)
  })

  it('createConnector programmatic API adds connector to first layer', () => {
    const layer = stage.layers[0]!
    const connector = plugin.createConnector({
      source: { x: 0, y: 0 },
      target: { x: 100, y: 100 },
    })
    expect(connector).toBeInstanceOf(Connector)
    expect(layer.objects).toContain(connector)
  })

  it('createConnector returns null when plugin is not installed on a stage', () => {
    const uninstalledPlugin = new ConnectorPlugin()
    const result = uninstalledPlugin.createConnector({ source: { x: 0, y: 0 }, target: { x: 100, y: 0 } })
    expect(result).toBeNull()
  })

  it('connector created programmatically uses default routing', () => {
    const p = new ConnectorPlugin({ defaultRouting: 'orthogonal' })
    p.install(stage)
    const connector = p.createConnector({ source: { x: 0, y: 0 }, target: { x: 100, y: 100 } })
    expect((connector as Connector).routing).toBe('orthogonal')
    p.uninstall(stage)
  })

  it('connector created via drag has fixed endpoints when not snapped to ports', () => {
    plugin.startConnectMode()
    fire(stage, 'mousedown', makePointerEvent({ worldX: 10, worldY: 20 }))
    fire(stage, 'mouseup', makePointerEvent({ worldX: 300, worldY: 150 }))

    const layer = stage.layers[0]!
    const connector = layer.objects[layer.objects.length - 1] as Connector
    expect(connector).toBeInstanceOf(Connector)
    expect('x' in connector.source).toBe(true)
    expect('x' in connector.target).toBe(true)
  })

  it('connector snaps to object port when released near port', () => {
    const rect = new Rect({ x: 300, y: 100, width: 100, height: 100 })
    const layer = stage.layers[0]!
    layer.add(rect)

    // The 'right' port is at x=400, y=150
    plugin.startConnectMode()
    fire(stage, 'mousedown', makePointerEvent({ worldX: 10, worldY: 10 }))
    // Release very close to the right port of rect (within 20px tolerance)
    fire(stage, 'mouseup', makePointerEvent({ worldX: 402, worldY: 150 }))

    const connector = layer.objects[layer.objects.length - 1] as Connector
    expect(connector).toBeInstanceOf(Connector)
    // Target should be a port reference
    expect('objectId' in connector.target).toBe(true)
    if ('objectId' in connector.target) {
      expect(connector.target.objectId).toBe(rect.id)
      expect(connector.target.portId).toBe('right')
    }
  })
})
