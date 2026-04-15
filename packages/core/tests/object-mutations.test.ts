import { describe, it, expect } from 'vitest'
import { Stage } from '../src/Stage.js'
import { Rect } from '../src/objects/Rect.js'
import { Circle } from '../src/objects/Circle.js'
import { createMockCK, createMockHTMLCanvas } from './__mocks__/canvaskit.js'
import type { ObjectMutationEvent } from '../src/types.js'

function makeStage() {
  const ck = createMockCK()
  const canvas = createMockHTMLCanvas()
  return { stage: new Stage({ canvas, canvasKit: ck }), ck, canvas }
}

describe('Object Mutations - NV-029', () => {
  it('fires object:mutated event when x property changes', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.x = 50

    expect(mutations).toHaveLength(1)
    expect(mutations[0].object).toBe(rect)
    expect(mutations[0].property).toBe('x')
    expect(mutations[0].oldValue).toBe(10)
    expect(mutations[0].newValue).toBe(50)
  })

  it('fires object:mutated event when y property changes', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.y = 100

    expect(mutations).toHaveLength(1)
    expect(mutations[0].object).toBe(rect)
    expect(mutations[0].property).toBe('y')
    expect(mutations[0].oldValue).toBe(20)
    expect(mutations[0].newValue).toBe(100)
  })

  it('fires object:mutated event when width property changes', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.width = 200

    expect(mutations).toHaveLength(1)
    expect(mutations[0].object).toBe(rect)
    expect(mutations[0].property).toBe('width')
    expect(mutations[0].oldValue).toBe(100)
    expect(mutations[0].newValue).toBe(200)
  })

  it('fires object:mutated event when height property changes', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.height = 150

    expect(mutations).toHaveLength(1)
    expect(mutations[0].object).toBe(rect)
    expect(mutations[0].property).toBe('height')
    expect(mutations[0].oldValue).toBe(50)
    expect(mutations[0].newValue).toBe(150)
  })

  it('fires object:mutated event when rotation property changes', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50, rotation: 0 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.rotation = 45

    expect(mutations).toHaveLength(1)
    expect(mutations[0].object).toBe(rect)
    expect(mutations[0].property).toBe('rotation')
    expect(mutations[0].oldValue).toBe(0)
    expect(mutations[0].newValue).toBe(45)
  })

  it('fires object:mutated event when scaleX property changes', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50, scaleX: 1 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.scaleX = 2

    expect(mutations).toHaveLength(1)
    expect(mutations[0].object).toBe(rect)
    expect(mutations[0].property).toBe('scaleX')
    expect(mutations[0].oldValue).toBe(1)
    expect(mutations[0].newValue).toBe(2)
  })

  it('fires object:mutated event when scaleY property changes', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50, scaleY: 1 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.scaleY = 0.5

    expect(mutations).toHaveLength(1)
    expect(mutations[0].object).toBe(rect)
    expect(mutations[0].property).toBe('scaleY')
    expect(mutations[0].oldValue).toBe(1)
    expect(mutations[0].newValue).toBe(0.5)
  })

  it('fires object:mutated event when skewX property changes', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50, skewX: 0 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.skewX = 15

    expect(mutations).toHaveLength(1)
    expect(mutations[0].object).toBe(rect)
    expect(mutations[0].property).toBe('skewX')
    expect(mutations[0].oldValue).toBe(0)
    expect(mutations[0].newValue).toBe(15)
  })

  it('fires object:mutated event when skewY property changes', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50, skewY: 0 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.skewY = 20

    expect(mutations).toHaveLength(1)
    expect(mutations[0].object).toBe(rect)
    expect(mutations[0].property).toBe('skewY')
    expect(mutations[0].oldValue).toBe(0)
    expect(mutations[0].newValue).toBe(20)
  })

  it('does not fire mutations for objects not in a layer', () => {
    const { stage } = makeStage()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50 })

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.x = 50

    // Should not fire since object is not in any layer
    expect(mutations).toHaveLength(0)
  })

  it('fires multiple mutations when multiple properties change', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.x = 50
    rect.y = 100
    rect.width = 200

    expect(mutations).toHaveLength(3)
    expect(mutations[0].property).toBe('x')
    expect(mutations[1].property).toBe('y')
    expect(mutations[2].property).toBe('width')
  })

  it('fires mutations for different objects independently', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50 })
    const circle = new Circle({ x: 30, y: 40, radius: 25 })
    layer.add(rect)
    layer.add(circle)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    rect.x = 50
    circle.y = 100

    expect(mutations).toHaveLength(2)
    expect(mutations[0].object).toBe(rect)
    expect(mutations[0].property).toBe('x')
    expect(mutations[1].object).toBe(circle)
    expect(mutations[1].property).toBe('y')
  })

  it('fires mutation once when property is changed multiple times', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    // Change same property multiple times
    rect.x = 50
    rect.x = 100
    rect.x = 150

    // Should fire 3 mutations, one for each assignment
    expect(mutations).toHaveLength(3)
    expect(mutations[0].newValue).toBe(50)
    expect(mutations[1].newValue).toBe(100)
    expect(mutations[2].newValue).toBe(150)
  })

  it('does not fire mutation when object is removed from layer', () => {
    const { stage } = makeStage()
    const layer = stage.addLayer()
    const rect = new Rect({ x: 10, y: 20, width: 100, height: 50 })
    layer.add(rect)

    const mutations: ObjectMutationEvent[] = []
    stage.on('object:mutated', (e) => mutations.push(e))

    layer.remove(rect)
    rect.x = 50

    // Should not fire since object was removed
    expect(mutations).toHaveLength(0)
  })

  it('mutation event can be listened to globally or per-stage', () => {
    const { stage: stage1 } = makeStage()
    const { stage: stage2 } = makeStage()

    const layer1 = stage1.addLayer()
    const layer2 = stage2.addLayer()

    const rect1 = new Rect({ x: 10, y: 20, width: 100, height: 50 })
    const rect2 = new Rect({ x: 30, y: 40, width: 150, height: 75 })

    layer1.add(rect1)
    layer2.add(rect2)

    const mutations1: ObjectMutationEvent[] = []
    const mutations2: ObjectMutationEvent[] = []

    stage1.on('object:mutated', (e) => mutations1.push(e))
    stage2.on('object:mutated', (e) => mutations2.push(e))

    rect1.x = 50
    rect2.y = 100

    expect(mutations1).toHaveLength(1)
    expect(mutations1[0].object).toBe(rect1)
    expect(mutations2).toHaveLength(1)
    expect(mutations2[0].object).toBe(rect2)
  })
})
