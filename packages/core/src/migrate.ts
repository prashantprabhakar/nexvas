import type { SceneJSON } from './types.js'

// ---------------------------------------------------------------------------
// Semver comparison helpers (no external dep — only what we need)
// ---------------------------------------------------------------------------

/** Parse a semver string into [major, minor, patch]. Throws on invalid format. */
function parseSemver(version: string): [number, number, number] {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version)
  if (!m) throw new Error(`[nexvas:migrate] Invalid semver "${version}"`)
  return [parseInt(m[1]!, 10), parseInt(m[2]!, 10), parseInt(m[3]!, 10)]
}

/** -1 if a < b, 0 if equal, 1 if a > b */
function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const [aMaj, aMin, aPat] = parseSemver(a)
  const [bMaj, bMin, bPat] = parseSemver(b)
  if (aMaj !== bMaj) return aMaj < bMaj ? -1 : 1
  if (aMin !== bMin) return aMin < bMin ? -1 : 1
  if (aPat !== bPat) return aPat < bPat ? -1 : 1
  return 0
}

// ---------------------------------------------------------------------------
// Migration step registry
// ---------------------------------------------------------------------------

interface MigrationStep {
  /** Schema version this step migrates FROM. */
  from: string
  /** Schema version this step migrates TO. */
  to: string
  /** Transform the JSON in-place (deep clone before calling). */
  up(json: SceneJSON): SceneJSON
}

/**
 * Ordered list of migration steps. When a new schema version is introduced:
 * 1. Bump `CURRENT_VERSION` in Stage.toJSON().
 * 2. Add a step here: `{ from: 'old', to: 'new', up(json) { ... } }`.
 * Steps must be listed in ascending version order.
 *
 * Example (not active — shows the pattern):
 * ```ts
 * {
 *   from: '1.0.0',
 *   to: '1.1.0',
 *   up(json) {
 *     // Add a new `opacity` field defaulting to 1 on every object
 *     for (const layer of json.layers) {
 *       for (const obj of layer.objects) {
 *         if (obj.opacity === undefined) obj.opacity = 1
 *       }
 *     }
 *     return { ...json, version: '1.1.0' }
 *   },
 * }
 * ```
 */
const MIGRATIONS: MigrationStep[] = [
  // Future migrations go here, in ascending version order.
]

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** The current schema version produced by `stage.toJSON()`. */
export const CURRENT_SCHEMA_VERSION = '1.0.0'

/**
 * Migrate a serialized scene JSON from its current schema version to
 * `targetVersion` (defaults to the current framework version).
 *
 * - If the input is already at `targetVersion`, it is returned as-is.
 * - Only forward (upgrade) migrations are supported. Passing a
 *   `targetVersion` older than the input version throws.
 * - The input object is never mutated — each migration step receives a
 *   deep clone.
 *
 * @example
 * ```ts
 * import { migrate, CURRENT_SCHEMA_VERSION } from '@nexvas/core'
 *
 * const stored = JSON.parse(localStorage.getItem('scene') ?? '{}')
 * const current = migrate(stored)         // upgrade to latest
 * stage.loadJSON(current)
 * ```
 *
 * @throws If `json.version` or `targetVersion` is not a valid semver string.
 * @throws If `targetVersion` is older than `json.version`.
 * @throws If no migration path exists between the two versions.
 */
export function migrate(
  json: SceneJSON,
  targetVersion: string = CURRENT_SCHEMA_VERSION,
): SceneJSON {
  const inputVersion = json.version

  // Validate both versions are parseable semver.
  parseSemver(inputVersion)
  parseSemver(targetVersion)

  const cmp = compareSemver(inputVersion, targetVersion)

  if (cmp === 0) {
    // Already at target — nothing to do.
    return json
  }

  if (cmp > 0) {
    throw new Error(
      `[nexvas:migrate] Cannot downgrade schema from "${inputVersion}" to "${targetVersion}". ` +
        `Only forward (upgrade) migrations are supported.`,
    )
  }

  // Find the chain of steps that covers the gap.
  const chain = buildChain(inputVersion, targetVersion)

  // Apply each step, deep-cloning before the first mutation.
  let result: SceneJSON = JSON.parse(JSON.stringify(json)) as SceneJSON
  for (const step of chain) {
    result = step.up(result)
    result = { ...result, version: step.to }
  }

  return result
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the ordered list of migration steps needed to go from `from` to `to`.
 * Throws if no complete path exists in the MIGRATIONS registry.
 */
function buildChain(from: string, to: string): MigrationStep[] {
  const chain: MigrationStep[] = []
  let current = from

  while (compareSemver(current, to) < 0) {
    const step = MIGRATIONS.find((m) => m.from === current)
    if (!step) {
      throw new Error(
        `[nexvas:migrate] No migration step registered for schema version "${current}". ` +
          `Cannot upgrade to "${to}".`,
      )
    }
    chain.push(step)
    current = step.to
  }

  if (current !== to) {
    throw new Error(
      `[nexvas:migrate] Migration chain ended at "${current}" but target is "${to}".`,
    )
  }

  return chain
}
