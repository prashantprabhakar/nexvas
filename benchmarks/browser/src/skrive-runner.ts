/**
 * NexVas benchmark runner.
 *
 * Drives the render loop manually (bypasses Stage.startLoop()) so the
 * harness has full control over frame timing and measurement.
 */
import { loadCanvasKit } from '@nexvas/renderer'
import { Stage, Rect } from '@nexvas/core'
import {
  makeObjects,
  stepAnimation,
  computeStats,
  BENCH_DURATION_MS,
  WARMUP_FRAMES,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  RECT_SIZE,
} from './harness.js'
import type { BenchmarkResult, Scenario } from './harness.js'

// Cache CanvasKit across runs — loading takes ~1s and only needs to happen once.
let _ckPromise: Promise<unknown> | null = null

function getCanvasKit(): Promise<unknown> {
  if (!_ckPromise) _ckPromise = loadCanvasKit()
  return _ckPromise
}

/**
 * Run a single NexVas benchmark scenario.
 *
 * @param container - DOM element where the canvas will be injected. Cleaned up after.
 * @param scenario  - Which scenario to run.
 * @param onProgress - Called each frame with a 0–1 progress value (after warmup).
 */
export async function runNexVas(
  container: HTMLElement,
  scenario: Scenario,
  onProgress: (pct: number) => void,
): Promise<BenchmarkResult> {
  const ck = await getCanvasKit()

  // Create and mount the canvas.
  const canvas = document.createElement('canvas')
  canvas.width  = CANVAS_WIDTH
  canvas.height = CANVAS_HEIGHT
  canvas.style.cssText = `display:block;width:${CANVAS_WIDTH}px;height:${CANVAS_HEIGHT}px`
  container.appendChild(canvas)

  // Build the stage (WebGL surface is created here).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stage = new Stage({ canvas, canvasKit: ck as any, pixelRatio: 1 })
  const layer = stage.addLayer()

  // Populate the scene.
  const states = makeObjects(scenario.count)
  const rects: Rect[] = []
  for (const s of states) {
    const rect = new Rect({
      x: s.x, y: s.y, width: RECT_SIZE, height: RECT_SIZE,
      fill: { type: 'solid', color: { r: s.r, g: s.g, b: s.b, a: 1 } },
    })
    layer.add(rect)
    rects.push(rect)
  }

  return new Promise<BenchmarkResult>((resolve) => {
    const frameDurations: number[] = []
    let frameCount = 0
    let prevTime = performance.now()
    let benchStart = 0  // set after warmup

    function loop(): void {
      const now = performance.now()

      // --- Warm-up phase: render but don't record ---
      if (frameCount < WARMUP_FRAMES) {
        stage.markDirty()
        stage.render()
        frameCount++
        if (frameCount === WARMUP_FRAMES) {
          // Warm-up complete — start the measurement clock.
          benchStart = performance.now()
          prevTime = benchStart
        }
        requestAnimationFrame(loop)
        return
      }

      // --- Measurement phase ---
      const elapsed = now - benchStart

      if (elapsed >= BENCH_DURATION_MS) {
        // Clean up.
        stage.destroy()
        canvas.remove()

        const stats = computeStats(frameDurations)
        resolve({
          scenario:    scenario.id,
          framework:   'nexvas',
          objectCount: scenario.count,
          totalFrames: frameDurations.length,
          durationMs:  elapsed,
          ...stats,
        })
        return
      }

      onProgress(elapsed / BENCH_DURATION_MS)

      // Advance animation state and sync to scene objects.
      if (scenario.animated) {
        stepAnimation(states)
        for (let i = 0; i < rects.length; i++) {
          rects[i]!.x = states[i]!.x
          rects[i]!.y = states[i]!.y
        }
      }

      // Force a render this frame (dirty-flag bypass for throughput measurement).
      stage.markDirty()
      stage.render()

      const dt = now - prevTime
      if (dt > 0) frameDurations.push(dt)
      prevTime = now

      requestAnimationFrame(loop)
    }

    requestAnimationFrame(loop)
  })
}
