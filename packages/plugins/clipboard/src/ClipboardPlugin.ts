import type { Plugin, StageInterface, BaseObject, ObjectJSON } from '@nexvas/core'
import { objectFromJSON } from '@nexvas/core'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PASTE_OFFSET = 20

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Collect all IDs from a tree of ObjectJSON (including Group children). */
function collectIds(objects: ObjectJSON[]): Set<string> {
  const ids = new Set<string>()
  for (const obj of objects) {
    if (obj.id) ids.add(obj.id)
    if (obj.type === 'Group' && Array.isArray((obj as GroupJSON).children)) {
      for (const id of collectIds((obj as GroupJSON).children)) ids.add(id)
    }
  }
  return ids
}

/** Generate a simple unique id (same pattern as BaseObject internal helper). */
let _nextId = Date.now()
function freshId(): string {
  return `obj_${(_nextId++).toString(36)}`
}

interface GroupJSON extends ObjectJSON {
  children: ObjectJSON[]
}

interface ConnectorEndRef {
  objectId: string
  portId: string
}

interface ConnectorJSON extends ObjectJSON {
  sourceRef?: ConnectorEndRef
  targetRef?: ConnectorEndRef
}

/**
 * Deep-clone an array of ObjectJSON, assigning fresh IDs to every object
 * that is present in `knownIds`. Connector sourceRef/targetRef are remapped
 * when the referenced object is also in the clipped set.
 */
function remapIds(objects: ObjectJSON[], idMap: Map<string, string>): ObjectJSON[] {
  return objects.map((obj) => {
    const cloned: ObjectJSON = JSON.parse(JSON.stringify(obj)) as ObjectJSON
    if (cloned.id && idMap.has(cloned.id)) {
      cloned.id = idMap.get(cloned.id)!
    }

    // Remap Group children recursively
    if (cloned.type === 'Group' && Array.isArray((cloned as GroupJSON).children)) {
      ;(cloned as GroupJSON).children = remapIds((cloned as GroupJSON).children, idMap)
    }

    // Remap Connector refs when the target is inside the clipboard
    if (cloned.type === 'Connector') {
      const conn = cloned as ConnectorJSON
      if (conn.sourceRef && idMap.has(conn.sourceRef.objectId)) {
        conn.sourceRef = { ...conn.sourceRef, objectId: idMap.get(conn.sourceRef.objectId)! }
      }
      if (conn.targetRef && idMap.has(conn.targetRef.objectId)) {
        conn.targetRef = { ...conn.targetRef, objectId: idMap.get(conn.targetRef.objectId)! }
      }
    }

    return cloned
  })
}

/** Build an old→new ID mapping for all objects in a snapshot. */
function buildIdMap(objects: ObjectJSON[]): Map<string, string> {
  const map = new Map<string, string>()
  for (const id of collectIds(objects)) {
    map.set(id, freshId())
  }
  return map
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for the paste operation. */
export interface PasteOptions {
  /** World-space position where the top-left of the pasted selection will land. */
  x?: number
  y?: number
}

/** Duck-typed minimal interface for SelectionPlugin. */
interface SelectionLike {
  readonly selected: readonly BaseObject[]
  select(obj: BaseObject): void
  addToSelection(obj: BaseObject): void
  clearSelection(): void
}

/** Type augmentation to access ClipboardPlugin API through the stage. */
export interface ClipboardPluginAPI {
  clipboard: ClipboardController
}

// ---------------------------------------------------------------------------
// ClipboardController
// ---------------------------------------------------------------------------

/**
 * Provides copy, cut, paste, and duplicate operations for canvas objects.
 * Requires SelectionPlugin to be installed on the same stage.
 */
export class ClipboardController {
  private _stage: StageInterface
  private _snapshot: ObjectJSON[] = []
  /** Accumulated offset for successive pastes without explicit position. */
  private _pasteCount = 0

  constructor(stage: StageInterface) {
    this._stage = stage
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Copy selected objects to the internal clipboard.
   * Returns the number of objects copied, or 0 if SelectionPlugin is absent.
   */
  copy(): number {
    const selected = this._getSelected()
    if (selected.length === 0) return 0
    this._snapshot = selected.map((obj) => obj.toJSON())
    this._pasteCount = 0
    return selected.length
  }

  /**
   * Cut selected objects: copy to clipboard and remove from stage.
   * Wrapped in `stage.batch()` so HistoryPlugin records one undo entry.
   */
  cut(): number {
    const selected = this._getSelected()
    if (selected.length === 0) return 0
    this._snapshot = selected.map((obj) => obj.toJSON())
    this._pasteCount = 0
    this._stage.batch(() => {
      for (const obj of selected) {
        const layer = this._stage.getObjectLayer(obj)
        layer?.remove(obj)
      }
    })
    this._clearSelection()
    return selected.length
  }

  /**
   * Paste clipboard objects onto the stage.
   * Each call without an explicit position offsets by PASTE_OFFSET pixels.
   * Uses `stage.batch()` — HistoryPlugin records one undo entry.
   *
   * @param options - Optional world-space position to place the pasted objects.
   * @returns The newly created objects, or an empty array if clipboard is empty.
   */
  paste(options?: PasteOptions): BaseObject[] {
    if (this._snapshot.length === 0) return []

    this._pasteCount++
    const idMap = buildIdMap(this._snapshot)
    const remapped = remapIds(this._snapshot, idMap)

    // Determine offset
    let dx: number
    let dy: number

    if (options?.x !== undefined && options?.y !== undefined) {
      // Explicit position: compute delta from the bounding-box origin of the snapshot
      const { minX, minY } = this._snapshotBounds()
      dx = options.x - minX
      dy = options.y - minY
    } else {
      dx = PASTE_OFFSET * this._pasteCount
      dy = PASTE_OFFSET * this._pasteCount
    }

    const layer = this._stage.layers[0]
    if (!layer) return []

    const added: BaseObject[] = []

    this._stage.batch(() => {
      for (const json of remapped) {
        const obj = objectFromJSON(json)
        obj.x += dx
        obj.y += dy
        layer.add(obj)
        added.push(obj)
      }
    })

    // Update selection to pasted objects
    this._replaceSelection(added)
    this._stage.emit('clipboard:paste', { objects: added })
    this._stage.markDirty()
    return added
  }

  /**
   * Duplicate selected objects in one step (copy + paste with default offset).
   * @returns The newly created duplicate objects.
   */
  duplicate(): BaseObject[] {
    this.copy()
    return this.paste()
  }

  /** True when the internal clipboard has content. */
  get hasContent(): boolean {
    return this._snapshot.length > 0
  }

  /** Number of objects currently in the clipboard snapshot. */
  get count(): number {
    return this._snapshot.length
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private _getSelectionPlugin(): SelectionLike | null {
    const s = this._stage as unknown as { selection?: SelectionLike }
    if (s.selection && typeof s.selection.selected !== 'undefined') return s.selection
    return null
  }

  private _getSelected(): BaseObject[] {
    const sel = this._getSelectionPlugin()
    if (!sel) return []
    return Array.from(sel.selected)
  }

  private _clearSelection(): void {
    this._getSelectionPlugin()?.clearSelection()
  }

  private _replaceSelection(objects: BaseObject[]): void {
    const sel = this._getSelectionPlugin()
    if (!sel || objects.length === 0) return
    sel.clearSelection()
    for (const obj of objects) sel.addToSelection(obj)
  }

  private _snapshotBounds(): { minX: number; minY: number } {
    let minX = Infinity
    let minY = Infinity
    for (const json of this._snapshot) {
      const x = typeof json.x === 'number' ? json.x : 0
      const y = typeof json.y === 'number' ? json.y : 0
      if (x < minX) minX = x
      if (y < minY) minY = y
    }
    return { minX: isFinite(minX) ? minX : 0, minY: isFinite(minY) ? minY : 0 }
  }
}

// ---------------------------------------------------------------------------
// ClipboardPlugin
// ---------------------------------------------------------------------------

/**
 * ClipboardPlugin — copy / cut / paste / duplicate for canvas objects.
 *
 * Requires SelectionPlugin to be installed on the same stage.
 * After installing, access clipboard operations via `(stage as ClipboardPluginAPI).clipboard`.
 *
 * Keyboard bindings:
 * - Ctrl+C / Cmd+C — copy
 * - Ctrl+X / Cmd+X — cut
 * - Ctrl+V / Cmd+V — paste
 * - Ctrl+D / Cmd+D — duplicate
 *
 * @example
 * ```ts
 * stage.use(new ClipboardPlugin())
 * const { clipboard } = stage as unknown as ClipboardPluginAPI
 *
 * clipboard.copy()
 * clipboard.paste()
 * clipboard.paste({ x: 200, y: 150 })
 * clipboard.duplicate()
 * ```
 */
export class ClipboardPlugin implements Plugin {
  readonly name = 'plugin-clipboard'
  readonly version = '0.0.1'

  private _controller: ClipboardController | null = null
  private _keyHandler: ((e: KeyboardEvent) => void) | null = null

  /** Install the plugin on a stage. Attaches `clipboard` to the stage and registers keyboard shortcuts. */
  install(stage: StageInterface): void {
    const controller = new ClipboardController(stage)
    this._controller = controller
    ;(stage as unknown as ClipboardPluginAPI).clipboard = controller

    const handler = (e: KeyboardEvent): void => {
      const meta = e.ctrlKey || e.metaKey
      if (!meta) return

      const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase()
      if (tag === 'input' || tag === 'textarea') return

      switch (e.key.toLowerCase()) {
        case 'c':
          e.preventDefault()
          controller.copy()
          break
        case 'x':
          e.preventDefault()
          controller.cut()
          break
        case 'v':
          e.preventDefault()
          controller.paste()
          break
        case 'd':
          e.preventDefault()
          controller.duplicate()
          break
      }
    }

    this._keyHandler = handler
    document.addEventListener('keydown', handler)
  }

  /** Remove the plugin. Detaches `clipboard` from stage and removes keyboard listener. */
  uninstall(stage: StageInterface): void {
    if (this._keyHandler) {
      document.removeEventListener('keydown', this._keyHandler)
      this._keyHandler = null
    }
    delete (stage as unknown as Partial<ClipboardPluginAPI>).clipboard
    this._controller = null
  }
}
