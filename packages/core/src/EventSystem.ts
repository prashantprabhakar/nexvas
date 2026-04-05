import type { Viewport } from './Viewport.js'
import type { Layer } from './Layer.js'
import type { CanvasPointerEvent, CanvasWheelEvent, StageEventMap } from './types.js'
import type { BaseObject } from './objects/BaseObject.js'

type StageEventHandler<K extends keyof StageEventMap> = (e: StageEventMap[K]) => void

/**
 * Translates native DOM events on the canvas element into framework events.
 * Handles hit testing, coordinate conversion, and event bubbling.
 */
export class EventSystem {
  private _canvas: HTMLCanvasElement
  private _viewport: Viewport
  private _getLayers: () => readonly Layer[]

  private _stageHandlers = new Map<string, Set<StageEventHandler<never>>>()
  private _lastHovered: BaseObject | null = null
  private _canvasRect: DOMRect | null = null

  // Bound listeners stored so they can be removed in destroy()
  private _boundPointerDown: (e: PointerEvent) => void
  private _boundPointerUp: (e: PointerEvent) => void
  private _boundPointerMove: (e: PointerEvent) => void
  private _boundClick: (e: MouseEvent) => void
  private _boundDblClick: (e: MouseEvent) => void
  private _boundWheel: (e: WheelEvent) => void
  private _boundTouchStart: (e: TouchEvent) => void
  private _boundTouchEnd: (e: TouchEvent) => void

  // Touch tap detection state
  private _touchStartTime = 0
  private _touchStartX = 0
  private _touchStartY = 0
  private _lastTapTime = 0
  private _lastTapX = 0
  private _lastTapY = 0

  constructor(canvas: HTMLCanvasElement, viewport: Viewport, getLayers: () => readonly Layer[]) {
    this._canvas = canvas
    this._viewport = viewport
    this._getLayers = getLayers

    this._boundPointerDown = this._onPointerDown.bind(this)
    this._boundPointerUp = this._onPointerUp.bind(this)
    this._boundPointerMove = this._onPointerMove.bind(this)
    this._boundClick = this._onClick.bind(this)
    this._boundDblClick = this._onDblClick.bind(this)
    this._boundWheel = this._onWheel.bind(this)
    this._boundTouchStart = this._onTouchStart.bind(this)
    this._boundTouchEnd = this._onTouchEnd.bind(this)

    canvas.addEventListener('pointerdown', this._boundPointerDown)
    canvas.addEventListener('pointerup', this._boundPointerUp)
    canvas.addEventListener('pointermove', this._boundPointerMove)
    canvas.addEventListener('click', this._boundClick)
    canvas.addEventListener('dblclick', this._boundDblClick)
    canvas.addEventListener('wheel', this._boundWheel, { passive: false })
    canvas.addEventListener('touchstart', this._boundTouchStart, { passive: true })
    canvas.addEventListener('touchend', this._boundTouchEnd, { passive: true })
  }

  // ---------------------------------------------------------------------------
  // Stage-level event bus
  // ---------------------------------------------------------------------------

  on<K extends keyof StageEventMap>(event: K, handler: StageEventHandler<K>): void {
    if (!this._stageHandlers.has(event)) {
      this._stageHandlers.set(event, new Set())
    }
    this._stageHandlers.get(event)!.add(handler as StageEventHandler<never>)
  }

  off<K extends keyof StageEventMap>(event: K, handler: StageEventHandler<K>): void {
    this._stageHandlers.get(event)?.delete(handler as StageEventHandler<never>)
  }

  emitStage<K extends keyof StageEventMap>(event: K, data: StageEventMap[K]): void {
    const handlers = this._stageHandlers.get(event)
    if (!handlers) return
    // Snapshot handlers before iterating (NV-007: prevents mid-dispatch additions firing).
    // Check stopped after each handler (NV-025: makes stopPropagation() work for stage events).
    for (const h of [...handlers]) {
      ;(h as StageEventHandler<K>)(data)
      if ((data as { stopped?: boolean }).stopped) break
    }
  }

  // ---------------------------------------------------------------------------
  // Canvas rect caching
  // ---------------------------------------------------------------------------

  private _getCanvasRect(): DOMRect {
    if (this._canvasRect === null) {
      this._canvasRect = this._canvas.getBoundingClientRect()
    }
    return this._canvasRect
  }

  /** Invalidate the cached canvas bounding rect. Call after the canvas moves in the page layout. */
  invalidateRect(): void {
    this._canvasRect = null
  }

  // ---------------------------------------------------------------------------
  // Hit testing
  // ---------------------------------------------------------------------------

  private _hitTest(screenX: number, screenY: number): BaseObject | null {
    const world = this._viewport.screenToWorld(screenX, screenY)
    const layers = this._getLayers()
    // Traverse layers top-to-bottom (last layer renders on top)
    for (let i = layers.length - 1; i >= 0; i--) {
      const hit = layers[i]!.hitTest(world.x, world.y)
      if (hit !== null) return hit
    }
    return null
  }

  // ---------------------------------------------------------------------------
  // Coordinate helpers
  // ---------------------------------------------------------------------------

  private _makePointerPos(
    e: MouseEvent,
  ): Omit<CanvasPointerEvent, 'stopped' | 'stopPropagation' | 'originalEvent'> {
    const rect = this._getCanvasRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const world = this._viewport.screenToWorld(screenX, screenY)
    return { screen: { x: screenX, y: screenY }, world }
  }

  private _makeEvent(e: MouseEvent | PointerEvent): CanvasPointerEvent {
    const pos = this._makePointerPos(e)
    const event: CanvasPointerEvent = {
      ...pos,
      originalEvent: e,
      stopped: false,
      stopPropagation() {
        this.stopped = true
      },
    }
    return event
  }

  // ---------------------------------------------------------------------------
  // Native event handlers
  // ---------------------------------------------------------------------------

  private _onPointerDown(e: PointerEvent): void {
    const event = this._makeEvent(e)
    const hit = this._hitTest(event.screen.x, event.screen.y)
    hit?.emit('mousedown', event)
    this.emitStage('mousedown', event)
  }

  private _onPointerUp(e: PointerEvent): void {
    const event = this._makeEvent(e)
    const hit = this._hitTest(event.screen.x, event.screen.y)
    hit?.emit('mouseup', event)
    this.emitStage('mouseup', event)
  }

  private _onPointerMove(e: PointerEvent): void {
    const event = this._makeEvent(e)
    const hit = this._hitTest(event.screen.x, event.screen.y)

    if (hit !== this._lastHovered) {
      this._lastHovered?.emit('mouseleave', event)
      hit?.emit('mouseenter', event)
      this._lastHovered = hit
    }

    hit?.emit('mousemove', event)
    this.emitStage('mousemove', event)
  }

  private _onClick(e: MouseEvent): void {
    const event = this._makeEvent(e)
    const hit = this._hitTest(event.screen.x, event.screen.y)
    hit?.emit('click', event)
    this.emitStage('click', event)
  }

  private _onDblClick(e: MouseEvent): void {
    const event = this._makeEvent(e)
    const hit = this._hitTest(event.screen.x, event.screen.y)
    hit?.emit('dblclick', event)
    this.emitStage('dblclick', event)
  }

  private _onWheel(e: WheelEvent): void {
    e.preventDefault()
    const rect = this._getCanvasRect()
    const screenX = e.clientX - rect.left
    const screenY = e.clientY - rect.top
    const world = this._viewport.screenToWorld(screenX, screenY)
    const wheelEvent: CanvasWheelEvent = {
      screen: { x: screenX, y: screenY },
      world,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
      originalEvent: e,
    }
    this.emitStage('wheel', wheelEvent)
  }

  // ---------------------------------------------------------------------------
  // Touch event handlers (tap / doubletap detection)
  // ---------------------------------------------------------------------------

  private _makeTouchCanvasEvent(touch: Touch, native: TouchEvent): CanvasPointerEvent {
    const rect = this._getCanvasRect()
    const screenX = touch.clientX - rect.left
    const screenY = touch.clientY - rect.top
    const world = this._viewport.screenToWorld(screenX, screenY)
    const event: CanvasPointerEvent = {
      screen: { x: screenX, y: screenY },
      world,
      originalEvent: native,
      stopped: false,
      stopPropagation() {
        this.stopped = true
      },
    }
    return event
  }

  private _onTouchStart(e: TouchEvent): void {
    if (e.touches.length !== 1) return
    const touch = e.touches[0]!
    const rect = this._getCanvasRect()
    this._touchStartTime = performance.now()
    this._touchStartX = touch.clientX - rect.left
    this._touchStartY = touch.clientY - rect.top
  }

  private _onTouchEnd(e: TouchEvent): void {
    if (e.changedTouches.length !== 1) return
    const touch = e.changedTouches[0]!
    const now = performance.now()
    const duration = now - this._touchStartTime

    // A tap must be short (< 250ms) and nearly stationary (< 10px movement).
    if (duration > 250) return
    const rect = this._getCanvasRect()
    const endX = touch.clientX - rect.left
    const endY = touch.clientY - rect.top
    const dx = endX - this._touchStartX
    const dy = endY - this._touchStartY
    if (dx * dx + dy * dy > 100) return

    const event = this._makeTouchCanvasEvent(touch, e)
    const hit = this._hitTest(event.screen.x, event.screen.y)

    // Doubletap: second tap within 300ms and 30px of the first.
    const timeSinceLast = now - this._lastTapTime
    const distFromLast = Math.sqrt(
      (endX - this._lastTapX) ** 2 + (endY - this._lastTapY) ** 2,
    )
    if (timeSinceLast < 300 && distFromLast < 30) {
      hit?.emit('doubletap', event)
      this.emitStage('doubletap', event)
      this._lastTapTime = 0 // reset so triple-tap starts a new sequence
      return
    }

    hit?.emit('tap', event)
    this.emitStage('tap', event)
    this._lastTapTime = now
    this._lastTapX = endX
    this._lastTapY = endY
  }

  // ---------------------------------------------------------------------------
  // Cleanup
  // ---------------------------------------------------------------------------

  destroy(): void {
    this._canvas.removeEventListener('pointerdown', this._boundPointerDown)
    this._canvas.removeEventListener('pointerup', this._boundPointerUp)
    this._canvas.removeEventListener('pointermove', this._boundPointerMove)
    this._canvas.removeEventListener('click', this._boundClick)
    this._canvas.removeEventListener('dblclick', this._boundDblClick)
    this._canvas.removeEventListener('wheel', this._boundWheel)
    this._canvas.removeEventListener('touchstart', this._boundTouchStart)
    this._canvas.removeEventListener('touchend', this._boundTouchEnd)
    this._stageHandlers.clear()
    this._lastHovered = null
  }
}
