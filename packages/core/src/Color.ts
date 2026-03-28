import type { ColorRGBA, SolidFill } from './types.js'

/**
 * Utility for constructing NexVas colors and fills from common formats.
 *
 * NexVas stores colors as `{ r, g, b, a }` floats (0–1) to match CanvasKit's
 * native format. This helper lets you write colors in whatever format feels
 * natural and get the right type out.
 *
 * @example
 * ```ts
 * fill: Color.hex('#3b82f6')
 * fill: Color.hex('#3b82f6', 0.8)   // with alpha
 * fill: Color.rgb(59, 130, 246)
 * fill: Color.rgba(59, 130, 246, 0.8)
 * fill: Color.hsl(217, 91, 60)
 * stroke: Color.name('red')
 * stroke: Color.name('transparent')
 *
 * // Get just the ColorRGBA if you need it
 * const c: ColorRGBA = Color.toRGBA('#3b82f6')
 * ```
 */
export const Color = {
  // ---------------------------------------------------------------------------
  // SolidFill constructors (most common — use directly as `fill:` value)
  // ---------------------------------------------------------------------------

  /**
   * Hex color string → SolidFill.
   * Accepts `#rgb`, `#rrggbb`, `#rrggbbaa`.
   */
  hex(hex: string, alpha = 1): SolidFill {
    return { type: 'solid', color: hexToRGBA(hex, alpha) }
  },

  /**
   * CSS `rgb(r, g, b)` integers (0–255) → SolidFill.
   */
  rgb(r: number, g: number, b: number): SolidFill {
    return { type: 'solid', color: { r: r / 255, g: g / 255, b: b / 255, a: 1 } }
  },

  /**
   * CSS `rgba(r, g, b, a)` — integers 0–255 for color, 0–1 for alpha → SolidFill.
   */
  rgba(r: number, g: number, b: number, a: number): SolidFill {
    return { type: 'solid', color: { r: r / 255, g: g / 255, b: b / 255, a } }
  },

  /**
   * HSL values (h: 0–360, s: 0–100, l: 0–100) → SolidFill.
   */
  hsl(h: number, s: number, l: number, alpha = 1): SolidFill {
    return { type: 'solid', color: { ...hslToRGB(h, s, l), a: alpha } }
  },

  /**
   * Named CSS color → SolidFill.
   * Supports the ~140 standard CSS color names plus `'transparent'`.
   */
  name(name: string): SolidFill {
    if (name === 'transparent') return { type: 'solid', color: { r: 0, g: 0, b: 0, a: 0 } }
    const hex = CSS_COLORS[name.toLowerCase()]
    if (!hex) throw new Error(`[nexvas] Color.name: unknown color "${name}"`)
    return Color.hex(hex)
  },

  // ---------------------------------------------------------------------------
  // Raw ColorRGBA (use when you need the color object, not a fill)
  // ---------------------------------------------------------------------------

  /** Returns a raw `ColorRGBA` from a hex string. */
  toRGBA(hex: string, alpha = 1): ColorRGBA {
    return hexToRGBA(hex, alpha)
  },
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function hexToRGBA(hex: string, alpha: number): ColorRGBA {
  const h = hex.replace('#', '')

  let r: number, g: number, b: number, a = alpha

  if (h.length === 3) {
    r = parseInt(h[0]! + h[0]!, 16) / 255
    g = parseInt(h[1]! + h[1]!, 16) / 255
    b = parseInt(h[2]! + h[2]!, 16) / 255
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16) / 255
    g = parseInt(h.slice(2, 4), 16) / 255
    b = parseInt(h.slice(4, 6), 16) / 255
  } else if (h.length === 8) {
    r = parseInt(h.slice(0, 2), 16) / 255
    g = parseInt(h.slice(2, 4), 16) / 255
    b = parseInt(h.slice(4, 6), 16) / 255
    a = parseInt(h.slice(6, 8), 16) / 255
  } else {
    throw new Error(`[nexvas] Color.hex: invalid hex "${hex}"`)
  }

  if (isNaN(r) || isNaN(g) || isNaN(b)) {
    throw new Error(`[nexvas] Color.hex: invalid hex "${hex}"`)
  }

  return { r, g, b, a }
}

function hslToRGB(h: number, s: number, l: number): { r: number; g: number; b: number } {
  s /= 100
  l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: f(0), g: f(8), b: f(4) }
}

// ---------------------------------------------------------------------------
// Common CSS color names (subset — most frequently used)
// ---------------------------------------------------------------------------

const CSS_COLORS: Record<string, string> = {
  black:      '#000000', white:      '#ffffff', red:        '#ff0000',
  green:      '#008000', blue:       '#0000ff', yellow:     '#ffff00',
  orange:     '#ffa500', purple:     '#800080', pink:       '#ffc0cb',
  gray:       '#808080', grey:       '#808080', cyan:       '#00ffff',
  magenta:    '#ff00ff', lime:       '#00ff00', indigo:     '#4b0082',
  violet:     '#ee82ee', brown:      '#a52a2a', gold:       '#ffd700',
  silver:     '#c0c0c0', teal:       '#008080', navy:       '#000080',
  coral:      '#ff7f50', salmon:     '#fa8072', khaki:      '#f0e68c',
  lavender:   '#e6e6fa', maroon:     '#800000', olive:      '#808000',
  aqua:       '#00ffff', fuchsia:    '#ff00ff', crimson:    '#dc143c',
  tomato:     '#ff6347', turquoise:  '#40e0d0', sienna:     '#a0522d',
  tan:        '#d2b48c', plum:       '#dda0dd', orchid:     '#da70d6',
  beige:      '#f5f5dc', ivory:      '#fffff0', linen:      '#faf0e6',
  wheat:      '#f5deb3', snow:       '#fffafa', azure:      '#f0ffff',
  mintcream:  '#f5fffa', honeydew:   '#f0fff0', aliceblue:  '#f0f8ff',
  skyblue:    '#87ceeb', steelblue:  '#4682b4', royalblue:  '#4169e1',
  dodgerblue: '#1e90ff', deepskyblue:'#00bfff', mediumblue: '#0000cd',
  darkblue:   '#00008b', midnightblue:'#191970',lightgray:  '#d3d3d3',
  darkgray:   '#a9a9a9', dimgray:    '#696969', slategray:  '#708090',
  lightblue:  '#add8e6', lightgreen: '#90ee90', lightyellow:'#ffffe0',
  lightpink:  '#ffb6c1', lightsalmon:'#ffa07a', lightcoral: '#f08080',
}
