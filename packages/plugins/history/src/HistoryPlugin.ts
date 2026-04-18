import type { Plugin, StageInterface, ObjectMutationEvent, Layer, BaseObject } from '@nexvas/core'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A reversible operation recorded in the history stack. */
export interface HistoryCommand {
  /** Applies (or re-applies) the operation. */
  apply(): void
  /** Reverses the operation. */
  undo(): void
  /** Optional human-readable label for debugging. */
  label?: string
}

/** A named save-point recorded in the history stack via checkpoint(). */
export interface CheckpointInfo {
  /** Optional label passed to checkpoint(). */
  label?: string
  /** Length of the undo stack at the time checkpoint() was called. */
  stackIndex: number
}

export interface HistoryPluginOptions {
  /** Maximum number of undo steps stored. Default: 100. */
  maxSize?: number
}

/**
 * Type augmentation for accessing HistoryPlugin through the stage.
 * @example
 * const history = (stage as HistoryPluginAPI).history
 */
export interface HistoryPluginAPI {
  history: HistoryPlugin
}

// ---------------------------------------------------------------------------
// Internal command implementations
// ---------------------------------------------------------------------------

/** Coalesces multiple property mutations from a stage.batch() into one undo entry. */
class BatchPropertyCommand implements HistoryCommand {
  readonly label: string

  constructor(
    private readonly mutations: ObjectMutationEvent[],
    label?: string,
  ) {
    this.label = label ?? 'batch'
  }

  apply(): void {
    for (const m of this.mutations) {
      ;(m.object as Record<string, unknown>)[m.property] = m.newValue
    }
  }

  undo(): void {
    for (let i = this.mutations.length - 1; i >= 0; i--) {
      const m = this.mutations[i]!
      ;(m.object as Record<string, unknown>)[m.property] = m.oldValue
    }
  }
}

/** Records a z-order change so it can be undone and redone. */
class ZOrderCommand implements HistoryCommand {
  readonly label = 'z-order'

  constructor(
    private readonly object: BaseObject,
    private readonly layer: Layer,
    private readonly oldIndex: number,
    private readonly newIndex: number,
  ) {}

  apply(): void {
    this.layer.moveTo(this.object, this.newIndex)
  }

  undo(): void {
    this.layer.moveTo(this.object, this.oldIndex)
  }
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

/**
 * HistoryPlugin — undo/redo via the Command pattern.
 *
 * Records `HistoryCommand` objects and replays or reverses them on
 * Ctrl+Z / Ctrl+Y (or Ctrl+Shift+Z).
 *
 * Automatically records:
 * - Batch mutations: listens to `batch:commit` and folds all mutations into one entry.
 * - Z-order changes: listens to `zorder:change` and records an undoable command.
 *
 * Use `record(command)` to push arbitrary custom commands.
 * Use `checkpoint(label?)` to mark named save points (e.g. after file load).
 */
export class HistoryPlugin implements Plugin {
  readonly name = 'history'
  readonly version = '0.1.0'

  private _stage: StageInterface | null = null
  private _maxSize: number
  private _undoStack: HistoryCommand[] = []
  private _redoStack: HistoryCommand[] = []
  private _checkpoints: CheckpointInfo[] = []

  /** Set during record/undo/redo to prevent auto-recording of triggered events. */
  private _suppressAutoRecord = false

  private _onKeyDown: (e: KeyboardEvent) => void
  private _onBatchCommit: (data: { mutations: ObjectMutationEvent[] }) => void
  private _onZOrderChange: (data: {
    object: BaseObject
    layer: Layer
    oldIndex: number
    newIndex: number
  }) => void

  constructor(options: HistoryPluginOptions = {}) {
    this._maxSize = options.maxSize ?? 100
    this._onKeyDown = this._handleKeyDown.bind(this)
    this._onBatchCommit = this._handleBatchCommit.bind(this)
    this._onZOrderChange = this._handleZOrderChange.bind(this)
  }

  // ---------------------------------------------------------------------------
  // Plugin lifecycle
  // ---------------------------------------------------------------------------

  install(stage: StageInterface): void {
    this._stage = stage
    ;(stage as unknown as HistoryPluginAPI).history = this
    stage.on('batch:commit', this._onBatchCommit)
    stage.on('zorder:change', this._onZOrderChange)
    if (typeof document !== 'undefined') {
      document.addEventListener('keydown', this._onKeyDown)
    }
  }

  uninstall(stage: StageInterface): void {
    stage.off('batch:commit', this._onBatchCommit)
    stage.off('zorder:change', this._onZOrderChange)
    if (typeof document !== 'undefined') {
      document.removeEventListener('keydown', this._onKeyDown)
    }
    this._stage = null
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Record a command and immediately apply it.
   * Clears the redo stack (branching history).
   */
  record(command: HistoryCommand): void {
    this._suppressAutoRecord = true
    try {
      command.apply()
    } finally {
      this._suppressAutoRecord = false
    }
    this._pushApplied(command)
  }

  /** Undo the last recorded command. */
  undo(): void {
    const command = this._undoStack.pop()
    if (!command) return
    this._suppressAutoRecord = true
    try {
      command.undo()
    } finally {
      this._suppressAutoRecord = false
    }
    this._redoStack.push(command)
    this._emitChange()
    this._stage?.markDirty()
  }

  /** Redo the last undone command. */
  redo(): void {
    const command = this._redoStack.pop()
    if (!command) return
    this._suppressAutoRecord = true
    try {
      command.apply()
    } finally {
      this._suppressAutoRecord = false
    }
    this._undoStack.push(command)
    this._emitChange()
    this._stage?.markDirty()
  }

  /** True if there are commands that can be undone. */
  get canUndo(): boolean {
    return this._undoStack.length > 0
  }

  /** True if there are commands that can be redone. */
  get canRedo(): boolean {
    return this._redoStack.length > 0
  }

  /** Clears all undo/redo history and any stored checkpoints. */
  clear(): void {
    this._undoStack = []
    this._redoStack = []
    this._checkpoints = []
    this._emitChange()
  }

  /**
   * Mark the current undo-stack position as a named save point.
   * Fires `history:checkpoint` on stage. Checkpoints are cleared by `clear()`.
   *
   * Typical use: call `checkpoint('saved')` after loading or saving a file,
   * then compare `checkpoints[last].stackIndex` to `undoStack.length` to detect
   * unsaved changes.
   */
  checkpoint(label?: string): void {
    this._checkpoints.push({ label, stackIndex: this._undoStack.length })
    this._stage?.emit('history:checkpoint', { label })
  }

  /** All checkpoints recorded since the last clear(). */
  get checkpoints(): readonly CheckpointInfo[] {
    return this._checkpoints
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Push an already-applied command onto the undo stack and clear the redo stack.
   * Use this for commands that were applied externally (batch, z-order, etc.).
   */
  private _pushApplied(command: HistoryCommand): void {
    this._undoStack.push(command)
    if (this._undoStack.length > this._maxSize) {
      this._undoStack.shift()
    }
    this._redoStack = []
    this._emitChange()
    this._stage?.markDirty()
  }

  private _handleBatchCommit(data: { mutations: ObjectMutationEvent[] }): void {
    if (this._suppressAutoRecord || data.mutations.length === 0) return
    this._pushApplied(new BatchPropertyCommand(data.mutations))
  }

  private _handleZOrderChange(data: {
    object: BaseObject
    layer: Layer
    oldIndex: number
    newIndex: number
  }): void {
    if (this._suppressAutoRecord) return
    this._pushApplied(new ZOrderCommand(data.object, data.layer, data.oldIndex, data.newIndex))
  }

  private _emitChange(): void {
    this._stage?.emit('history:change', { canUndo: this.canUndo, canRedo: this.canRedo })
  }

  private _handleKeyDown(e: KeyboardEvent): void {
    const ctrl = e.ctrlKey || e.metaKey
    if (!ctrl) return

    if (e.key === 'z' || e.key === 'Z') {
      if (e.shiftKey) {
        this.redo()
      } else {
        this.undo()
      }
      e.preventDefault()
    } else if (e.key === 'y' || e.key === 'Y') {
      this.redo()
      e.preventDefault()
    }
  }
}
