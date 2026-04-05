import { describe, it, expect, vi } from 'vitest'
import { EventSystem } from '../src/EventSystem.js'
import { Viewport } from '../src/Viewport.js'
import type { Layer } from '../src/Layer.js'

function makeCanvas(width = 800, height = 600): HTMLCanvasElement {
  const listeners = new Map<string, Set<EventListener>>()
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getBoundingClientRect: () =>
      ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0 }) as DOMRect,
    addEventListener: (type: string, fn: EventListener) => {
      if (!listeners.has(type)) listeners.set(type, new Set())
      listeners.get(type)!.add(fn)
    },
    removeEventListener: (type: string, fn: EventListener) => {
      listeners.get(type)?.delete(fn)
    },
    dispatchEvent: (e: Event) => {
      listeners.get(e.type)?.forEach((fn) => fn(e))
      return true
    },
    _listeners: listeners,
  } as unknown as HTMLCanvasElement
}

function makeTouchEvent(
  type: string,
  x: number,
  y: number,
  changedOrTouches: 'touches' | 'changedTouches' = 'changedTouches',
): TouchEvent {
  const touch = { clientX: x, clientY: y } as Touch
  return {
    type,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    touches: changedOrTouches === 'touches' ? [touch] : [],
    changedTouches: changedOrTouches === 'changedTouches' ? [touch] : [],
    length: 1,
  } as unknown as TouchEvent
}

describe('EventSystem', () => {
  describe('emitStage stopPropagation (NV-025)', () => {
    it('stops subsequent handlers when stopPropagation() is called', () => {
      const viewport = new Viewport()
      viewport.setSize(800, 600)
      const canvas = makeCanvas()
      const events = new EventSystem(canvas, viewport, () => [] as unknown as readonly Layer[])

      let secondFired = false
      events.on('mousedown', (e) => {
        e.stopPropagation()
      })
      events.on('mousedown', () => {
        secondFired = true
      })

      // Simulate a pointerdown on the canvas
      const pointerEvent = new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true })
      canvas.dispatchEvent(pointerEvent)

      expect(secondFired).toBe(false)

      events.destroy()
    })

    it('does not stop handlers when stopPropagation() is not called', () => {
      const viewport = new Viewport()
      viewport.setSize(800, 600)
      const canvas = makeCanvas()
      const events = new EventSystem(canvas, viewport, () => [] as unknown as readonly Layer[])

      let secondFired = false
      events.on('mousedown', () => {
        // does not call stopPropagation
      })
      events.on('mousedown', () => {
        secondFired = true
      })

      const pointerEvent = new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true })
      canvas.dispatchEvent(pointerEvent)

      expect(secondFired).toBe(true)

      events.destroy()
    })

    it('does not fire handlers added during dispatch in the same tick (NV-007)', () => {
      const viewport = new Viewport()
      viewport.setSize(800, 600)
      const canvas = makeCanvas()
      const events = new EventSystem(canvas, viewport, () => [] as unknown as readonly Layer[])

      const lateHandler = vi.fn()
      events.on('mousedown', () => {
        events.on('mousedown', lateHandler)
      })

      const pointerEvent = new PointerEvent('pointerdown', { clientX: 100, clientY: 100, bubbles: true })
      canvas.dispatchEvent(pointerEvent)

      expect(lateHandler).not.toHaveBeenCalled()

      events.destroy()
    })
  })

  describe('touch tap detection', () => {
    it('emits tap on a short, stationary touchstart+touchend', () => {
      const viewport = new Viewport()
      viewport.setSize(800, 600)
      const canvas = makeCanvas()
      const events = new EventSystem(canvas, viewport, () => [] as unknown as readonly Layer[])

      const tapHandler = vi.fn()
      events.on('tap', tapHandler)

      // Simulate touchstart then touchend quickly
      const startEvent = makeTouchEvent('touchstart', 100, 200, 'touches')
      canvas.dispatchEvent(startEvent)

      // Advance time by using a short timeout simulation — we mock performance.now indirectly
      // by dispatching touchend immediately (same tick = < 250ms)
      const endEvent = makeTouchEvent('touchend', 100, 200)
      canvas.dispatchEvent(endEvent)

      expect(tapHandler).toHaveBeenCalledOnce()
      const tapData = tapHandler.mock.calls[0]![0]
      expect(tapData.screen.x).toBe(100)
      expect(tapData.screen.y).toBe(200)

      events.destroy()
    })

    it('emits doubletap on two consecutive short taps', () => {
      const viewport = new Viewport()
      viewport.setSize(800, 600)
      const canvas = makeCanvas()
      const events = new EventSystem(canvas, viewport, () => [] as unknown as readonly Layer[])

      const tapHandler = vi.fn()
      const doubletapHandler = vi.fn()
      events.on('tap', tapHandler)
      events.on('doubletap', doubletapHandler)

      // First tap
      canvas.dispatchEvent(makeTouchEvent('touchstart', 50, 50, 'touches'))
      canvas.dispatchEvent(makeTouchEvent('touchend', 50, 50))

      // Second tap — within threshold
      canvas.dispatchEvent(makeTouchEvent('touchstart', 50, 50, 'touches'))
      canvas.dispatchEvent(makeTouchEvent('touchend', 50, 50))

      expect(tapHandler).toHaveBeenCalledOnce() // only first tap fires tap
      expect(doubletapHandler).toHaveBeenCalledOnce()

      events.destroy()
    })

    it('does not emit tap when touch moves more than 10px', () => {
      const viewport = new Viewport()
      viewport.setSize(800, 600)
      const canvas = makeCanvas()
      const events = new EventSystem(canvas, viewport, () => [] as unknown as readonly Layer[])

      const tapHandler = vi.fn()
      events.on('tap', tapHandler)

      canvas.dispatchEvent(makeTouchEvent('touchstart', 100, 100, 'touches'))
      // end 15px away — should not be a tap
      canvas.dispatchEvent(makeTouchEvent('touchend', 115, 100))

      expect(tapHandler).not.toHaveBeenCalled()

      events.destroy()
    })
  })
})
