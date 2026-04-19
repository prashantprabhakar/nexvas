import type { Plugin, StageInterface } from '@nexvas/core'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PinchZoomPluginOptions {
  /**
   * Minimum scale the viewport is allowed to reach via pinch.
   * When set, overrides the viewport's own minScale during pinch gestures.
   * Default: uses viewport's current minScale.
   */
  minScale?: number
  /**
   * Maximum scale the viewport is allowed to reach via pinch.
   * Default: uses viewport's current maxScale.
   */
  maxScale?: number
  /**
   * Allow single-finger panning.
   * Default: false (single finger does nothing — left to other plugins or native scroll).
   */
  panWithOneFinger?: boolean
}

/** Narrowest cast we need from Stage — canvas is not on StageInterface. */
interface StageWithCanvas extends StageInterface {
  readonly canvas: HTMLCanvasElement
}

interface ActivePinch {
  /** IDs of the two touch points, in order of arrival. */
  id0: number
  id1: number
  /** Midpoint in canvas CSS pixels when the pinch started. */
  midX: number
  midY: number
  /** Distance between the two touch points when the pinch started. */
  startDist: number
  /** Scale at the beginning of this pinch gesture. */
  startScale: number
  /** Viewport pan at the beginning of this pinch gesture. */
  startPanX: number
  startPanY: number
}

interface ActivePan {
  id: number
  lastX: number
  lastY: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dist(t0: Touch, t1: Touch): number {
  const dx = t1.clientX - t0.clientX
  const dy = t1.clientY - t0.clientY
  return Math.sqrt(dx * dx + dy * dy)
}

function mid(t0: Touch, t1: Touch): { x: number; y: number } {
  return { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 }
}

/** Convert a client-space point to canvas CSS-pixel space. */
function clientToCanvas(
  clientX: number,
  clientY: number,
  rect: DOMRect,
): { x: number; y: number } {
  return { x: clientX - rect.left, y: clientY - rect.top }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * PinchZoomPlugin — two-finger pinch-to-zoom and two-finger pan on touch devices.
 *
 * Listens to native `touchstart`, `touchmove`, and `touchend` events on the
 * stage's canvas element. Calls `stage.viewport.zoom()` and `stage.viewport.pan()`
 * so all other plugins see a consistent viewport state.
 *
 * @example
 * ```ts
 * stage.use(new PinchZoomPlugin())
 * // or with options:
 * stage.use(new PinchZoomPlugin({ panWithOneFinger: true }))
 * ```
 */
export class PinchZoomPlugin implements Plugin {
  readonly name = 'pinch-zoom'
  readonly version = '0.1.0'

  private _options: Required<PinchZoomPluginOptions>
  private _stage: StageWithCanvas | null = null
  private _pinch: ActivePinch | null = null
  private _pan: ActivePan | null = null

  private _onTouchStart: (e: TouchEvent) => void
  private _onTouchMove: (e: TouchEvent) => void
  private _onTouchEnd: (e: TouchEvent) => void

  constructor(options: PinchZoomPluginOptions = {}) {
    this._options = {
      minScale: options.minScale ?? 0,
      maxScale: options.maxScale ?? 0,
      panWithOneFinger: options.panWithOneFinger ?? false,
    }

    this._onTouchStart = this._handleTouchStart.bind(this)
    this._onTouchMove = this._handleTouchMove.bind(this)
    this._onTouchEnd = this._handleTouchEnd.bind(this)
  }

  // ---------------------------------------------------------------------------
  // Plugin lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Attach touch listeners to the stage canvas.
   * `passive: false` is required so we can call `preventDefault()` to suppress
   * native scroll/zoom during the gesture.
   */
  install(stage: StageInterface): void {
    this._stage = stage as StageWithCanvas
    const canvas = this._stage.canvas
    canvas.addEventListener('touchstart', this._onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', this._onTouchMove, { passive: false })
    canvas.addEventListener('touchend', this._onTouchEnd)
    canvas.addEventListener('touchcancel', this._onTouchEnd)
  }

  /** Remove all touch listeners and reset gesture state. */
  uninstall(_stage: StageInterface): void {
    const canvas = this._stage?.canvas
    if (canvas) {
      canvas.removeEventListener('touchstart', this._onTouchStart)
      canvas.removeEventListener('touchmove', this._onTouchMove)
      canvas.removeEventListener('touchend', this._onTouchEnd)
      canvas.removeEventListener('touchcancel', this._onTouchEnd)
    }
    this._pinch = null
    this._pan = null
    this._stage = null
  }

  // ---------------------------------------------------------------------------
  // Touch handlers
  // ---------------------------------------------------------------------------

  private _handleTouchStart(e: TouchEvent): void {
    if (!this._stage) return

    const touches = e.touches

    if (touches.length === 2) {
      // Start or switch to pinch mode — cancel any one-finger pan.
      this._pan = null
      e.preventDefault()

      const t0 = touches[0]!
      const t1 = touches[1]!
      const vp = this._stage.viewport
      const vpState = vp.getState()
      const rect = this._stage.canvas.getBoundingClientRect()
      const m = mid(t0, t1)
      const canvasMid = clientToCanvas(m.x, m.y, rect)

      this._pinch = {
        id0: t0.identifier,
        id1: t1.identifier,
        midX: canvasMid.x,
        midY: canvasMid.y,
        startDist: dist(t0, t1),
        startScale: vpState.scale,
        startPanX: vpState.x,
        startPanY: vpState.y,
      }
    } else if (touches.length === 1 && this._options.panWithOneFinger && !this._pinch) {
      const t = touches[0]!
      this._pan = { id: t.identifier, lastX: t.clientX, lastY: t.clientY }
      e.preventDefault()
    }
  }

  private _handleTouchMove(e: TouchEvent): void {
    if (!this._stage) return

    const touches = e.touches

    if (this._pinch && touches.length >= 2) {
      e.preventDefault()

      // Find the two original touch points by identifier.
      const t0 = this._findTouch(touches, this._pinch.id0)
      const t1 = this._findTouch(touches, this._pinch.id1)
      if (!t0 || !t1) return

      const vp = this._stage.viewport
      const currentDist = dist(t0, t1)
      const scaleFactor = currentDist / this._pinch.startDist

      const rect = this._stage.canvas.getBoundingClientRect()
      const m = mid(t0, t1)
      const canvasMid = clientToCanvas(m.x, m.y, rect)

      // Compute target scale clamped to plugin options (fallback to viewport limits).
      const vpState = vp.getState()
      const minS = this._options.minScale > 0 ? this._options.minScale : (vp as unknown as { minScale: number }).minScale ?? 0.01
      const maxS = this._options.maxScale > 0 ? this._options.maxScale : (vp as unknown as { maxScale: number }).maxScale ?? 64
      const targetScale = Math.min(maxS, Math.max(minS, this._pinch.startScale * scaleFactor))
      const actualFactor = targetScale / vpState.scale

      // Zoom around the current midpoint.
      vp.zoom(actualFactor, canvasMid.x, canvasMid.y)

      // Pan by the delta in the midpoint position.
      const midDx = canvasMid.x - this._pinch.midX
      const midDy = canvasMid.y - this._pinch.midY
      if (midDx !== 0 || midDy !== 0) {
        vp.pan(midDx, midDy)
        this._pinch.midX = canvasMid.x
        this._pinch.midY = canvasMid.y
      }
    } else if (this._pan && touches.length === 1) {
      e.preventDefault()
      const t = this._findTouch(touches, this._pan.id)
      if (!t) return

      const dx = t.clientX - this._pan.lastX
      const dy = t.clientY - this._pan.lastY
      this._stage.viewport.pan(dx, dy)
      this._pan.lastX = t.clientX
      this._pan.lastY = t.clientY
    }
  }

  private _handleTouchEnd(e: TouchEvent): void {
    if (!this._stage) return

    const touches = e.touches

    if (this._pinch && touches.length < 2) {
      this._pinch = null
    }

    if (this._pan && touches.length === 0) {
      this._pan = null
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private _findTouch(list: TouchList, id: number): Touch | null {
    for (let i = 0; i < list.length; i++) {
      if (list[i]!.identifier === id) return list[i]!
    }
    return null
  }

  /** Returns true if a pinch gesture is currently in progress. */
  isPinching(): boolean {
    return this._pinch !== null
  }

  /** Returns true if a one-finger pan gesture is currently in progress. */
  isPanning(): boolean {
    return this._pan !== null
  }
}
