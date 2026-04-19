import { describe, it, expect } from 'vitest'
import { Matrix3x3 } from '../../src/math/Matrix3x3.js'

describe('Matrix3x3', () => {
  it('IDENTITY is identity', () => {
    const m = Matrix3x3.IDENTITY
    expect(m.transformPoint(5, 3)).toEqual({ x: 5, y: 3 })
  })

  it('translation moves a point', () => {
    const m = Matrix3x3.translation(10, 20)
    expect(m.transformPoint(0, 0)).toEqual({ x: 10, y: 20 })
    expect(m.transformPoint(5, 5)).toEqual({ x: 15, y: 25 })
  })

  it('scale scales a point', () => {
    const m = Matrix3x3.scale(2, 3)
    expect(m.transformPoint(4, 5)).toEqual({ x: 8, y: 15 })
  })

  it('rotation rotates 90 degrees', () => {
    const m = Matrix3x3.rotation(Math.PI / 2)
    const p = m.transformPoint(1, 0)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(1)
  })

  it('multiply composes transforms', () => {
    const translate = Matrix3x3.translation(10, 0)
    const scale = Matrix3x3.scale(2, 2)
    // translate then scale: point (0,0) → translate → (10,0) → scale → (20,0)
    const combined = scale.multiply(translate)
    expect(combined.transformPoint(0, 0)).toEqual({ x: 20, y: 0 })
  })

  it('inverse undoes the transform', () => {
    const m = Matrix3x3.translation(5, 7)
    const inv = m.inverse()
    const p = inv.transformPoint(5, 7)
    expect(p.x).toBeCloseTo(0)
    expect(p.y).toBeCloseTo(0)
  })

  it('inverse of scale', () => {
    const m = Matrix3x3.scale(4, 2)
    const inv = m.inverse()
    const p = inv.transformPoint(8, 6)
    expect(p.x).toBeCloseTo(2)
    expect(p.y).toBeCloseTo(3)
  })

  it('throws on non-invertible matrix', () => {
    const m = Matrix3x3.scale(0, 0)
    expect(() => m.inverse()).toThrow()
  })

  it('equals with epsilon', () => {
    const a = Matrix3x3.translation(1.000001, 2)
    const b = Matrix3x3.translation(1, 2)
    expect(a.equals(b, 1e-4)).toBe(true)
    expect(a.equals(b, 1e-10)).toBe(false)
  })

  it('values is 9-element row-major', () => {
    const m = Matrix3x3.translation(3, 7)
    expect(m.values).toHaveLength(9)
    // [1,0,3, 0,1,7, 0,0,1]
    expect(m.values[2]).toBe(3) // translateX
    expect(m.values[5]).toBe(7) // translateY
  })

  it('toAffine6 returns 6 elements', () => {
    const m = Matrix3x3.translation(3, 7)
    expect(m.toAffine6()).toHaveLength(6)
  })

  it('fromTRS matches chained translation/rotation/scale', () => {
    const tx = 5, ty = -3, r = Math.PI / 4, sx = 2, sy = 0.5
    const chained = Matrix3x3.translation(tx, ty)
      .multiply(Matrix3x3.rotation(r))
      .multiply(Matrix3x3.scale(sx, sy))
    const fast = Matrix3x3.fromTRS(tx, ty, r, sx, sy)
    expect(fast.equals(chained)).toBe(true)
  })

  it('fromTRS identity params give identity matrix', () => {
    const m = Matrix3x3.fromTRS(0, 0, 0, 1, 1)
    expect(m.equals(Matrix3x3.IDENTITY)).toBe(true)
  })
})
