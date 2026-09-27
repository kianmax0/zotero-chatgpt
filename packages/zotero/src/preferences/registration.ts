/**
 * Native Zotero Preferences pane registration.
 *
 * Zotero unregisters a plugin's panes when the plugin shuts down, but a reload can start the
 * plugin again before the old pane is gone; this registrar keeps at most one pane per session,
 * clears a stale pane that still owns the fixed id and never lets a registration failure break
 * the rest of the plugin.
 */
export const PREFERENCES_PANE_ID = 'zchatgpt-prefpane-settings';
export const PREFERENCES_PANE_LABEL = 'Zotero ChatGPT';
export const PREFERENCES_PANE_SOURCE = 'content/preferences/preferences.xhtml';
export const PREFERENCES_PANE_SCRIPT = 'content/preferences/pane.js';

export interface PreferencePaneOptions {
  pluginID: string;
  id: string;
  label: string;
  src: string;
  scripts: string[];
  /** The plugin's own stylesheet, so the pane is styled by the same tokens as the sidebar. */
  stylesheets: string[];
  /** Built-in Zotero panes set this; a thrown load then cannot leave the previous pane on screen. */
  defaultXUL: boolean;
}
export interface PreferencePaneRegistry {
  register(options: PreferencePaneOptions): Promise<string>;
  unregister(id: string): void;
}
export interface PreferencePaneRegistrar {
  /** The registered pane id, or undefined when registration is unavailable or failed. */
  readonly id: string | undefined;
  /** Register the pane once; returns the pane id or undefined after an honest failure. */
  ensure(): Promise<string | undefined>;
  /** Wait for in-flight registration, then unregister this session's pane. Safe to call repeatedly. */
  remove(): Promise<void>;
}
export interface PreferencePaneRegistrarHost {
  panes: PreferencePaneRegistry | undefined;
  pluginID: string;
  rootURI: string;
  logError(error: unknown): void;
}

function failure(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

export function createPreferencePaneRegistrar(host: PreferencePaneRegistrarHost): PreferencePaneRegistrar {
  let id: string | undefined;
  let stopped = false;
  let pendingRegistration: Promise<string | undefined> | undefined;
  let pendingRemoval: Promise<void> | undefined;
  const options = (): PreferencePaneOptions => ({
    pluginID: host.pluginID,
    id: PREFERENCES_PANE_ID,
    label: PREFERENCES_PANE_LABEL,
    src: `${host.rootURI}${PREFERENCES_PANE_SOURCE}`,
    scripts: [`${host.rootURI}${PREFERENCES_PANE_SCRIPT}`],
    stylesheets: [`${host.rootURI}content/assets/sidebar.css`],
    defaultXUL: true,
  });
  const register = async (): Promise<string> => host.panes!.register(options());
  const ensureOnce = async (): Promise<string | undefined> => {
    let registered: string;
    try {
      registered = await register();
    } catch (error) {
      // Shutdown must not clear a pane from a later plugin enable while an older registration
      // finishes. Zotero unregisters by fixed id, without checking which generation owns it.
      if (stopped) return undefined;
      try {
        // A previous enable in the same session can still own the fixed id.
        host.panes!.unregister(PREFERENCES_PANE_ID);
        registered = await register();
      } catch (retry) {
        host.logError(new Error(`The Zotero ChatGPT preferences pane could not be registered: ${failure(error)}; retry: ${failure(retry)}`));
        return undefined;
      }
    }
    if (stopped) {
      try { host.panes!.unregister(registered); } catch (error) { host.logError(new Error(`The Zotero ChatGPT preferences pane could not be unregistered: ${failure(error)}`)); }
      return undefined;
    }
    id = registered;
    return id;
  };
  return {
    get id() { return id; },
    ensure(): Promise<string | undefined> {
      if (stopped || id) return Promise.resolve(id);
      if (!host.panes) return Promise.resolve(undefined);
      if (!pendingRegistration) pendingRegistration = ensureOnce();
      return pendingRegistration;
    },
    remove(): Promise<void> {
      if (pendingRemoval) return pendingRemoval;
      stopped = true;
      pendingRemoval = (async () => {
        await pendingRegistration;
        const registered = id;
        id = undefined;
        if (!registered || !host.panes) return;
        try { host.panes.unregister(registered); }
        catch (error) { host.logError(new Error(`The Zotero ChatGPT preferences pane could not be unregistered: ${failure(error)}`)); }
      })();
      return pendingRemoval;
    },
  };
}
