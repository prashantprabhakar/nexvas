// Core entry point — public API for @nexvas/core

export { Stage, type StageOptions, type StartLoopOptions } from './Stage.js'
export { Layer } from './Layer.js'
export { Viewport, type ViewportOptions, type AnimateToOptions } from './Viewport.js'
export { EventSystem } from './EventSystem.js'
export { PluginRegistry } from './PluginRegistry.js'
export { FontManager } from './FontManager.js'

// Objects
export { Color } from './Color.js'

export {
  BaseObject,
  type BaseObjectProps,
  type EventHandler,
  Rect,
  type RectProps,
  Circle,
  type CircleProps,
  Line,
  type LineProps,
  Text,
  type TextProps,
  type TextAlign,
  type TextBaseline,
  CanvasImage,
  type ImageProps,
  Path,
  type PathProps,
  Group,
  type GroupProps,
  Connector,
  type ConnectorProps,
  type ConnectorEndpoint,
  type ConnectorEndpointFixed,
  type ConnectorEndpointRef,
  type ConnectorJSON,
  type ConnectorRouting,
  type RoutePoint,
  Polygon,
  type PolygonProps,
  Star,
  type StarProps,
} from './objects/index.js'
export { objectFromJSON } from './objects/objectFromJSON.js'
export { migrate, CURRENT_SCHEMA_VERSION } from './migrate.js'

// Math
export { Vec2, Matrix3x3, BoundingBox } from './math/index.js'

// Types
export type {
  CanvasKitLike,
  Plugin,
  RenderContext,
  RenderPass,
  RenderPassPhase,
  SceneJSON,
  LayerJSON,
  ObjectJSON,
  ObjectDeserializer,
  ViewportState,
  StageInterface,
  StageEventMap,
  ObjectEventMap,
  CanvasPointerEvent,
  CanvasWheelEvent,
  PointerPosition,
  Fill,
  SolidFill,
  LinearGradientFill,
  StrokeStyle,
  StrokeLineCap,
  StrokeLineJoin,
  ColorRGBA,
  ObjectMutationEvent,
  Port,
} from './types.js'
