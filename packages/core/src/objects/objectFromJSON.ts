import type { ObjectJSON, ObjectDeserializer } from '../types.js'
import type { BaseObject } from './BaseObject.js'
import { Rect } from './Rect.js'
import { Circle } from './Circle.js'
import { Line } from './Line.js'
import { Path } from './Path.js'
import { Text } from './Text.js'
import { CanvasImage } from './CanvasImage.js'
import { Group } from './Group.js'

/**
 * Deserialize a plain JSON object (from `toJSON()`) back into a typed scene object.
 * Supports all built-in object types. Custom types registered via
 * {@link Stage.registerObject} are consulted after the built-in switch falls through.
 *
 * @param json - The serialized object data.
 * @param registry - Optional map of custom type names to deserializer functions,
 *   provided by {@link Stage} when called from `loadJSON()`.
 * @throws If the `type` field is missing or unrecognized by both the built-in
 *   switch and the custom registry.
 */
export function objectFromJSON(
  json: ObjectJSON,
  registry?: ReadonlyMap<string, ObjectDeserializer>,
): BaseObject {
  switch (json.type) {
    case 'Rect':
      return Rect.fromJSON(json)
    case 'Circle':
      return Circle.fromJSON(json)
    case 'Line':
      return Line.fromJSON(json)
    case 'Path':
      return Path.fromJSON(json)
    case 'Text':
      return Text.fromJSON(json)
    case 'CanvasImage':
      return CanvasImage.fromJSON(json)
    case 'Group':
      return Group.fromJSON(json, registry)
    default: {
      const deserializer = registry?.get(json.type)
      if (deserializer !== undefined) return deserializer(json)
      throw new Error(`[nexvas] objectFromJSON: unknown object type "${String(json.type)}"`)
    }
  }
}
