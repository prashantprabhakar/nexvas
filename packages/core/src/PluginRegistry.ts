import type { Plugin, StageInterface } from './types.js'

/** Manages plugin lifecycle for a Stage. */
export class PluginRegistry {
  private _plugins = new Map<string, Plugin>()
  private _stage: StageInterface

  constructor(stage: StageInterface) {
    this._stage = stage
  }

  /**
   * Install a plugin. Throws if a plugin with the same name is already installed.
   * @param plugin - The plugin to install.
   * @param options - Options forwarded to `plugin.install()`.
   */
  install(plugin: Plugin, options?: Record<string, unknown>): void {
    if (this._plugins.has(plugin.name)) {
      throw new Error(
        `Plugin "${plugin.name}" is already installed. Uninstall it first if you want to reinstall.`,
      )
    }
    try {
      plugin.install(this._stage, options)
    } catch (err) {
      // Best-effort cleanup on failed install
      try {
        plugin.uninstall(this._stage)
      } catch {
        // ignore cleanup errors
      }
      throw err
    }
    this._plugins.set(plugin.name, plugin)
  }

  /**
   * Uninstall a plugin by name. No-op if not installed.
   */
  uninstall(name: string): void {
    const plugin = this._plugins.get(name)
    if (plugin === undefined) return
    this._plugins.delete(name)
    try {
      plugin.uninstall(this._stage)
    } catch (err) {
      console.error(`[nexvas:registry] Failed to uninstall plugin "${name}":`, err)
    }
  }

  has(name: string): boolean {
    return this._plugins.has(name)
  }

  get(name: string): Plugin | undefined {
    return this._plugins.get(name)
  }

  get installedPlugins(): readonly Plugin[] {
    return Array.from(this._plugins.values())
  }

  /** Uninstall all plugins. Called by Stage.destroy(). */
  destroyAll(): void {
    for (const [name] of this._plugins) {
      this.uninstall(name)
    }
  }
}
