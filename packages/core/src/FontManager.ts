// ---------------------------------------------------------------------------
// Minimal CanvasKit interfaces for FontManager
// ---------------------------------------------------------------------------
interface CKTypeface {
  // opaque handle
}

interface CKFontMgr {
  // opaque handle
}

interface FontCK {
  Typeface: {
    MakeFreeTypeFaceFromData(data: ArrayBuffer): CKTypeface | null
  }
  FontMgr: {
    FromData(...buffers: ArrayBuffer[]): CKFontMgr | null
  }
  TypefaceFontProvider: {
    Make(): TypefaceFontProvider
  }
}

interface TypefaceFontProvider {
  registerFont(data: ArrayBuffer, family: string): void
  // implements CKFontMgr interface (used as font manager in Paragraph)
}

// Default Noto Sans via jsDelivr (Latin + extended)
const DEFAULT_FONT_URL =
  'https://cdn.jsdelivr.net/npm/@fontsource/noto-sans@5/files/noto-sans-latin-400-normal.woff2'
const DEFAULT_FONT_NAME = 'Noto Sans'

/**
 * Manages font loading for NexVas.
 *
 * CanvasKit does not use browser system fonts — all fonts must be explicitly
 * loaded as ArrayBuffers and registered with CanvasKit.
 *
 * @example
 * ```ts
 * await stage.fonts.load('Roboto', 'https://example.com/Roboto-Regular.ttf')
 * await stage.fonts.waitForReady()
 * ```
 */
export class FontManager {
  private _fontProvider: TypefaceFontProvider | null = null
  private _loadedFonts = new Map<string, ArrayBuffer>()
  private _pendingLoads: Promise<void>[] = []
  private _defaultFontUrl: string = DEFAULT_FONT_URL
  private _defaultFontLoaded = false
  private _onFontLoaded: (() => void) | null = null

  /** @internal — called by Stage so fonts trigger a re-render when they load. */
  setOnFontLoaded(fn: () => void): void {
    this._onFontLoaded = fn
  }

  /** @internal — called by Stage with the CanvasKit instance. */
  init(ck: unknown): void {
    this._fontProvider = (ck as FontCK).TypefaceFontProvider.Make()
    // Kick off default font load immediately
    this._loadDefaultFont()
  }

  /**
   * Override the URL used for the default Noto Sans font.
   * Must be called before any Text objects are rendered.
   */
  setDefaultFontUrl(url: string): void {
    this._defaultFontUrl = url
  }

  /**
   * Load a font by name from a URL or an ArrayBuffer.
   * Multiple weights/styles of the same family can be loaded under the same name.
   */
  load(name: string, source: string | ArrayBuffer): Promise<void> {
    const promise = this._doLoad(name, source)
    this._pendingLoads.push(promise)
    return promise
  }

  private async _doLoad(name: string, source: string | ArrayBuffer): Promise<void> {
    let data: ArrayBuffer
    if (typeof source === 'string') {
      const resp = await fetch(source)
      if (!resp.ok) {
        console.warn(
          `[nexvas] FontManager: failed to fetch font "${name}" from "${source}": ${resp.status}`,
        )
        return
      }
      data = await resp.arrayBuffer()
    } else {
      data = source
    }
    this._loadedFonts.set(name, data)
    this._fontProvider?.registerFont(data, name)
    this._onFontLoaded?.()
  }

  private _loadDefaultFont(): void {
    if (this._defaultFontLoaded) return
    this._defaultFontLoaded = true
    const promise = this._doLoad(DEFAULT_FONT_NAME, this._defaultFontUrl).catch((err: unknown) => {
      console.warn(
        `[nexvas] FontManager: failed to load default font: ${err instanceof Error ? err.message : String(err)}`,
      )
    })
    this._pendingLoads.push(promise)
  }

  /**
   * Returns true once all in-flight font loads have completed.
   */
  isReady(): boolean {
    // Check synchronously — we need to poll pending promises
    // This is a best-effort check; use waitForReady() for guaranteed accuracy
    return this._pendingLoads.length === 0
  }

  /**
   * Returns a Promise that resolves once all currently-loading fonts are ready.
   * Use this to ensure Text objects render correctly on first frame.
   *
   * @example
   * ```ts
   * await stage.fonts.waitForReady()
   * stage.render()
   * ```
   */
  async waitForReady(): Promise<void> {
    if (this._pendingLoads.length === 0) return
    await Promise.all(this._pendingLoads)
    this._pendingLoads = []
  }

  /**
   * Returns the CanvasKit TypefaceFontProvider (used as FontMgr for Paragraph building).
   * @internal
   */
  getFontProvider(): unknown {
    return this._fontProvider
  }

  /**
   * Returns true if a font with the given name has been loaded.
   */
  hasFont(name: string): boolean {
    return this._loadedFonts.has(name)
  }
}
