/**
 * Shared text-style utilities for CanvasKit paragraph rendering.
 *
 * CanvasKit's ParagraphBuilder.pushStyle() validates the style struct at
 * runtime and throws for each missing field. This module owns the complete
 * field list so every consumer gets a compile-time error instead.
 */

// ---------------------------------------------------------------------------
// Minimal CanvasKit slice required by makeTextStyle
// ---------------------------------------------------------------------------

/** Minimal CanvasKit interface required to call {@link makeTextStyle}. */
export interface TextStyleCK {
  Color4f(r: number, g: number, b: number, a: number): Float32Array
  DecorationStyle: { Solid: unknown }
  FontWeight: { Normal: unknown; [key: number]: unknown }
  FontWidth: { Normal: unknown }
  FontSlant: { Upright: unknown }
  TextBaseline: { Alphabetic: unknown }
}

// ---------------------------------------------------------------------------
// SkTextStyle — the complete struct CanvasKit requires at runtime
// ---------------------------------------------------------------------------

/**
 * All fields required by CanvasKit's TextStyle at runtime.
 *
 * Pass this to `ParagraphBuilder.pushStyle()`. CanvasKit validates the struct
 * strictly — omitting any field throws `TypeError: Missing field: "<name>"`.
 * Use {@link makeTextStyle} to construct a safe instance with defaults.
 */
export interface SkTextStyle {
  color: Float32Array
  decoration: number
  decorationColor: Float32Array
  decorationThickness: number
  decorationStyle: unknown
  fontFamilies: string[]
  fontSize: number
  fontStyle: { weight: unknown; width: unknown; slant: unknown }
  /** Must be transparent (alpha=0) when `color` is used; CanvasKit treats non-zero foregroundColor as an override. */
  foregroundColor: Float32Array
  /** Must be transparent (alpha=0) for no background tint. */
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Options accepted by {@link makeTextStyle}. All fields are optional; defaults are applied for omitted ones. */
export interface MakeTextStyleOpts {
  /** Text colour. Defaults to opaque black. */
  color?: Float32Array
  /** Font family list, tried in order. Defaults to `['Noto Sans']`. */
  fontFamilies?: string[]
  /** Font size in CSS pixels. Defaults to `16`. */
  fontSize?: number
  /** Font weight, width, and slant. Defaults to Normal/Normal/Upright. */
  fontStyle?: { weight?: unknown; width?: unknown; slant?: unknown }
  /** Line-height multiplier. Defaults to `1.2`. */
  heightMultiplier?: number
  /** Extra spacing between letters. Defaults to `0`. */
  letterSpacing?: number
  /** Extra spacing between words. Defaults to `0`. */
  wordSpacing?: number
  /** BCP 47 locale string. Defaults to `''`. */
  locale?: string
  /** Underline/overline/strikethrough flags. Defaults to `0` (none). */
  decoration?: number
  decorationColor?: Float32Array
  decorationThickness?: number
  decorationStyle?: unknown
  halfLeading?: boolean
}

/**
 * Build a fully-populated {@link SkTextStyle} with safe defaults.
 *
 * @example
 * ```ts
 * const style = makeTextStyle(ck, {
 *   color: ck.Color4f(0.2, 0.2, 0.8, 1),
 *   fontFamilies: ['Inter', 'Noto Sans'],
 *   fontSize: 14,
 * })
 * builder.pushStyle(style)
 * ```
 */
export function makeTextStyle(ck: TextStyleCK, opts: MakeTextStyleOpts = {}): SkTextStyle {
  return {
    color: opts.color ?? ck.Color4f(0, 0, 0, 1),
    decoration: opts.decoration ?? 0,
    decorationColor: opts.decorationColor ?? ck.Color4f(0, 0, 0, 1),
    decorationThickness: opts.decorationThickness ?? 0,
    decorationStyle: opts.decorationStyle ?? ck.DecorationStyle.Solid,
    fontFamilies: opts.fontFamilies ?? ['Noto Sans'],
    fontSize: opts.fontSize ?? 16,
    fontStyle: {
      weight: opts.fontStyle?.weight ?? ck.FontWeight.Normal,
      width: opts.fontStyle?.width ?? ck.FontWidth.Normal,
      slant: opts.fontStyle?.slant ?? ck.FontSlant.Upright,
    },
    foregroundColor: ck.Color4f(0, 0, 0, 0),
    backgroundColor: ck.Color4f(0, 0, 0, 0),
    heightMultiplier: opts.heightMultiplier ?? 1.2,
    halfLeading: opts.halfLeading ?? false,
    letterSpacing: opts.letterSpacing ?? 0,
    locale: opts.locale ?? '',
    shadows: [],
    fontFeatures: [],
    fontVariations: [],
    textBaseline: ck.TextBaseline.Alphabetic,
    wordSpacing: opts.wordSpacing ?? 0,
  }
}
