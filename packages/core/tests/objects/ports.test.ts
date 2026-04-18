import { describe, it, expect } from 'vitest'
import { Rect } from '../../src/objects/Rect.js'
import { Circle } from '../../src/objects/Circle.js'
import { Group } from '../../src/objects/Group.js'

describe('Port / anchor points', () => {
  describe('getDefaultPorts()', () => {
    it('returns five ports with expected ids', () => {
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 60 })
      const ports = rect.getDefaultPorts()
      const ids = ports.map((p) => p.id)
      expect(ids).toEqual(['top', 'right', 'bottom', 'left', 'center'])
    })

    it('top port sits at relY=0 center-x', () => {
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 60 })
      const top = rect.getDefaultPorts().find((p) => p.id === 'top')!
      expect(top.relX).toBe(0.5)
      expect(top.relY).toBe(0)
    })

    it('center port sits at relX=0.5, relY=0.5', () => {
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 60 })
      const center = rect.getDefaultPorts().find((p) => p.id === 'center')!
      expect(center.relX).toBe(0.5)
      expect(center.relY).toBe(0.5)
    })
  })

  describe('getPorts()', () => {
    it('returns default ports when no custom ports set', () => {
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 60 })
      expect(rect.getPorts()).toHaveLength(5)
    })

    it('returns custom ports when set', () => {
      const custom = [{ id: 'a', relX: 0.25, relY: 0.75 }]
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 60, ports: custom })
      expect(rect.getPorts()).toEqual(custom)
    })
  })

  describe('getPortWorldPosition()', () => {
    it('returns null for unknown port id', () => {
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 60 })
      expect(rect.getPortWorldPosition('nonexistent')).toBeNull()
    })

    it('center port maps to center of unrotated rect', () => {
      const rect = new Rect({ x: 10, y: 20, width: 100, height: 60 })
      const pos = rect.getPortWorldPosition('center')!
      expect(pos.x).toBeCloseTo(60)  // 10 + 50
      expect(pos.y).toBeCloseTo(50)  // 20 + 30
    })

    it('top port maps to top-center of unrotated rect', () => {
      const rect = new Rect({ x: 10, y: 20, width: 100, height: 60 })
      const pos = rect.getPortWorldPosition('top')!
      expect(pos.x).toBeCloseTo(60)  // 10 + 50
      expect(pos.y).toBeCloseTo(20)  // top edge
    })

    it('right port maps to right-center of unrotated rect', () => {
      const rect = new Rect({ x: 10, y: 20, width: 100, height: 60 })
      const pos = rect.getPortWorldPosition('right')!
      expect(pos.x).toBeCloseTo(110) // 10 + 100
      expect(pos.y).toBeCloseTo(50)  // 20 + 30
    })

    it('left port maps to left-center of unrotated rect', () => {
      const rect = new Rect({ x: 10, y: 20, width: 100, height: 60 })
      const pos = rect.getPortWorldPosition('left')!
      expect(pos.x).toBeCloseTo(10)
      expect(pos.y).toBeCloseTo(50)
    })

    it('bottom port maps to bottom-center of unrotated rect', () => {
      const rect = new Rect({ x: 10, y: 20, width: 100, height: 60 })
      const pos = rect.getPortWorldPosition('bottom')!
      expect(pos.x).toBeCloseTo(60)
      expect(pos.y).toBeCloseTo(80)  // 20 + 60
    })

    it('center port accounts for rotation', () => {
      // A 100×60 rect at origin rotated 90° CCW (standard math convention).
      // Rotation matrix: cos90=0, sin90=1 → (x,y) → (-y, x)
      // center local = (50, 30) → x'=-30, y'=50
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 60, rotation: 90 })
      const pos = rect.getPortWorldPosition('center')!
      expect(pos.x).toBeCloseTo(-30, 5)
      expect(pos.y).toBeCloseTo(50, 5)
    })

    it('works for Circle — center port at circle center', () => {
      const circle = new Circle({ x: 50, y: 50, width: 80, height: 80 })
      const pos = circle.getPortWorldPosition('center')!
      expect(pos.x).toBeCloseTo(90) // 50 + 40
      expect(pos.y).toBeCloseTo(90) // 50 + 40
    })

    it('custom port world position is computed correctly', () => {
      const rect = new Rect({
        x: 0,
        y: 0,
        width: 200,
        height: 100,
        ports: [{ id: 'quarter', relX: 0.25, relY: 0.5 }],
      })
      const pos = rect.getPortWorldPosition('quarter')!
      expect(pos.x).toBeCloseTo(50)  // 0.25 * 200
      expect(pos.y).toBeCloseTo(50)  // 0.5 * 100
    })

    it('port position propagates through Group parent transform', () => {
      const group = new Group({ x: 100, y: 100 })
      const rect = new Rect({ x: 0, y: 0, width: 60, height: 40 })
      group.add(rect)
      // center of rect in local = (30, 20); group adds (100, 100) → world = (130, 120)
      const pos = rect.getPortWorldPosition('center')!
      expect(pos.x).toBeCloseTo(130)
      expect(pos.y).toBeCloseTo(120)
    })
  })

  describe('serialization', () => {
    it('does not persist ports when using defaults', () => {
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 60 })
      const json = rect.toJSON()
      expect(json.ports).toBeUndefined()
    })

    it('persists custom ports in JSON', () => {
      const custom = [{ id: 'hook', relX: 0.1, relY: 0.9 }]
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 60, ports: custom })
      const json = rect.toJSON()
      expect(json.ports).toEqual(custom)
    })

    it('round-trips custom ports through JSON', () => {
      const custom = [
        { id: 'a', relX: 0, relY: 0 },
        { id: 'b', relX: 1, relY: 1 },
      ]
      const rect = new Rect({ x: 0, y: 0, width: 100, height: 60, ports: custom })
      const json = rect.toJSON()
      const rect2 = Rect.fromJSON(json)
      expect(rect2.ports).toEqual(custom)
      expect(rect2.getPorts()).toEqual(custom)
    })

    it('round-trip with no custom ports leaves ports empty and defaults work', () => {
      const rect = new Rect({ x: 10, y: 20, width: 80, height: 40 })
      const json = rect.toJSON()
      const rect2 = Rect.fromJSON(json)
      expect(rect2.ports).toHaveLength(0)
      expect(rect2.getPorts()).toHaveLength(5)
    })
  })
})
