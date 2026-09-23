import { RuntimeFailure, type ManagedProcess } from '../../../contracts/src/runtime.ts';
import { RpcTransport, record } from './transport.ts';
import { validatePolicy } from './reader-policy.ts';

/**
 * The live protocol channel to one bundled Codex process. It is structurally the RPC transport, so
 * the runtime session can hold either a real transport or a test double without importing pipes.
 */
export interface CodexConnection {
  request(method: string, params: unknown): Promise<unknown>;
  requestOptional(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params?: unknown): Promise<void>;
  respond(id: unknown, result: unknown): Promise<void>;
  rejectRequest(id: unknown): Promise<void>;
  subscribe(listener: (message: Record<string, unknown>) => void): () => void;
  onFailure(listener: () => void): () => void;
  close(): Promise<void>;
}
export interface CodexConnectionOptions {
  codexVersion: string;
  cwd: string;
  pluginVersion?: string;
  /** When known to the caller, must equal the account directory the runtime reports. */
  codexHome?: string;
}
/**
 * Opens the Codex protocol channel on an already spawned process and completes the handshake:
 * `initialize`, the version and dedicated-account checks, `initialized`, then the policy read that
 * gates every later account or model call.
 *
 * This is the only Codex startup step, and callers run it lazily — only when something actually
 * needs the Agent runtime. Merely opening the sidebar or staying in Chat must never reach it.
 */
export type ConnectCodex = () => Promise<CodexConnection>;
export async function openCodexConnection(process: ManagedProcess, options: CodexConnectionOptions): Promise<CodexConnection> {
  const rpc = new RpcTransport(process);
  try {
    const response = record(await rpc.request('initialize', { clientInfo: { name: 'zotero_chatgpt', title: 'Zotero ChatGPT', version: options.pluginVersion ?? 'unknown' }, capabilities: { experimentalApi: false } }));
    // The bundled macOS runtime is pinned, while Linux reports the installed CLI as `system`.
    // In the latter case accept a semantic Codex version from the initialize handshake.
    const expectedVersion = options.codexVersion === '0.156.1' ? /^[^/]+\/0\.156\.1(?:\s|$)/u : /^[^/]+\/\d+\.\d+\.\d+(?:[-+][^\s]+)?(?:\s|$)/u;
    if (typeof response.userAgent !== 'string' || !expectedVersion.test(response.userAgent)) throw new RuntimeFailure('Unsupported runtime version');
    const codexHome = typeof response.codexHome === 'string' ? response.codexHome : '';
    if (!codexHome.startsWith('/') || (options.codexHome !== undefined && options.codexHome !== codexHome)) throw new RuntimeFailure('Reader policy unavailable: the runtime is not using the dedicated account directory');
    await rpc.notify('initialized');
    // Effective configuration and its provenance gate every later account or model call.
    validatePolicy(await rpc.request('config/read', { includeLayers: true, cwd: options.cwd }), codexHome);
    return rpc;
  } catch (error) { await rpc.close().catch(() => undefined); throw error; }
}
