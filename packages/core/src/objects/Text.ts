import { BaseObject, type BaseObjectProps } from './BaseObject.js'
import { BoundingBox } from '../math/BoundingBox.js'
import { colorToCK, type PaintCK } from '../renderer/paint.js'
import type { RenderContext, ObjectJSON } from '../types.js'

export type TextAlign = 'left' | 'center' | 'right'
export type TextBaseline = 'top' | 'middle' | 'bottom'

export interface TextProps extends BaseObjectProps {
  text?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  fontStyle?: 'normal' | 'italic'
  align?: TextAlign
  baseline?: TextBaseline
  lineHeight?: number
}

// ---------------------------------------------------------------------------
// Minimal CanvasKit types for Text rendering
// ---------------------------------------------------------------------------

interface SkParagraph {
  layout(width: number): void
  getHeight(): number
  delete(): void
}

/**
 * All fields required by CanvasKit's TextStyle at runtime.
 * CanvasKit validates this struct strictly — missing any field throws at runtime.
 * Typed explicitly here so TypeScript catches omissions at compile time.
 */
interface SkTextStyle {
  color: Float32Array
  decoration: number
  decorationColor: Float32Array
  decorationThickness: number
  decorationStyle: unknown
  fontFamilies: string[]
  fontSize: number
  fontStyle: { weight: unknown; width: unknown; slant: unknown }
  foregroundColor: Float32Array
  backgroundColor: Float32Array
  heightMultiplier: number
  halfLeading: boolean
  letterSpacing: number
  locale: string
  shadows: unknown[]
  fontFeatures: unknown[]
  fontVariations: unknown[]
  textBaseline: unknown
  wordSpacing: number
}

interface SkParagraphBuilder {
  pushStyle(style: SkTextStyle): void
  addText(text: string): void
  build(): SkParagraph
  delete(): void
}

interface SkCanvas {
  save(): number
  restore(): void
  concat(matrix: number[]): void
  translate(dx: number, dy: number): void
  drawParagraph(para: SkParagraph, x: number, y: number): void
}

interface TextCK extends PaintCK {
  ParagraphStyle(opts: { textAlign?: unknown; textStyle?: unknown; strutStyle?: unknown }): unknown
  ParagraphBuilder: {
    Make(style: unknown, fontManager: unknown): SkParagraphBuilder
    MakeFromFontProvider(style: unknown, fontProvider: unknown): SkParagraphBuilder
  }
  TextAlign: { Left: unknown; Center: unknown; Right: unknown }
  FontWeight: { Normal: unknown; Bold: unknown; [key: number]: unknown }
  FontWidth: { Normal: unknown }
  FontSlant: { Upright: unknown; Italic: unknown }
  TextBaseline: { Alphabetic: unknown; Ideographic: unknown }
  DecorationStyle: { Solid: unknown }
}

/** Single or multi-line text object. Rendered via CanvasKit's paragraph API for proper shaping. */
export class Text extends BaseObject {
  text: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  fontStyle: 'normal' | 'italic'
  align: TextAlign
  baseline: TextBaseline
  lineHeight: number

  /** Cached paragraph — invalidated when text or style properties change. */
  private _paragraph: SkParagraph | null = null
  private _paraLayoutWidth = -1

  constructor(props: TextProps = {}) {
    super(props)
    this.text = props.text ?? ''
    this.fontFamily = props.fontFamily ?? 'Noto Sans'
    this.fontSize = props.fontSize ?? 16
    this.fontWeight = props.fontWeight ?? 400
    this.fontStyle = props.fontStyle ?? 'normal'
    this.align = props.align ?? 'left'
    this.baseline = props.baseline ?? 'top'
    this.lineHeight = props.lineHeight ?? 1.2
  }

  getType(): string {
    return 'Text'
  }

  getLocalBoundingBox(): BoundingBox {
    return new BoundingBox(0, 0, this.width, this.height)
  }

  /** Invalidate the cached paragraph (call after changing text or style props). */
  invalidate(): void {
    this._paragraph?.delete()
    this._paragraph = null
    this._paraLayoutWidth = -1
  }

  private _buildParagraph(ck: TextCK, fontMgr: unknown): SkParagraph {
    const ckAlign =
      this.align === 'center'
        ? ck.TextAlign.Center
        : this.align === 'right'
          ? ck.TextAlign.Right
          : ck.TextAlign.Left

    const paraStyle = ck.ParagraphStyle({ textAlign: ckAlign, textStyle: { color: ck.Color4f(0, 0, 0, 1) } })

    const textStyle = {
      color: this.fill
        ? colorToCK(ck, this.fill.type === 'solid' ? this.fill.color : { r: 0, g: 0, b: 0, a: 1 })
        : ck.Color4f(0, 0, 0, 1),
      decoration: 0,
      decorationColor: ck.Color4f(0, 0, 0, 1),
      decorationThickness: 0,
      decorationStyle: ck.DecorationStyle.Solid,
      fontFamilies: [this.fontFamily, 'Noto Sans'],
      fontSize: this.fontSize,
      fontStyle: {
        weight: ck.FontWeight[this.fontWeight] ?? ck.FontWeight.Normal,
        width: ck.FontWidth.Normal,
        slant: this.fontStyle === 'italic' ? ck.FontSlant.Italic : ck.FontSlant.Upright,
      },
      foregroundColor: ck.Color4f(0, 0, 0, 0),
      backgroundColor: ck.Color4f(0, 0, 0, 0),
      heightMultiplier: this.lineHeight,
      halfLeading: false,
      letterSpacing: 0,
      locale: '',
      shadows: [],
      fontFeatures: [],
      fontVariations: [],
      textBaseline: ck.TextBaseline.Alphabetic,
      wordSpacing: 0,
    }

    const builder = ck.ParagraphBuilder.MakeFromFontProvider(paraStyle, fontMgr)
    builder.pushStyle(textStyle)
    builder.addText(this.text)
    const para = builder.build()
    builder.delete()
    return para
  }

  render(ctx: RenderContext): void {
    if (!this.visible || !ctx.skCanvas || !this.text) return

    const ck = ctx.canvasKit as TextCK
    const canvas = ctx.skCanvas as SkCanvas
    const fontMgr = ctx.fontManager

    if (!fontMgr) return

    if (!fontMgr.hasFont(this.fontFamily) && !fontMgr.hasFont('Noto Sans')) {
      console.warn(
        `[nexvas] Text: font "${this.fontFamily}" not loaded yet — skipping render. ` +
          'Call stage.fonts.waitForReady() before first render.',
      )
      return
    }

    const fontProvider = fontMgr.getFontProvider()
    if (!fontProvider) return

    canvas.save()
    canvas.concat(Array.from(this.getLocalTransform().values))

    // Build or reuse cached paragraph
    if (!this._paragraph || this._paraLayoutWidth !== this.width) {
      this._paragraph?.delete()
      this._paragraph = this._buildParagraph(ck, fontProvider)
      const layoutWidth = this.width > 0 ? this.width : 10_000
      this._paragraph.layout(layoutWidth)
      this._paraLayoutWidth = this.width
    }

    // Vertical baseline offset
    let offsetY = 0
    if (this.baseline === 'middle') {
      offsetY = (this.height - this._paragraph.getHeight()) / 2
    } else if (this.baseline === 'bottom') {
      offsetY = this.height - this._paragraph.getHeight()
    }

    if (offsetY !== 0) canvas.translate(0, offsetY)
    canvas.drawParagraph(this._paragraph, 0, 0)

    canvas.restore()
  }

  toJSON(): ObjectJSON {
    return {
      ...super.toJSON(),
      text: this.text,
      fontFamily: this.fontFamily,
      fontSize: this.fontSize,
      fontWeight: this.fontWeight,
      fontStyle: this.fontStyle,
      align: this.align,
      baseline: this.baseline,
      lineHeight: this.lineHeight,
    }
  }

  static fromJSON(json: ObjectJSON): Text {
    const obj = new Text()
    obj.applyBaseJSON(json)
    if (json['text'] !== undefined) obj.text = json['text'] as string
    if (json['fontFamily'] !== undefined) obj.fontFamily = json['fontFamily'] as string
    if (json['fontSize'] !== undefined) obj.fontSize = json['fontSize'] as number
    if (json['fontWeight'] !== undefined) obj.fontWeight = json['fontWeight'] as number
    if (json['fontStyle'] !== undefined) obj.fontStyle = json['fontStyle'] as 'normal' | 'italic'
    if (json['align'] !== undefined) obj.align = json['align'] as TextAlign
    if (json['baseline'] !== undefined) obj.baseline = json['baseline'] as TextBaseline
    if (json['lineHeight'] !== undefined) obj.lineHeight = json['lineHeight'] as number
    return obj
  }

  destroy(): void {
    this._paragraph?.delete()
    this._paragraph = null
    super.destroy()
  }
}
