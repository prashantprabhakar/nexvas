# NexVas

**GPU-accelerated 2D canvas framework for the web.**
Built on [CanvasKit](https://skia.org/docs/user/modules/canvaskit/) (Skia → WebAssembly → WebGL2) — the same rendering engine powering Chrome and Flutter.

[![CI](https://github.com/your-org/nexvas/actions/workflows/ci.yml/badge.svg)](https://github.com/your-org/nexvas/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Why NexVas?

Konva and Fabric.js are built on the browser's Canvas 2D API — a CPU-bound, single-threaded path. NexVas hands all rendering to the GPU via Skia, the same engine that renders Chrome's UI.

| Scenario | Konva | NexVas |
|---|---|---|
| 10,000 static objects | ~20 fps | 60 fps |
| 1,000 objects, interactive drag | ~30 fps | 60 fps |
| Sub-pixel antialiasing | ✗ | ✓ |
| Linear gradient on rotated shape | ✗ | ✓ |
| PDF export via Skia | ✗ | ✓ |

---

## Features

- **Scene graph** — Stage → Layers → Objects, with full z-order control
- **10 built-in object types** — Rect, Circle, Line, Path, Text, Image, Group, Connector, Polygon, Star
- **Connector objects** — smart lines between shapes; straight, orthogonal, or curved routing; port snapping; labels
- **Port / anchor points** — every object has named attachment points (top/right/bottom/left/center + per-type extras)
- **Effects** — drop shadow and blur via Skia ImageFilter; stackable per-object
- **Radial gradient fill** — full radial gradient support alongside solid and linear gradient fills
- **Arrowheads** — `none`, `arrow`, `filled-arrow`, `circle`, `diamond` on line start/end
- **Spatial index** — R-tree hit testing; O(log n) even with thousands of objects
- **Viewport** — pan, zoom, fit-to-content, animated transitions
- **Event system** — hit-tested pointer events with screen + world coordinates, tap/doubletap touch support
- **Batch mutations** — `stage.batch(fn)` coalesces many changes into one undo entry
- **Z-order API** — `bringToFront`, `sendToBack`, `bringForward`, `sendBackward`
- **Group / ungroup** — `stage.groupObjects()` / `stage.ungroupObject()` with world-position preservation
- **Object mutation events** — `object:mutated` fires whenever position/size/rotation changes
- **Custom object types** — `stage.registerObject()` lets custom types survive `loadJSON()` round-trips
- **Scene query API** — `stage.find(predicate)`, `stage.findByType(type)`, `stage.getObjectById(id)`
- **Serialization** — versioned JSON scene format with migration support
- **TypeScript** — strict types throughout, zero `any` in public APIs

---

## Packages

| Package | Description |
|---|---|
| `@nexvas/core` | Scene graph, objects, events, viewport, plugin registry |
| `@nexvas/renderer` | CanvasKit loader and WebGL surface management |
| `@nexvas/plugin-selection` | Click, multi-select, marquee, move/resize/rotate handles; Shift=snap/aspect-ratio, Alt=center-anchored resize |
| `@nexvas/plugin-drag` | Draggable objects with optional constraints |
| `@nexvas/plugin-history` | Undo / redo stack (Ctrl+Z / Ctrl+Y); auto-records batch and z-order; named checkpoints |
| `@nexvas/plugin-grid` | Background grid (lines or dots) with snap-to-grid |
| `@nexvas/plugin-guides` | Smart alignment guides during drag |
| `@nexvas/plugin-export` | Export to PNG, JPEG, WebP, PDF via Skia |
| `@nexvas/plugin-align` | Align and distribute operations (left/center/right/top/bottom + distribute) |
| `@nexvas/plugin-clipboard` | Copy/cut/paste/duplicate with ID remapping; Ctrl+C/X/V/D shortcuts |
| `@nexvas/plugin-text-edit` | Inline text editing — double-click any Text object to edit in place |
| `@nexvas/plugin-pinch-zoom` | Touch pinch-to-zoom and optional one-finger pan |
| `@nexvas/plugin-ruler` | Horizontal + vertical canvas rulers that track pan/zoom; supports px/pt/mm/cm/in |
| `@nexvas/plugin-animate` | Tweening, easing, sequence/parallel animations |
| `@nexvas/plugin-connector` | Interactive connector drawing UI — drag from port to port |

---

## Quick Start

```bash
pnpm add @nexvas/core @nexvas/renderer
```

```ts
import { loadCanvasKit } from '@nexvas/renderer'
import { Stage, Rect, Circle, Color } from '@nexvas/core'

const ck = await loadCanvasKit()
const stage = new Stage({ canvas: document.getElementById('canvas'), canvasKit: ck })

// startLoop() waits for fonts — Text objects always render on the first frame
await stage.startLoop()

const layer = stage.addLayer()

layer.add(new Rect({
  x: 50, y: 50, width: 300, height: 200,
  cornerRadius: 12,
  fill: Color.hex('#3b82f6'),
  effects: [{ type: 'drop-shadow', offsetX: 4, offsetY: 4, blur: 8, color: { r: 0, g: 0, b: 0, a: 0.25 } }],
}))

layer.add(new Circle({
  x: 200, y: 150, width: 120, height: 120,
  fill: { type: 'radial-gradient', center: { x: 0.3, y: 0.3 }, radius: 0.8,
    stops: [{ offset: 0, color: { r: 1, g: 1, b: 1, a: 1 } }, { offset: 1, color: { r: 0.9, g: 0.3, b: 0.2, a: 1 } }] },
}))
```

### With plugins (diagram editor stack)

```ts
import { loadCanvasKit } from '@nexvas/renderer'
import { Stage, Rect } from '@nexvas/core'
import { SelectionPlugin } from '@nexvas/plugin-selection'
import { HistoryPlugin } from '@nexvas/plugin-history'
import { GridPlugin } from '@nexvas/plugin-grid'
import { AlignPlugin } from '@nexvas/plugin-align'
import { ClipboardPlugin } from '@nexvas/plugin-clipboard'
import { TextEditPlugin } from '@nexvas/plugin-text-edit'
import { ConnectorPlugin } from '@nexvas/plugin-connector'

const ck = await loadCanvasKit()
const stage = new Stage({ canvas, canvasKit: ck })

stage
  .use(new GridPlugin(), { cellSize: 20 })
  .use(new SelectionPlugin())
  .use(new HistoryPlugin())
  .use(new AlignPlugin())
  .use(new ClipboardPlugin())
  .use(new TextEditPlugin())
  .use(new ConnectorPlugin())

await stage.startLoop()
```

---

## Examples

Clone the repo and run any example locally:

```bash
git clone https://github.com/prashantprabhakar/nexvas.git
cd nexvas
pnpm install
pnpm --filter @nexvas/core run build
```

| Example | Run | Description |
|---|---|---|
| Basic | `pnpm --filter @nexvas-examples/basic dev` | Minimal stage setup with a Rect and Circle |
| Free Drawing | `pnpm --filter @nexvas-examples/free-drawing dev` | Freehand drawing with color picker and undo |

Each example has its own `README.md` with details.

---

## Browser Support

WebAssembly SIMD + WebGL2 required.

| Browser | Minimum version |
|---|---|
| Chrome | 91+ |
| Firefox | 89+ |
| Safari | 16.4+ |
| Edge | 91+ |

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup instructions, coding standards, and the PR process.

```bash
git clone https://github.com/prashantprabhakar/nexvas.git
cd nexvas
pnpm install
pnpm --filter @nexvas/core run build
pnpm run test
```

---

## License

[MIT](LICENSE)
