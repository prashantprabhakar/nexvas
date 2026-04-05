import type { Plugin, StageInterface, RenderContext, Layer } from '@nexvas/core'

// ---------------------------------------------------------------------------
// CanvasKit interface fragments for export
// ---------------------------------------------------------------------------
interface ExportCK {
  MakeWebGLCanvasSurface(canvas: unknown, colorSpace?: unknown): SkSurface | null
  Color4f(r: number, g: number, b: number, a: number): Float32Array
  ColorSpace: { SRGB: unknown }
  ImageFormat: { PNG: unknown; JPEG: unknown; WEBP: unknown }
  MakeSurface(w: number, h: number): SkSurface | null
  MakeRasterDirectSurface(info: unknown, pixels: unknown, bytesPerRow: number): SkSurface | null
  MakeRenderTarget(ctx: unknown, w: number, h: number): SkSurface | null
  MakePDFDocument(): SkPDFDocument | null
}

interface SkSurface {
  getCanvas(): SkCanvas
  makeImageSnapshot(bounds?: number[]): SkImage
  flush(): void
  delete(): void
  width(): number
  height(): number
}

interface SkCanvas {
  clear(color: Float32Array): void
  save(): number
  restore(): void
  translate(x: number, y: number): void
  scale(sx: number, sy: number): void
}

interface SkImage {
  encodeToBytes(format?: unknown, quality?: number): Uint8Array<ArrayBuffer> | null
  delete(): void
}

interface SkPDFDocument {
  beginPage(w: number, h: number): SkCanvas
  endPage(): void
  close(): Uint8Array<ArrayBuffer>
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /**
   * Region to export in world space.
   * Defaults to the bounding box of all content.
   */
  region?: { x: number; y: number; width: number; height: number }
  /**
   * Pixel scale factor for rasterised formats. Default: 1.
   */
  scale?: number
  /**
   * Background fill color. Pass `null` for transparent. Default: null.
   */
  background?: { r: number; g: number; b: number; a: number } | null
}

export interface ExportPluginOptions {
  // No constructor-time options required.
}

/**
 * Type augmentation for accessing ExportPlugin through the stage.
 * @example
 * const exporter = (stage as ExportPluginAPI).export
 */
export interface ExportPluginAPI {
  export: ExportPlugin
}

/**
 * ExportPlugin — export the canvas content to PNG, JPEG, WebP, or PDF.
 *
 * Uses an offscreen CanvasKit surface to render the scene at an arbitrary
 * resolution without touching the visible canvas.
 */
export class ExportPlugin implements Plugin {
  readonly name = 'export'
  readonly version = '0.1.0'

  private _stage: StageInterface | null = null

  constructor(_options: ExportPluginOptions = {}) {}

  // ---------------------------------------------------------------------------
  // Plugin lifecycle
  // ---------------------------------------------------------------------------

  install(stage: StageInterface): void {
    this._stage = stage
    ;(stage as unknown as ExportPluginAPI).export = this
  }

  uninstall(_stage: StageInterface): void {
    this._stage = null
  }

  // ---------------------------------------------------------------------------
  // Export API
  // ---------------------------------------------------------------------------

  /** Export to PNG. Returns a Blob ready for download. */
  async exportPNG(options: ExportOptions = {}): Promise<Blob> {
    const bytes = await this._renderToBytes(options, 'png')
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'image/png' })
  }

  /** Export to JPEG. `quality` is 0–100, default 90. */
  async exportJPEG(options: ExportOptions = {}, quality = 90): Promise<Blob> {
    const bytes = await this._renderToBytes(options, 'jpeg', quality)
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'image/jpeg' })
  }

  /** Export to WebP. `quality` is 0–100, default 90. */
  async exportWebP(options: ExportOptions = {}, quality = 90): Promise<Blob> {
    const bytes = await this._renderToBytes(options, 'webp', quality)
    return new Blob([bytes.buffer as ArrayBuffer], { type: 'image/webp' })
  }

  /** Export to PDF. Returns a Blob containing the PDF bytes. */
  async exportPDF(options: ExportOptions = {}): Promise<Blob> {
    if (!this._stage) throw new Error('[ExportPlugin] Plugin is not installed.')
    const ck = this._stage.canvasKit as ExportCK
    const region = this._resolveRegion(options)
    const scale = options.scale ?? 1
    const w = region.width * scale
    const h = region.height * scale

    const doc = ck.MakePDFDocument()
    if (!doc) throw new Error('[ExportPlugin] Failed to create PDF document.')

    const canvas = doc.beginPage(w, h)
    this._renderScene(canvas, ck, region, scale, options.background ?? null)
    doc.endPage()

    const pdfBytes = doc.close()
    return new Blob([pdfBytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private _resolveRegion(options: ExportOptions): {
    x: number
    y: number
    width: number
    height: number
  } {
    if (options.region) return options.region
    if (!this._stage) return { x: 0, y: 0, width: 800, height: 600 }

    const bb = this._stage.getBoundingBox()
    if (bb.width === 0 && bb.height === 0) return { x: 0, y: 0, width: 800, height: 600 }
    return { x: bb.x, y: bb.y, width: bb.width, height: bb.height }
  }

  private async _renderToBytes(
    options: ExportOptions,
    format: 'png' | 'jpeg' | 'webp',
    quality = 90,
  ): Promise<Uint8Array> {
    if (!this._stage) throw new Error('[ExportPlugin] Plugin is not installed.')
    const ck = this._stage.canvasKit as ExportCK
    const region = this._resolveRegion(options)
    const scale = options.scale ?? 1
    const w = Math.ceil(region.width * scale)
    const h = Math.ceil(region.height * scale)

    const surface = ck.MakeSurface(w, h)
    if (!surface) throw new Error('[ExportPlugin] Failed to create offscreen surface.')

    try {
      const canvas = surface.getCanvas()
      this._renderScene(canvas, ck, region, scale, options.background ?? null)
      surface.flush()

      const img = surface.makeImageSnapshot()
      const fmt =
        format === 'jpeg'
          ? ck.ImageFormat.JPEG
          : format === 'webp'
            ? ck.ImageFormat.WEBP
            : ck.ImageFormat.PNG
      const bytes = img.encodeToBytes(fmt, quality)
      img.delete()

      if (!bytes) throw new Error('[ExportPlugin] Image encoding failed.')
      return bytes
    } finally {
      surface.delete()
    }
  }

  private _renderScene(
    canvas: SkCanvas,
    ck: ExportCK,
    region: { x: number; y: number; width: number; height: number },
    scale: number,
    background: { r: number; g: number; b: number; a: number } | null,
  ): void {
    if (!this._stage) return

    if (background) {
      canvas.clear(ck.Color4f(background.r, background.g, background.b, background.a))
    } else {
      canvas.clear(ck.Color4f(0, 0, 0, 0))
    }

    canvas.save()
    canvas.scale(scale, scale)
    canvas.translate(-region.x, -region.y)

    const ctx: RenderContext = {
      skCanvas: canvas,
      canvasKit: this._stage.canvasKit,
      fontManager: this._stage.fonts,
      pixelRatio: scale,
      viewport: {
        x: -region.x * scale,
        y: -region.y * scale,
        scale,
        width: region.width,
        height: region.height,
      },
    }

    for (const layer of this._stage.layers as unknown as Layer[]) {
      layer.render(ctx)
    }

    canvas.restore()
  }
}
