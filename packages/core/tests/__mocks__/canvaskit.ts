/**
 * Lightweight CanvasKit mock for unit tests.
 * Tracks draw calls so tests can assert what was drawn.
 */

export interface DrawCall {
  method: string
  args: unknown[]
}

export function createMockCanvas() {
  const calls: DrawCall[] = []

  const canvas = {
    calls,
    clear: (...args: unknown[]) => calls.push({ method: 'clear', args }),
    save: () => {
      calls.push({ method: 'save', args: [] })
      return 0
    },
    restore: () => calls.push({ method: 'restore', args: [] }),
    concat: (...args: unknown[]) => calls.push({ method: 'concat', args }),
    translate: (...args: unknown[]) => calls.push({ method: 'translate', args }),
    scale: (...args: unknown[]) => calls.push({ method: 'scale', args }),
    drawRect: (...args: unknown[]) => calls.push({ method: 'drawRect', args }),
    drawRRect: (...args: unknown[]) => calls.push({ method: 'drawRRect', args }),
    drawOval: (...args: unknown[]) => calls.push({ method: 'drawOval', args }),
    drawLine: (...args: unknown[]) => calls.push({ method: 'drawLine', args }),
    drawPath: (...args: unknown[]) => calls.push({ method: 'drawPath', args }),
    drawParagraph: (...args: unknown[]) => calls.push({ method: 'drawParagraph', args }),
    drawImageRect: (...args: unknown[]) => calls.push({ method: 'drawImageRect', args }),
    clipRect: (...args: unknown[]) => calls.push({ method: 'clipRect', args }),
    saveLayer: (...args: unknown[]) => {
      calls.push({ method: 'saveLayer', args })
      return 0
    },
  }
  return canvas
}

export function createMockPaint() {
  return {
    setStyle: () => {},
    setColor: () => {},
    setAntiAlias: () => {},
    setStrokeWidth: () => {},
    setStrokeCap: () => {},
    setStrokeJoin: () => {},
    setStrokeMiter: () => {},
    setShader: () => {},
    setAlphaf: () => {},
    setImageFilter: () => {},
    delete: () => {},
  }
}

export function createMockPath(containsResult = false) {
  return {
    contains: (_x: number, _y: number) => containsResult,
    getBounds: () => new Float32Array([0, 0, 100, 100]),
    delete: () => {},
  }
}

export function createMockSurface() {
  const canvas = createMockCanvas()
  return {
    canvas,
    getCanvas: () => canvas,
    flush: () => {},
    dispose: () => {},
  }
}

export function createMockParagraph(height = 20) {
  return {
    layout: () => {},
    getHeight: () => height,
    delete: () => {},
  }
}

const REQUIRED_TEXT_STYLE_FIELDS = [
  'color', 'decoration', 'decorationColor', 'decorationThickness', 'decorationStyle',
  'fontFamilies', 'fontSize', 'fontStyle', 'foregroundColor', 'backgroundColor',
  'heightMultiplier', 'halfLeading', 'letterSpacing', 'locale', 'shadows',
  'fontFeatures', 'fontVariations', 'textBaseline', 'wordSpacing',
]

export function createMockParagraphBuilder() {
  const para = createMockParagraph()
  return {
    pushStyle: (style: Record<string, unknown>) => {
      for (const field of REQUIRED_TEXT_STYLE_FIELDS) {
        if (!(field in style)) {
          throw new TypeError(`Missing field: "${field}"`)
        }
      }
      // Validate nested fontStyle fields
      const fs = style['fontStyle'] as Record<string, unknown> | undefined
      if (fs) {
        for (const field of ['weight', 'width', 'slant']) {
          if (!(field in fs)) throw new TypeError(`Missing field: "${field}"`)
        }
      }
    },
    addText: () => {},
    build: () => para,
    delete: () => {},
  }
}

/** Full mock CanvasKit instance matching the interface used in render() methods. */
export function createMockCK() {
  const surface = createMockSurface()

  return {
    surface,
    MakeWebGLCanvasSurface: () => surface,
    Color4f: (r: number, g: number, b: number, a: number) => new Float32Array([r, g, b, a]),
    ColorSpace: { SRGB: {} },
    Paint: class { constructor() { return createMockPaint() } } as unknown as new () => ReturnType<typeof createMockPaint>,
    PaintStyle: { Fill: 'Fill', Stroke: 'Stroke' },
    StrokeCap: { Butt: 'Butt', Round: 'Round', Square: 'Square' },
    StrokeJoin: { Miter: 'Miter', Round: 'Round', Bevel: 'Bevel' },
    TileMode: { Clamp: 'Clamp' },
    Shader: {
      MakeLinearGradient: () => null,
      MakeRadialGradient: () => null,
    },
    ClipOp: { Intersect: 'Intersect', Difference: 'Difference' },
    LTRBRect: (l: number, t: number, r: number, b: number) => new Float32Array([l, t, r, b]),
    RRectXY: (rect: Float32Array, rx: number, ry: number) =>
      new Float32Array([...rect, rx, ry, rx, ry, rx, ry, rx, ry]),
    Path: {
      MakeFromSVGString: (_svg: string) => createMockPath(),
    },
    TextAlign: { Left: 'Left', Center: 'Center', Right: 'Right' },
    FontWeight: { Normal: 400, Bold: 700, 400: 400, 700: 700 },
    FontWidth: { Normal: 5 },
    FontSlant: { Upright: 'Upright', Italic: 'Italic' },
    TextBaseline: { Alphabetic: 'Alphabetic', Ideographic: 'Ideographic' },
    DecorationStyle: { Solid: 'Solid', Double: 'Double', Dotted: 'Dotted', Dashed: 'Dashed', Wavy: 'Wavy' },
    ParagraphStyle: (opts: Record<string, unknown>) => opts,
    ParagraphBuilder: {
      Make: () => { throw new Error('Use MakeFromFontProvider instead of Make') },
      MakeFromFontProvider: (_style: unknown, _provider: unknown) => createMockParagraphBuilder(),
    },
    TypefaceFontProvider: {
      Make: () => ({
        registerFont: () => {},
      }),
    },
    MakeImageFromEncoded: () => null,
    FilterMode: { Linear: 'Linear' },
    MipmapMode: { Linear: 'Linear' },
    ImageFilter: {
      MakeDropShadow: (_dx: number, _dy: number, _sx: number, _sy: number, _color: Float32Array, _input: unknown) =>
        ({ delete: () => {} }),
      MakeBlur: (_sx: number, _sy: number, _tileMode: unknown, _input: unknown) =>
        ({ delete: () => {} }),
      MakeCompose: (_outer: unknown, _inner: unknown) =>
        ({ delete: () => {} }),
    },
  }
}

/** Create a minimal mock HTMLCanvasElement for tests. */
export function createMockHTMLCanvas(width = 800, height = 600): HTMLCanvasElement {
  return {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: () => null,
    getBoundingClientRect: () =>
      ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0 }) as DOMRect,
    addEventListener: () => {},
    removeEventListener: () => {},
    style: {} as CSSStyleDeclaration,
  } as unknown as HTMLCanvasElement
}
