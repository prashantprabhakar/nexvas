import type { RenderContext, ColorRGBA } from './types.js'
import { makeTextStyle } from './text-utils.js'
import type { TextStyleCK } from './text-utils.js'

/** Style options for {@link drawLabel}. All fields are optional with sensible defaults. */
export interface LabelStyle {
  /** Text color. Default: opaque black. */
  color?: ColorRGBA
  /** Font size in CSS pixels. Default: 13. */
  fontSize?: number
  /** Font family name. Default: 'Noto Sans'. */
  fontFamily?: string
  /** Font weight. Default: 'normal'. */
  fontWeight?: 'normal' | 'bold'
  /** Line-height multiplier. Default: 1.2. */
  lineHeight?: number
  /** Horizontal text alignment within bounds. Default: 'center'. */
  align?: 'left' | 'center' | 'right'
}

// ---------------------------------------------------------------------------
// Minimal CanvasKit types required by drawLabel
// ---------------------------------------------------------------------------

interface DrawLabelCK extends TextStyleCK {
  ParagraphStyle(opts: { textAlign?: unknown; textStyle?: unknown }): unknown
  ParagraphBuilder: {
    MakeFromFontProvider(style: unknown, fontProvider: unknown): SkParagraphBuilder
  }
  TextAlign: { Left: unknown; Center: unknown; Right: unknown }
  FontWeight: { Normal: unknown; Bold: unknown }
  FontWidth: { Normal: unknown }
  FontSlant: { Upright: unknown }
}

interface SkParagraph {
  layout(width: number): void
  getHeight(): number
  delete(): void
}

interface SkParagraphBuilder {
  pushStyle(style: unknown): void
  addText(text: string): void
  build(): SkParagraph
  delete(): void
}

interface DrawLabelCanvas {
  drawParagraph(para: SkParagraph, x: number, y: number): void
}

/**
 * Render a text label centered within `bounds` using the NexVas font system.
 *
 * No-ops gracefully if `text` is empty, `ctx.fontManager` is unavailable, or
 * the requested font has not loaded yet.
 * Handles the full ParagraphBuilder lifecycle and WASM cleanup internally.
 *
 * @example
 * ```ts
 * drawLabel(ctx, this.label, { x, y, width, height }, {
 *   color: this.labelColor,
 *   fontSize: this.fontSize,
 *   fontFamily: this.fontFamily,
 * })
 * ```
 */
export function drawLabel(
  ctx: RenderContext,
  text: string,
  bounds: { x: number; y: number; width: number; height: number },
  style?: LabelStyle,
): void {
  if (!text || !ctx.fontManager) return

  const fontProvider = ctx.fontManager.getFontProvider()
  if (!fontProvider) return

  const ck = ctx.canvasKit as unknown as DrawLabelCK
  const canvas = ctx.skCanvas as unknown as DrawLabelCanvas

  const fontFamily = style?.fontFamily ?? 'Noto Sans'
  const fontSize = style?.fontSize ?? 13
  const lineHeight = style?.lineHeight ?? 1.2
  const align = style?.align ?? 'center'
  const fontWeight = style?.fontWeight ?? 'normal'

  const ckAlign =
    align === 'center' ? ck.TextAlign.Center
    : align === 'right' ? ck.TextAlign.Right
    : ck.TextAlign.Left

  const color = style?.color
    ? ck.Color4f(style.color.r, style.color.g, style.color.b, style.color.a)
    : ck.Color4f(0, 0, 0, 1)

  const paraStyle = ck.ParagraphStyle({
    textAlign: ckAlign,
    textStyle: { color: ck.Color4f(0, 0, 0, 1) },
  })

  const textStyle = makeTextStyle(ck, {
    color,
    fontFamilies: [fontFamily, 'Noto Sans'],
    fontSize,
    fontStyle: {
      weight: fontWeight === 'bold' ? ck.FontWeight.Bold : ck.FontWeight.Normal,
      width: ck.FontWidth.Normal,
      slant: ck.FontSlant.Upright,
    },
    heightMultiplier: lineHeight,
  })

  const builder = ck.ParagraphBuilder.MakeFromFontProvider(paraStyle, fontProvider)
  let para: SkParagraph | null = null
  try {
    builder.pushStyle(textStyle)
    builder.addText(text)
    para = builder.build()
    para.layout(bounds.width > 0 ? bounds.width : 10_000)
    const drawY = bounds.y + (bounds.height - para.getHeight()) / 2
    canvas.drawParagraph(para, bounds.x, drawY)
  } finally {
    para?.delete()
    builder.delete()
  }
}
