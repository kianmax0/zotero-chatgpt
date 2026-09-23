import type { ReaderClient, StoragePort } from '../../../contracts/src/runtime.ts';
import { WorkspaceStore } from '../../../core/src/workspace/store.ts';
import { ActionTaskController } from '../../../core/src/tasks/controller.ts';
import { ReadingCoordinator } from '../../../core/src/context/coordinator.ts';
import { createNativeActionPortFrom } from '../actions/native.ts';
import type { NativeZoteroHost } from '../host/native.ts';
import { createLibraryReferencePort } from '../library/reference.ts';
import type { ReaderDocumentCache } from '../reader/document.ts';
import { GeckoStorage, privateDirectory } from './storage.ts';
import type { RuntimeHost } from './prepare.ts';

/** Local records are available before the executable or account service starts. */
export async function openLocalStorage(host: RuntimeHost): Promise<StoragePort> {
  const records = await privateDirectory(host, host.profileDir, 'zotero-chatgpt/v1/records');
  return new GeckoStorage(host, records);
}
export function createLocalServices(host: RuntimeHost, zotero: unknown, namespace: string, documentCache: ReaderDocumentCache) {
  const clock = { uuid: () => host.uuid(), now: () => new Date().toISOString() };
  let storage: Promise<StoragePort> | undefined;
  let workspace: Promise<WorkspaceStore> | undefined;
  let tasks: Promise<ActionTaskController> | undefined;
  let stopped = false;
  let activeReader: { client: ReaderClient; coordinator: Promise<ReadingCoordinator> } | undefined;
  let offlineReader: Promise<ReadingCoordinator> | undefined;
  const records = () => {
    if (stopped) return Promise.reject(new Error('Local services stopped.'));
    return storage ??= openLocalStorage(host).catch(error => { storage = undefined; throw error; });
  };
  const library = createLibraryReferencePort(zotero, { clientId: namespace, documentCache, ...clock });
  const getWorkspace = () => workspace ??= records().then(storage => new WorkspaceStore(storage, clock, { clientId: namespace })).catch(error => { workspace = undefined; throw error; });
  const getTasks = () => tasks ??= records().then(storage => new ActionTaskController(storage, createNativeActionPortFrom({ clientId: namespace, zotero: zotero as NativeZoteroHost }), {
    ...clock,
    key: () => (zotero as { Utilities: { generateObjectKey(): string } }).Utilities.generateObjectKey(),
  })).catch(error => { tasks = undefined; throw error; });
  const getReading = (client?: ReaderClient): Promise<ReadingCoordinator> => {
    if (stopped) return Promise.reject(new Error('Local services stopped.'));
    if (!client || client.snapshot().runtime !== 'ready') return offlineReader ??= records().then(storage => new ReadingCoordinator(null, storage, clock)).catch(error => { offlineReader = undefined; throw error; });
    if (activeReader?.client === client) return activeReader.coordinator;
    const previous = activeReader;
    const coordinator = records().then(async storage => {
      if (previous) await (await previous.coordinator).dispose();
      if (stopped) throw new Error('Local services stopped.');
      return new ReadingCoordinator(client, storage, clock);
    });
    const entry = { client, coordinator }; activeReader = entry;
    void coordinator.catch(() => { if (activeReader === entry) activeReader = undefined; });
    return coordinator;
  };
  return { getStorage: records, getWorkspace, getTasks, getReading, library, async stop(): Promise<void> {
    stopped = true;
    const work: Array<Promise<unknown>> = [];
    for (const reader of [activeReader?.coordinator, offlineReader]) if (reader) work.push(reader.then(reader => reader.dispose()));
    if (tasks) work.push((async () => {
      const controller = await tasks.catch(() => null);
      if (controller) for (const task of await controller.list()) {
        if (task.state === 'preparing' || task.state === 'running') await controller.cancel(task.id);
      }
    })());
    const outcomes = await Promise.allSettled(work);
    if (outcomes.some(outcome => outcome.status === 'rejected')) throw new Error('Some local tasks could not complete shutdown. Their records were preserved.');
  } };
}
