import type { Vec2 } from './Vec2.js'

/**
 * Immutable 3x3 matrix for 2D affine transforms.
 * Stored in row-major order: [a, b, c, d, e, f, g, h, i]
 *
 *  | a  b  c |
 *  | d  e  f |
 *  | g  h  i |
 *
 * For 2D affine transforms, g/h are always 0 and i is always 1.
 */
export class Matrix3x3 {
  /** Column-major flat array of 9 values. */
  readonly values: readonly [number, number, number, number, number, number, number, number, number]

  constructor(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
    g: number,
    h: number,
    i: number,
  ) {
    this.values = [a, b, c, d, e, f, g, h, i]
  }

  static readonly IDENTITY = new Matrix3x3(1, 0, 0, 0, 1, 0, 0, 0, 1)

  static translation(tx: number, ty: number): Matrix3x3 {
    return new Matrix3x3(1, 0, tx, 0, 1, ty, 0, 0, 1)
  }

  static rotation(radians: number): Matrix3x3 {
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    return new Matrix3x3(cos, -sin, 0, sin, cos, 0, 0, 0, 1)
  }

  static scale(sx: number, sy: number): Matrix3x3 {
    return new Matrix3x3(sx, 0, 0, 0, sy, 0, 0, 0, 1)
  }

  /**
   * Single-pass TRS factory: translate → rotate → scale.
   * Equivalent to `translation(tx,ty).multiply(rotation(r)).multiply(scale(sx,sy))`
   * but allocates only one matrix.
   */
  static fromTRS(tx: number, ty: number, radians: number, sx: number, sy: number): Matrix3x3 {
    const cos = Math.cos(radians)
    const sin = Math.sin(radians)
    return new Matrix3x3(cos * sx, -sin * sy, tx, sin * sx, cos * sy, ty, 0, 0, 1)
  }

  multiply(other: Matrix3x3): Matrix3x3 {
    const [a, b, c, d, e, f, g, h, i] = this.values
    const [j, k, l, m, n, o, p, q, r] = other.values
    return new Matrix3x3(
      a * j + b * m + c * p,
      a * k + b * n + c * q,
      a * l + b * o + c * r,
      d * j + e * m + f * p,
      d * k + e * n + f * q,
      d * l + e * o + f * r,
      g * j + h * m + i * p,
      g * k + h * n + i * q,
      g * l + h * o + i * r,
    )
  }

  /** Apply this transform to a 2D point. */
  transformPoint(x: number, y: number): { x: number; y: number } {
    const [a, b, c, d, e, f] = this.values
    return {
      x: a * x + b * y + c,
      y: d * x + e * y + f,
    }
  }

  /** Apply this transform to a Vec2. */
  transformVec2(v: Vec2): { x: number; y: number } {
    return this.transformPoint(v.x, v.y)
  }

  inverse(): Matrix3x3 {
    const [a, b, c, d, e, f, g, h, i] = this.values
    const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
    if (Math.abs(det) < 1e-10) {
      throw new Error('Matrix is not invertible')
    }
    const inv = 1 / det
    return new Matrix3x3(
      (e * i - f * h) * inv,
      (c * h - b * i) * inv,
      (b * f - c * e) * inv,
      (f * g - d * i) * inv,
      (a * i - c * g) * inv,
      (c * d - a * f) * inv,
      (d * h - e * g) * inv,
      (b * g - a * h) * inv,
      (a * e - b * d) * inv,
    )
  }

  equals(other: Matrix3x3, epsilon = 1e-10): boolean {
    return this.values.every((v, i) => Math.abs(v - (other.values[i] ?? 0)) < epsilon)
  }

  /**
   * Returns a flat 6-element affine array [a, b, c, d, e, f]
   * compatible with CanvasKit's concat() and DOMMatrix.
   */
  toAffine6(): [number, number, number, number, number, number] {
    const [a, b, c, d, e, f] = this.values
    return [a, b, d, e, c, f]
  }
}
