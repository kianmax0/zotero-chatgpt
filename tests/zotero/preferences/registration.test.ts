import { expect, it, vi } from 'vitest';
import {
  PREFERENCES_PANE_ID,
  PREFERENCES_PANE_LABEL,
  PREFERENCES_PANE_SCRIPT,
  PREFERENCES_PANE_SOURCE,
  createPreferencePaneRegistrar,
  type PreferencePaneRegistrarHost,
} from '../../../packages/zotero/src/preferences/registration.ts';

const rootURI = 'file:///plugin/';

function host(overrides: Partial<PreferencePaneRegistrarHost> = {}) {
  const register = vi.fn<(options: { pluginID: string; id: string; label: string; src: string; scripts: string[]; stylesheets: string[]; defaultXUL: boolean }) => Promise<string>>()
    .mockResolvedValue(PREFERENCES_PANE_ID);
  const unregister = vi.fn<(id: string) => void>();
  const logError = vi.fn<(error: unknown) => void>();
  const value: PreferencePaneRegistrarHost = { panes: { register, unregister }, pluginID: 'zchatgpt@example.invalid', rootURI, logError, ...overrides };
  return { value, register, unregister, logError };
}

it('registers the native pane once with the bundled fragment and script, and unregisters on shutdown', async () => {
  const { value, register, unregister } = host();
  const registrar = createPreferencePaneRegistrar(value);
  expect(registrar.id).toBeUndefined();
  await expect(registrar.ensure()).resolves.toBe(PREFERENCES_PANE_ID);
  expect(register).toHaveBeenCalledTimes(1);
  expect(register).toHaveBeenCalledWith({
    pluginID: 'zchatgpt@example.invalid',
    id: PREFERENCES_PANE_ID,
    label: PREFERENCES_PANE_LABEL,
    src: `${rootURI}${PREFERENCES_PANE_SOURCE}`,
    scripts: [`${rootURI}${PREFERENCES_PANE_SCRIPT}`],
    // The pane is styled by the plugin's own sheet, scoped to `.zchatgpt-preferences`.
    stylesheets: [`${rootURI}content/assets/sidebar.css`],
    defaultXUL: true,
  });
  // A second startup in the same session must not register a duplicate pane.
  await expect(registrar.ensure()).resolves.toBe(PREFERENCES_PANE_ID);
  expect(register).toHaveBeenCalledTimes(1);
  expect(registrar.id).toBe(PREFERENCES_PANE_ID);
  await registrar.remove();
  expect(unregister).toHaveBeenCalledOnce();
  expect(unregister).toHaveBeenCalledWith(PREFERENCES_PANE_ID);
  expect(registrar.id).toBeUndefined();
  // Repeated cleanup is a no-op, and a stopped registrar never resurrects a pane.
  await registrar.remove();
  expect(unregister).toHaveBeenCalledOnce();
  await expect(registrar.ensure()).resolves.toBeUndefined();
  expect(register).toHaveBeenCalledTimes(1);
  // The next startup builds a fresh registrar and registers a fresh pane.
  const next = createPreferencePaneRegistrar(value);
  await expect(next.ensure()).resolves.toBe(PREFERENCES_PANE_ID);
  expect(register).toHaveBeenCalledTimes(2);
});

it('unregisters a pane that finished registering after shutdown had already started', async () => {
  let finish!: (id: string) => void;
  const register = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  const unregister = vi.fn<(id: string) => void>();
  const logError = vi.fn<(error: unknown) => void>();
  const registrar = createPreferencePaneRegistrar({ panes: { register, unregister }, pluginID: 'zchatgpt@example.invalid', rootURI, logError });
  const pending = registrar.ensure();
  const removal = registrar.remove();
  finish(PREFERENCES_PANE_ID);
  await expect(pending).resolves.toBeUndefined();
  await removal;
  expect(registrar.id).toBeUndefined();
  expect(unregister).toHaveBeenCalledWith(PREFERENCES_PANE_ID);
  expect(logError).not.toHaveBeenCalled();
});

it.each(['resolve', 'reject'] as const)(
  'does not let a stopped registrar remove the next generation pane when its pending register later %s',
  async outcome => {
    let finishOldRegister!: (id: string) => void;
    let failOldRegister!: (error: Error) => void;
    const oldRegister = new Promise<string>((resolve, reject) => {
      finishOldRegister = resolve;
      failOldRegister = reject;
    });
    const registered: Array<{ id: string; attempt: number }> = [];
    let registerCalls = 0;
    const register = vi.fn(async (options: { id: string }) => {
      registerCalls += 1;
      // Zotero 9.0.6 checks duplicates before asynchronous work, then appends without checking again.
      // Its unregister path removes every pane with the id. Keep that order: the old generation has
      // passed its duplicate check but has not appended when the new generation begins registering.
      if (registered.some(pane => pane.id === options.id)) throw new Error(`Pane with ID ${options.id} already registered`);
      if (registerCalls === 1) {
        return oldRegister.then(id => { registered.push({ id, attempt: 1 }); return id; });
      }
      registered.push({ id: options.id, attempt: registerCalls });
      return options.id;
    });
    const unregister = vi.fn((id: string) => {
      for (let index = registered.length - 1; index >= 0; index -= 1) {
        if (registered[index]?.id === id) registered.splice(index, 1);
      }
    });
    const logError = vi.fn<(error: unknown) => void>();
    const hostValue: PreferencePaneRegistrarHost = {
      panes: { register, unregister }, pluginID: 'zchatgpt@example.invalid', rootURI, logError,
    };

    const oldRegistrar = createPreferencePaneRegistrar(hostValue);
    const oldEnsure = oldRegistrar.ensure();
    expect(registerCalls).toBe(1);
    expect(registered).toHaveLength(0);
    const oldRemoval = oldRegistrar.remove();

    const newRegistrar = createPreferencePaneRegistrar(hostValue);
    // Zotero waits for plugin shutdown before starting the next generation. Removal must represent
    // the in-flight registration's cleanup, so that sequence cannot begin while it still owns an id.
    const newEnsure = Promise.resolve(oldRemoval).then(() => newRegistrar.ensure());
    await Promise.resolve(); await Promise.resolve();
    expect(registerCalls).toBe(1);

    if (outcome === 'resolve') finishOldRegister(PREFERENCES_PANE_ID);
    else failOldRegister(new Error('old registration failed after re-enable'));
    await expect(oldEnsure).resolves.toBeUndefined();
    await oldRemoval;
    await expect(newEnsure).resolves.toBe(PREFERENCES_PANE_ID);

    // The new pane is the only one left after the old generation settles.
    expect(registered).toEqual([{ id: PREFERENCES_PANE_ID, attempt: 2 }]);
    expect(logError).not.toHaveBeenCalled();
  },
);

it('clears a stale pane that still owns the fixed id and retries registration once', async () => {
  const register = vi.fn<(options: unknown) => Promise<string>>()
    .mockRejectedValueOnce(new Error(`Pane with ID ${PREFERENCES_PANE_ID} already registered`))
    .mockResolvedValueOnce(PREFERENCES_PANE_ID);
  const unregister = vi.fn<(id: string) => void>();
  const logError = vi.fn<(error: unknown) => void>();
  const registrar = createPreferencePaneRegistrar({ panes: { register, unregister }, pluginID: 'zchatgpt@example.invalid', rootURI, logError });
  await expect(registrar.ensure()).resolves.toBe(PREFERENCES_PANE_ID);
  expect(register).toHaveBeenCalledTimes(2);
  expect(unregister).toHaveBeenCalledWith(PREFERENCES_PANE_ID);
  expect(logError).not.toHaveBeenCalled();
});

it('reports an honest failure without breaking the plugin and retries on the next startup', async () => {
  const register = vi.fn<(options: unknown) => Promise<string>>().mockRejectedValue(new Error('preferences window unavailable'));
  const unregister = vi.fn<(id: string) => void>();
  const logError = vi.fn<(error: unknown) => void>();
  const registrar = createPreferencePaneRegistrar({ panes: { register, unregister }, pluginID: 'zchatgpt@example.invalid', rootURI, logError });
  await expect(registrar.ensure()).resolves.toBeUndefined();
  expect(registrar.id).toBeUndefined();
  expect(logError).toHaveBeenCalledOnce();
  const message = String((logError.mock.calls[0]?.[0] as Error).message);
  expect(message).toContain('preferences pane could not be registered');
  expect(message).toContain('preferences window unavailable');
  // Nothing is registered now, so cleanup must not unregister anything else.
  const staleAttempts = unregister.mock.calls.length;
  await registrar.remove();
  expect(unregister.mock.calls.length).toBe(staleAttempts);
  // The next startup tries again instead of giving up for the whole session.
  const next = createPreferencePaneRegistrar({ panes: { register, unregister }, pluginID: 'zchatgpt@example.invalid', rootURI, logError });
  await expect(next.ensure()).resolves.toBeUndefined();
  expect(register).toHaveBeenCalledTimes(4);
});

it('is safe when the host exposes no PreferencePanes API', async () => {
  const { logError } = host();
  const registrar = createPreferencePaneRegistrar({ panes: undefined, pluginID: 'zchatgpt@example.invalid', rootURI, logError });
  await expect(registrar.ensure()).resolves.toBeUndefined();
  expect(registrar.id).toBeUndefined();
  await registrar.remove();
  expect(logError).not.toHaveBeenCalled();
});
