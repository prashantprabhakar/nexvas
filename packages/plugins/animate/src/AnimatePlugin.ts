import type { Plugin, StageInterface, BaseObject, SolidFill, ColorRGBA } from '@nexvas/core'

// ---------------------------------------------------------------------------
// Easing
// ---------------------------------------------------------------------------

/** A function that maps a normalized time [0,1] to a progress value [0,1]. */
export type EasingFn = (t: number) => number

/** Built-in easing functions exported as a namespace. */
export const Easing = {
  linear: (t: number) => t,
  easeInQuad: (t: number) => t * t,
  easeOutQuad: (t: number) => 1 - (1 - t) * (1 - t),
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2,
  easeInCubic: (t: number) => t ** 3,
  easeOutCubic: (t: number) => 1 - (1 - t) ** 3,
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2,
  easeInExpo: (t: number) => t === 0 ? 0 : 2 ** (10 * t - 10),
  easeOutExpo: (t: number) => t === 1 ? 1 : 1 - 2 ** (-10 * t),
  easeInOutExpo: (t: number) => {
    if (t === 0) return 0
    if (t === 1) return 1
    return t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2
  },
  easeInBounce: (t: number) => 1 - Easing.easeOutBounce(1 - t),
  easeOutBounce: (t: number) => {
    const n1 = 7.5625, d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    return n1 * (t -= 2.625 / d1) * t + 0.984375
  },
  spring: (t: number) => {
    const c4 = (2 * Math.PI) / 3
    return t === 0 ? 0 : t === 1 ? 1 : -(2 ** (10 * t - 10)) * Math.sin((t * 10 - 10.75) * c4)
  },
} as const

// ---------------------------------------------------------------------------
// Tweenable properties
// ---------------------------------------------------------------------------

/** Numeric properties on BaseObject that can be tweened directly. */
export type NumericTweenProp = 'x' | 'y' | 'width' | 'height' | 'rotation' | 'scaleX' | 'scaleY' | 'opacity'

/** Color channel keys for fill/stroke color tweening. */
type ColorChannel = 'r' | 'g' | 'b' | 'a'

/** Target state passed to `anim.tween()`. */
export interface TweenTarget {
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  scaleX?: number
  scaleY?: number
  opacity?: number
  /** Target fill color — only applies when current fill is a solid fill. */
  fillColor?: Partial<ColorRGBA>
  /** Target stroke color — only applies when current stroke is set. */
  strokeColor?: Partial<ColorRGBA>
}

// ---------------------------------------------------------------------------
// Tween
// ---------------------------------------------------------------------------

/** Options passed to `AnimateController.tween()`. */
export interface TweenOptions {
  /** Target property values to animate toward. */
  to: TweenTarget
  /** Animation duration in milliseconds. Default: 300. */
  duration?: number
  /** Easing function. Default: `Easing.easeInOutCubic`. */
  easing?: EasingFn
  /** Called on every interpolated frame. */
  onUpdate?: () => void
  /** Called when the tween reaches its end (or reversed to its start). */
  onComplete?: () => void
}

type TweenState = 'idle' | 'playing' | 'paused' | 'done'

interface NumericSegment {
  prop: NumericTweenProp
  from: number
  to: number
}

interface ColorSegment {
  target: 'fill' | 'stroke'
  channel: ColorChannel
  from: number
  to: number
}

/**
 * A single animation that interpolates an object's properties over time.
 * Obtain instances via `AnimateController.tween()`.
 */
export class Tween {
  private _object: BaseObject
  private _options: Required<TweenOptions>
  private _stage: StageInterface
  private _state: TweenState = 'idle'
  private _elapsed: number = 0
  private _numericSegments: NumericSegment[] = []
  private _colorSegments: ColorSegment[] = []

  /** @internal */
  constructor(object: BaseObject, options: TweenOptions, stage: StageInterface) {
    this._object = object
    this._stage = stage
    this._options = {
      to: options.to,
      duration: options.duration ?? 300,
      easing: options.easing ?? Easing.easeInOutCubic,
      onUpdate: options.onUpdate ?? (() => {}),
      onComplete: options.onComplete ?? (() => {}),
    }
  }

  /** Start or resume playing the tween. */
  play(): this {
    if (this._state === 'done') {
      this._elapsed = 0
      this._state = 'idle'
    }
    if (this._state === 'idle') this._buildSegments()
    this._state = 'playing'
    return this
  }

  /** Pause the tween at the current position. Call `play()` to resume. */
  pause(): this {
    if (this._state === 'playing') this._state = 'paused'
    return this
  }

  /** Reverse the tween from its current position back to the start. */
  reverse(): this {
    for (const seg of this._numericSegments) {
      const tmp = seg.from; seg.from = seg.to; seg.to = tmp
    }
    for (const seg of this._colorSegments) {
      const tmp = seg.from; seg.from = seg.to; seg.to = tmp
    }
    this._elapsed = this._options.duration - this._elapsed
    this._state = 'playing'
    return this
  }

  /** Stop and reset the tween to its initial state. */
  stop(): this {
    this._state = 'done'
    this._elapsed = 0
    return this
  }

  /** Whether this tween has completed. */
  get isDone(): boolean { return this._state === 'done' }

  /** @internal — called by the controller each animation frame. */
  tick(deltaMs: number): void {
    if (this._state !== 'playing') return

    this._elapsed = Math.min(this._elapsed + deltaMs, this._options.duration)
    const t = this._options.duration === 0
      ? 1
      : this._elapsed / this._options.duration
    const progress = this._options.easing(t)

    for (const seg of this._numericSegments) {
      (this._object as unknown as Record<string, number>)[seg.prop] =
        seg.from + (seg.to - seg.from) * progress
    }

    if (this._colorSegments.length > 0) this._applyColorSegments(progress)

    this._stage.markDirty()
    this._options.onUpdate()

    if (this._elapsed >= this._options.duration) {
      this._state = 'done'
      this._options.onComplete()
    }
  }

  private _buildSegments(): void {
    this._numericSegments = []
    this._colorSegments = []
    const obj = this._object as unknown as Record<string, number>
    const to = this._options.to

    const numProps: NumericTweenProp[] = ['x', 'y', 'width', 'height', 'rotation', 'scaleX', 'scaleY', 'opacity']
    for (const prop of numProps) {
      if (to[prop] !== undefined) {
        this._numericSegments.push({ prop, from: obj[prop] ?? 0, to: to[prop]! })
      }
    }

    if (to.fillColor !== undefined) {
      const fill = (this._object as unknown as { fill: unknown }).fill
      if (fill && (fill as SolidFill).type === 'solid') {
        const color = (fill as SolidFill).color
        for (const ch of ['r', 'g', 'b', 'a'] as ColorChannel[]) {
          if (to.fillColor[ch] !== undefined) {
            this._colorSegments.push({ target: 'fill', channel: ch, from: color[ch], to: to.fillColor[ch]! })
          }
        }
      }
    }

    if (to.strokeColor !== undefined) {
      const stroke = (this._object as unknown as { stroke: unknown }).stroke
      if (stroke) {
        const color = (stroke as { color: ColorRGBA }).color
        for (const ch of ['r', 'g', 'b', 'a'] as ColorChannel[]) {
          if (to.strokeColor[ch] !== undefined) {
            this._colorSegments.push({ target: 'stroke', channel: ch, from: color[ch], to: to.strokeColor[ch]! })
          }
        }
      }
    }
  }

  private _applyColorSegments(progress: number): void {
    const fillUpdates: Partial<ColorRGBA> = {}
    const strokeUpdates: Partial<ColorRGBA> = {}
    let hasFill = false
    let hasStroke = false

    for (const seg of this._colorSegments) {
      const value = seg.from + (seg.to - seg.from) * progress
      if (seg.target === 'fill') { fillUpdates[seg.channel] = value; hasFill = true }
      else { strokeUpdates[seg.channel] = value; hasStroke = true }
    }

    if (hasFill) {
      const obj = this._object as unknown as { fill: SolidFill }
      obj.fill = { ...obj.fill, color: { ...obj.fill.color, ...fillUpdates } }
    }
    if (hasStroke) {
      const obj = this._object as unknown as { stroke: { color: ColorRGBA; [k: string]: unknown } }
      obj.stroke = { ...obj.stroke, color: { ...obj.stroke.color, ...strokeUpdates } }
    }
  }
}

// ---------------------------------------------------------------------------
// Composite animations
// ---------------------------------------------------------------------------

/**
 * A sequence that plays tweens one after another.
 * Returned by `AnimateController.sequence()`.
 */
export class SequenceAnimation {
  private _tweens: Tween[]
  private _current: number = 0

  /** @internal */
  constructor(tweens: Tween[]) {
    this._tweens = tweens
  }

  /** Start the sequence from the first tween. */
  play(): this {
    this._current = 0
    if (this._tweens[0]) this._tweens[0].play()
    return this
  }

  /** Stop all tweens in the sequence. */
  stop(): this {
    for (const t of this._tweens) t.stop()
    this._current = 0
    return this
  }

  /** @internal */
  tick(deltaMs: number): void {
    const tween = this._tweens[this._current]
    if (!tween) return
    tween.tick(deltaMs)
    if (tween.isDone) {
      this._current++
      const next = this._tweens[this._current]
      if (next) next.play()
    }
  }

  /** Whether the sequence has finished all tweens. */
  get isDone(): boolean {
    return this._current >= this._tweens.length
  }
}

/**
 * A parallel animation that plays all tweens simultaneously.
 * Returned by `AnimateController.parallel()`.
 */
export class ParallelAnimation {
  private _tweens: Tween[]

  /** @internal */
  constructor(tweens: Tween[]) {
    this._tweens = tweens
  }

  /** Start all tweens simultaneously. */
  play(): this {
    for (const t of this._tweens) t.play()
    return this
  }

  /** Stop all tweens. */
  stop(): this {
    for (const t of this._tweens) t.stop()
    return this
  }

  /** @internal */
  tick(deltaMs: number): void {
    for (const t of this._tweens) t.tick(deltaMs)
  }

  /** Whether all tweens have completed. */
  get isDone(): boolean {
    return this._tweens.every((t) => t.isDone)
  }
}

type Animatable = Tween | SequenceAnimation | ParallelAnimation

// ---------------------------------------------------------------------------
// AnimateController
// ---------------------------------------------------------------------------

/**
 * Main API surface of the AnimatePlugin. Accessed via `(stage as AnimatePluginAPI).animate`.
 */
export class AnimateController {
  private _stage: StageInterface
  private _active: Set<Animatable> = new Set()
  private _lastTimestamp: number = 0
  private _rafId: number | null = null
  private _bound: (ts: number) => void

  /** @internal */
  constructor(stage: StageInterface) {
    this._stage = stage
    this._bound = this._loop.bind(this)
  }

  /**
   * Create and register a tween for the given object.
   * Call `.play()` on the returned tween to start it.
   */
  tween(object: BaseObject, options: TweenOptions): Tween {
    const t = new Tween(object, options, this._stage)
    this._active.add(t)
    this._ensureLoop()
    return t
  }

  /**
   * Play a series of tweens one after another.
   * Returns a `SequenceAnimation`; call `.play()` to start.
   */
  sequence(tweens: Tween[]): SequenceAnimation {
    const seq = new SequenceAnimation(tweens)
    for (const t of tweens) this._active.delete(t)
    this._active.add(seq)
    this._ensureLoop()
    return seq
  }

  /**
   * Play multiple tweens simultaneously.
   * Returns a `ParallelAnimation`; call `.play()` to start.
   */
  parallel(tweens: Tween[]): ParallelAnimation {
    const par = new ParallelAnimation(tweens)
    for (const t of tweens) this._active.delete(t)
    this._active.add(par)
    this._ensureLoop()
    return par
  }

  /** Stop all active animations and cancel the RAF loop. */
  stopAll(): void {
    for (const anim of this._active) anim.stop()
    this._active.clear()
    this._cancelLoop()
  }

  /** @internal — called by uninstall to tear down the loop. */
  dispose(): void {
    this.stopAll()
  }

  private _ensureLoop(): void {
    if (this._rafId !== null) return
    this._lastTimestamp = performance.now()
    this._rafId = requestAnimationFrame(this._bound)
  }

  private _cancelLoop(): void {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId)
      this._rafId = null
    }
  }

  private _loop(timestamp: number): void {
    const delta = timestamp - this._lastTimestamp
    this._lastTimestamp = timestamp

    for (const anim of this._active) {
      anim.tick(delta)
      if (anim.isDone) {
        this._active.delete(anim)
        this._stage.emit('animate:complete', { animation: anim })
      }
    }

    if (this._active.size > 0) {
      this._rafId = requestAnimationFrame(this._bound)
    } else {
      this._rafId = null
    }
  }
}

// ---------------------------------------------------------------------------
// Plugin options & API augmentation
// ---------------------------------------------------------------------------

/** Options for AnimatePlugin constructor. */
export interface AnimatePluginOptions {
  // Reserved for future configuration.
}

/** Type augmentation to access AnimatePlugin API through the stage. */
export interface AnimatePluginAPI {
  animate: AnimateController
}

// ---------------------------------------------------------------------------
// AnimatePlugin
// ---------------------------------------------------------------------------

/**
 * AnimatePlugin — tweening and animation for canvas objects.
 *
 * After installing, access animation operations via `(stage as AnimatePluginAPI).animate`.
 * Fires `'animate:complete'` and `'animate:cancel'` stage events.
 *
 * @example
 * ```ts
 * stage.use(new AnimatePlugin())
 * const { animate } = stage as unknown as AnimatePluginAPI
 *
 * const tween = animate.tween(rect, {
 *   to: { x: 400, y: 200, opacity: 0.5 },
 *   duration: 600,
 *   easing: Easing.easeInOutCubic,
 * })
 * tween.play()
 *
 * // Sequence
 * const seq = animate.sequence([tween1, tween2])
 * seq.play()
 *
 * // Parallel
 * const par = animate.parallel([tween1, tween2])
 * par.play()
 * ```
 */
export class AnimatePlugin implements Plugin {
  readonly name = 'plugin-animate'
  readonly version = '0.0.1'

  private _controller: AnimateController | null = null

  constructor(_options: AnimatePluginOptions = {}) {}

  /** Install the plugin on a stage. Attaches the `animate` controller to the stage object. */
  install(stage: StageInterface): void {
    this._controller = new AnimateController(stage)
    ;(stage as unknown as AnimatePluginAPI).animate = this._controller
  }

  /** Remove the plugin. Stops all animations and detaches the `animate` controller. */
  uninstall(stage: StageInterface): void {
    this._controller?.dispose()
    delete (stage as unknown as Partial<AnimatePluginAPI>).animate
    this._controller = null
  }
}
