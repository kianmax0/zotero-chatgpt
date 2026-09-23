import { FakeProcess } from './doubles.ts';
export const model = { id: 'catalog-entry', model: 'catalog-default', upgrade: null, upgradeInfo: null, availabilityNux: null, displayName: 'Catalog Default', description: 'Test fixture', hidden: false, supportedReasoningEfforts: [{ reasoningEffort: 'medium', description: 'Balanced' }], defaultReasoningEffort: 'medium', inputModalities: ['text'], supportsPersonality: false, additionalSpeedTiers: [], serviceTiers: [{ id: 'priority', name: 'Priority', description: 'Priority service' }], defaultServiceTier: 'priority', isDefault: true };
// Paper threads are kept by the plugin-private Codex home (ephemeral: false) so they can be resumed.
export const thread = { id: 'thread-1', sessionId: 'session-1', forkedFromId: null, parentThreadId: null, preview: '', ephemeral: false, modelProvider: 'openai', createdAt: 1, updatedAt: 1, recencyAt: null, status: { type: 'idle' }, path: null, cwd: '/isolated', cliVersion: '0.156.1', source: 'appServer', threadSource: null, agentNickname: null, agentRole: null, gitInfo: null, name: null, turns: [] };
export const threadResponse = { thread, model: model.model, modelProvider: 'openai', serviceTier: 'priority', cwd: '/isolated', instructionSources: [], approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'readOnly', networkAccess: false }, reasoningEffort: 'medium' };
export const turn = { id: 'turn-1', items: [], itemsView: 'full', status: 'inProgress', error: null, startedAt: 1, completedAt: null, durationMs: null };
export function server() {
  const p = new FakeProcess();
  const handlers = new Map<string, (params: Record<string, unknown>, id: unknown) => unknown>();
  let threads = 0; let turns = 0;
  const imagePermissions = new Map<string, boolean>();
  handlers.set('initialize', () => ({ userAgent: 'codex/0.156.1', codexHome: '/isolated/auth', platformFamily: 'unix', platformOs: 'macos' }));
  handlers.set('config/read', () => configResponse());
  handlers.set('account/read', () => ({ account: { type: 'chatgpt', email: 'private@example.test', planType: 'plus' }, requiresOpenaiAuth: true }));
  handlers.set('model/list', () => ({ data: [model], nextCursor: null }));
  handlers.set('modelProvider/capabilities/read', () => ({ imageGeneration: true, namespaceTools: true, webSearch: true }));
  handlers.set('account/rateLimits/read', () => ({ rateLimits: null, rateLimitsByLimitId: {} }));
  handlers.set('experimentalFeature/list', params => ({ data: [{ name: 'image_generation', enabled: imagePermissions.get(String(params.threadId)) ?? false }], nextCursor: null }));
  handlers.set('thread/start', params => { threads++; const id = threads === 1 ? 'thread-1' : `thread-${threads}`; imagePermissions.set(id, (params.config as Record<string, unknown>)['features.image_generation'] === true); return { ...threadResponse, thread: { ...thread, id } }; });
  handlers.set('thread/resume', params => { imagePermissions.set(String(params.threadId), (params.config as Record<string, unknown>)['features.image_generation'] === true); return { ...threadResponse, thread: { ...thread, id: params.threadId as string, turns: [{ id: 'earlier' }] } }; });
  handlers.set('thread/read', params => ({ thread: { ...thread, id: params.threadId as string, turns: [] } }));
  handlers.set('turn/start', params => { turns++; return { turn: { ...turn, id: turns === 1 ? 'turn-1' : `turn-${turns}`, threadId: params.threadId } }; });
  handlers.set('turn/interrupt', () => ({}));
  handlers.set('account/login/start', () => ({ type: 'chatgpt', loginId: 'login-1', authUrl: 'https://auth.openai.com/oauth/authorize?state=secret' }));
  handlers.set('account/login/cancel', () => ({ status: 'canceled' }));
  p.onWrite = m => {
    if (!('id' in m) || typeof m.method !== 'string') return;
    try {
      const result = handlers.get(m.method)?.((m.params ?? {}) as Record<string, unknown>, m.id);
      if (result === undefined) return;
      if (result && typeof result === 'object' && typeof (result as Promise<unknown>).then === 'function') {
        void (result as Promise<unknown>).then(
          value => { p.emit({ id: m.id, result: value }); },
          () => { p.emit({ id: m.id, error: { code: -32000, message: 'handler failed' } }); },
        );
        return;
      }
      p.emit({ id: m.id, result });
    } catch {
      p.emit({ id: m.id, error: { code: -32000, message: 'handler failed' } });
    }
  };
  return { p, handlers };
}
export function methods(p: FakeProcess) { return p.writes.map(line => (JSON.parse(line) as { method: string }).method); }
// Sanitized 0.154.0 config/read shape, mirroring a live isolated probe of the pinned
// binary launched with the plugin policy (2026-09-13). Configuration is explicitly
// authored at this external boundary; it is not derived from production launch arguments.
export const policyConfig = {
  model: null, review_model: null, model_context_window: null, model_auto_compact_token_limit: null, model_auto_compact_token_limit_scope: null, model_provider: null,
  approval_policy: 'never', approvals_reviewer: 'user', sandbox_mode: 'read-only', sandbox_workspace_write: null,
  forced_chatgpt_workspace_id: null, forced_login_method: null, web_search: 'disabled', tools: { web_search: null },
  instructions: null, developer_instructions: null, compact_prompt: null, model_reasoning_effort: null, model_reasoning_summary: null, model_verbosity: null, service_tier: null, desktop: null,
  analytics: { enabled: false }, apps: null, plugins: {}, openai_base_url: null, marketplaces: {}, check_for_update_on_startup: false, permissions: null,
  hooks: null, experimental_thread_store_endpoint: null, notice: null, project_doc_max_bytes: 0, notify: null, mcp_oauth_callback_url: null,
  allow_login_shell: false, experimental_thread_store: null, cli_auth_credentials_store: 'file', feedback: { enabled: false },
  default_permissions: ':read-only', hide_agent_reasoning: false,
  skills: { bundled: { enabled: false }, include_instructions: false },
  features: { network_proxy: null, apps: false, auth_elicitation: false, browser_use: false, browser_use_external: false, browser_use_full_cdp_access: false, code_mode_host: false, computer_use: false, goals: false, hooks: false, image_generation: false, in_app_browser: false, mentions_v2: false, multi_agent: false, plugin_sharing: false, plugins: false, remote_plugin: false, shell_snapshot: false, shell_tool: false, skill_mcp_dependency_install: false, tool_call_mcp_elicitation: false, tool_suggest: false, unified_exec: false, workspace_dependencies: false, memories: false, remote_control: false },
  orchestrator: { skills: { enabled: false }, mcp: { enabled: false } }, model_providers: {}, project_root_markers: null, project_doc_fallback_filenames: [],
  include_collaboration_mode_instructions: false, chatgpt_base_url: 'https://chatgpt.com/backend-api/', include_environment_context: false,
  shell_environment_policy: { inherit: null, ignore_default_excludes: null, exclude: null, set: null, include_only: null, experimental_use_profile: null },
  profile: null, sqlite_home: null, profiles: {}, include_apps_instructions: false, memories: null, mcp_servers: {}, projects: null,
  history: { persistence: 'none', max_bytes: null },
};
export interface ConfigLayer { name: { type: string; file?: string; profile?: null }; version: string; config: Record<string, unknown> }
export interface ConfigOrigin { name: { type: string; file?: string; profile?: null }; version: string }
export function configResponse(): { config: typeof policyConfig; origins: Record<string, ConfigOrigin>; layers: ConfigLayer[] } {
  return { config: structuredClone(policyConfig), origins: { approval_policy: { name: { type: 'sessionFlags' }, version: 'sha256:synthetic-policy' }, 'features.shell_tool': { name: { type: 'sessionFlags' }, version: 'sha256:synthetic-policy' } }, layers: [
    { name: { type: 'sessionFlags' }, version: 'sha256:synthetic-policy', config: { approval_policy: 'never', features: { shell_tool: false } } },
    { name: { type: 'user', file: '/isolated/auth/config.toml', profile: null }, version: 'sha256:synthetic-empty', config: {} },
    { name: { type: 'system', file: '/etc/codex/config.toml' }, version: 'sha256:synthetic-empty', config: {} },
  ] };
}
