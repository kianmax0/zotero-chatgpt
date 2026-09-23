import { RuntimeFailure, type LoginFlow, type ManagedProcess, type ModelOption, type ReaderClient, type RuntimeSnapshot, type StoragePort } from '../../contracts/src/runtime.ts';
import { clone } from '../../contracts/src/clone.ts';
import type { Conversation, ErrorCode, GenerationSettings, ImageAttachment, PaperScope, ReaderEvent, SendInput, SendReceipt, ShareableDiagnostics } from '../../contracts/src/index.ts';
import type { ChatExecutorPort, ChatTransport } from '../../contracts/src/execution.ts';
import { record } from './codex/transport.ts';
import { openCodexConnection, type CodexConnection, type ConnectCodex } from './codex/connection.ts';
import { mergeRateLimitNotice, parseModel, parseProviderCapabilities, parseRateLimits, string, visibleRateLimits, type RateLimitBuckets } from './codex/models.ts';
import type { Trace } from './conversation/trace.ts';
import { ChatExecutor } from './chat/executor.ts';
import { CHAT_TRANSPORT_UNAVAILABLE_MESSAGE, unavailableChatTransport } from './chat/chat-transport.ts';
import { ConversationStore } from './sessions/store.ts';
import { ReaderService } from './sessions/service.ts';
export { shareableDiagnostics } from './sessions/diagnostics.ts';
export type { ShareableDiagnostics } from './sessions/diagnostics.ts';
/**
 * `codexHome`, when known to the caller, must equal the account directory the runtime reports.
 * `chatTransport` injects the Chat backend; the default is the honest unavailable placeholder, so
 * Chat can never silently become a Codex call.
 */
export interface ReaderOptions { codexVersion: string; cwd: string; uuid: () => string; pluginVersion?: string; loginTimeoutMs?: number; codexHome?: string; deltaFlushMs?: number; now?: () => string; generatedImage?: (item: unknown, model: string) => Promise<ImageAttachment>; chatTransport?: ChatTransport; /** Development sink for the Chat/Agent execution trace; off unless supplied. */ trace?: Trace }
/**
 * Builds the shared reader client over local records. Constructing it performs no Codex work: the
 * handshake happens only when the Agent runtime is actually asked for something (`refreshAccount`,
 * the first Agent send, or login). `processOrConnect` is either a spawned process (tests) or the lazy
 * connector the Agent runtime hands over (production); neither is touched here.
 */
export function createReaderClient(processOrConnect: ManagedProcess | ConnectCodex, storage: StoragePort, options: ReaderOptions): Promise<ReaderClient> {
  // macOS uses the pinned bundled runtime; Linux uses the system CLI and reports `system` here.
  if ((options.codexVersion !== '0.156.1' && options.codexVersion !== 'system') || !options.cwd) return Promise.reject(new RuntimeFailure('Unsupported runtime version or directory'));
  const connect: ConnectCodex = typeof processOrConnect === 'function'
    ? processOrConnect
    : () => openCodexConnection(processOrConnect, { codexVersion: options.codexVersion, cwd: options.cwd, ...(options.pluginVersion ? { pluginVersion: options.pluginVersion } : {}), ...(options.codexHome ? { codexHome: options.codexHome } : {}) });
  return Promise.resolve(new RuntimeSession(connect, storage, options));
}
/** Owns the lazily-opened Codex channel, account/login/model state and routes notices to the service. */
class RuntimeSession implements ReaderClient {
  private state: RuntimeSnapshot;
  private observers = new Set<(snapshot: RuntimeSnapshot) => void>();
  private changes = Promise.resolve();
  private queued = 0;
  private failureStarted = false;
  /** The live Codex channel, opened on first use. Null until something needs the Agent runtime. */
  private connection: CodexConnection | null = null;
  private connecting: Promise<CodexConnection> | null = null;
  private agentReady: Promise<void> | null = null;
  private loginFlight: Promise<LoginFlow> | null = null;
  private loginTimer: ReturnType<typeof setTimeout> | null = null;
  private loginNotices = new Map<string, Record<string, unknown>>();
  private closing = false;
  private closeFlight: Promise<void> | null = null;
  private service: ReaderService;
  private accountEpoch = 0;
  private accountRefresh: { epoch: number; promise: Promise<void> } | null = null;
  private optionalNext: { epoch: number; signedIn: boolean } | null = null;
  private optionalFlight: Promise<void> | null = null;
  private rateBuckets: RateLimitBuckets | null = null;
  private rateNoticeVersion = 0;
  private readonly chat: ChatExecutorPort;
  constructor(private connect: ConnectCodex, storage: StoragePort, private options: ReaderOptions) {
    const now = options.now ?? (() => new Date().toISOString());
    this.state = { revision: 0, runtime: 'ready', account: { state: 'signedOut' }, login: null, models: [], error: null };
    this.chat = new ChatExecutor(options.chatTransport ?? unavailableChatTransport());
    this.service = new ReaderService(new ConversationStore(storage, { uuid: options.uuid, now }), {
      // The single lazily-opening edge to Codex. `ready` is false until a channel exists, so the
      // service never thinks the Agent runtime is available just because this object was built.
      request: async (method, params) => (await this.ensureConnection()).request(method, params),
      models: () => this.state.models,
      ready: () => this.state.runtime === 'ready' && !this.closing && this.connection !== null,
      signedIn: () => this.state.account.state === 'signedIn',
      breach: () => { this.state.runtime = 'error'; this.state.error = 'Reader policy rejected an unsupported interaction.'; this.emit(); void this.connection?.close().catch(() => undefined); },
    }, // Chat and Agent are sibling executors of one shared conversation controller. Chat's concrete
      // ChatGPT transport is an unresolved platform boundary, so this build wires the honest
      // unavailable placeholder: Chat fails truthfully instead of falling back to the Codex runtime.
      { cwd: options.cwd, uuid: options.uuid, now, ...(options.deltaFlushMs !== undefined ? { deltaFlushMs: options.deltaFlushMs } : {}), ...(options.generatedImage ? { generatedImage: options.generatedImage } : {}), chat: this.chat, chatAvailable: this.chat.available, chatUnavailable: CHAT_TRANSPORT_UNAVAILABLE_MESSAGE, ...(options.trace ? { trace: options.trace } : {}) });
  }
  // ---- lazy Codex channel ----------------------------------------------------------------------
  /**
   * Opens the Codex channel on first use and subscribes to it exactly once. Nothing before this call
   * spawns, connects to or queries Codex, so constructing the client (and opening the sidebar) is
   * free of Agent runtime work.
   */
  private ensureConnection(): Promise<CodexConnection> {
    if (this.closing) return Promise.reject(new RuntimeFailure('Runtime stopped'));
    if (this.connection) return Promise.resolve(this.connection);
    if (this.connecting) return this.connecting;
    const flight = this.connect().then(connection => {
      if (this.closing) { void connection.close().catch(() => undefined); throw new RuntimeFailure('Runtime stopped'); }
      this.connection = connection;
      connection.subscribe(message => this.acceptNotice(message));
      connection.onFailure(() => { if (!this.closing) void this.transportFailed(); });
      return connection;
    });
    this.connecting = flight;
    void flight.catch(() => { if (this.connecting === flight) this.connecting = null; }).catch(() => undefined);
    return flight;
  }
  /**
   * Agent readiness: the Codex channel plus the account/model catalog. Agent-only actions await this;
   * the Chat path never does, which is what keeps Chat independent of the Agent runtime.
   */
  ensureAgentReady(): Promise<void> {
    if (!this.agentReady) {
      const flight = this.ensureConnection().then(() => this.refreshAccount());
      this.agentReady = flight;
      void flight.catch(() => { if (this.agentReady === flight) this.agentReady = null; }).catch(() => undefined);
    }
    // Runtime readiness is cached; recovery is not. A conversation can be loaded locally in Chat
    // after the runtime was warmed by another Agent session, and must wait for a new explicit Agent
    // activation before any thread/resume or queued turn occurs.
    return this.agentReady.then(() => this.service.activateAgent());
  }
  /** Null when a supported Chat transport is integrated; otherwise the honest reason Chat cannot run. */
  chatUnavailableReason(): string | null { return this.chat.available ? null : CHAT_TRANSPORT_UNAVAILABLE_MESSAGE; }
  /**
   * Drop a dead channel and open a fresh one. Used by the explicit retry affordance; it fails closed
   * (throws) because returning a half-ready client would let a request look sent when it was not.
   */
  async reconnect(): Promise<void> {
    if (this.closing) throw new RuntimeFailure('Runtime stopped');
    const previous = this.connection; this.connection = null; this.connecting = null; this.agentReady = null;
    this.failureStarted = false;
    if (previous) await previous.close().catch(() => undefined);
    this.state.runtime = 'ready'; this.state.error = null; this.state.account = { state: 'signedOut' }; this.state.login = null; this.state.models = [];
    this.invalidateAccountExtras(); this.emit();
    await this.refreshAccount();
    await this.service.activateAgent();
  }
  private acceptNotice(message: Record<string, unknown>): void {
    if (this.closing || this.failureStarted) return;
    if (this.queued >= 1024) { void this.transportFailed(); return; }
    this.queued++;
    void this.enqueueNotice(async () => { try { if (!this.failureStarted && !this.closing) await this.notice(message); } finally { this.queued--; } });
  }
  // ---- reactive runtime state -----------------------------------------------------------------
  snapshot(): RuntimeSnapshot { return clone(this.state); }
  observe(listener: (snapshot: RuntimeSnapshot) => void) { this.observers.add(listener); listener(this.snapshot()); return () => { this.observers.delete(listener); }; }
  private emit() {
    this.state.revision++;
    for (const listener of this.observers) { try { listener(this.snapshot()); } catch { /* View failures do not stop the service. */ } }
  }
  private enqueueNotice(operation: () => Promise<void>): Promise<void> {
    const result = this.changes.then(operation);
    this.changes = result.catch(async () => {
      this.state.runtime = 'error'; this.state.error = 'Unable to process a runtime notification safely.'; this.emit();
      const failed = this.connection; this.connection = null;
      await failed?.close().catch(() => undefined);
    });
    return this.changes;
  }
  private async transportFailed() {
    if (this.failureStarted || this.closing) return;
    this.failureStarted = true;
    this.invalidateAccountExtras();
    this.state.runtime = 'error'; this.state.error = 'Codex connection ended.'; this.emit();
    // Drop the dead channel so an explicit retry can open a fresh one instead of reusing it.
    const failed = this.connection; this.connection = null; this.connecting = null; this.agentReady = null;
    void failed?.close().catch(() => undefined);
    await this.service.settleAll('The Codex connection ended before confirmation; this request will not be resent.');
    await this.enqueueNotice(() => {
      this.clearLoginTimer();
      if (this.state.login?.state === 'pending') { this.state.login = { ...this.state.login, state: 'failed', message: 'Codex connection ended during login.' }; this.state.account = { state: 'signedOut' }; this.loginFlight = null; }
      this.emit(); return Promise.resolve();
    });
  }
  private invalidateAccountExtras(): void {
    this.accountEpoch++; this.optionalNext = null; this.rateBuckets = null; this.rateNoticeVersion++; delete this.state.rateLimits;
  }
  refreshAccount(): Promise<void> {
    if (this.closing) return Promise.reject(new Error('Runtime stopped'));
    if (this.accountRefresh?.epoch === this.accountEpoch) return this.accountRefresh.promise;
    const hadLimits = this.state.rateLimits !== undefined; this.invalidateAccountExtras(); if (hadLimits) this.emit();
    const epoch = this.accountEpoch; const promise = this.readAccountAndModels(epoch);
    this.accountRefresh = { epoch, promise };
    void promise.finally(() => { if (this.accountRefresh?.promise === promise) this.accountRefresh = null; }).catch(() => undefined);
    return promise;
  }
  private async readAccountAndModels(epoch: number): Promise<void> {
    // Opening the channel is deliberately outside the masking catch: a connect failure (version,
    // policy, spawn) must surface as its own deliberate failure, not as a catalog read error.
    const connection = await this.ensureConnection();
    let accountVerified = false;
    try {
      const response = record(await connection.request('account/read', { refreshToken: false }));
      if (this.closing || epoch !== this.accountEpoch) return;
      if (typeof response.requiresOpenaiAuth !== 'boolean') throw new Error('Protocol account invalid');
      if (response.account === null) this.state.account = { state: 'signedOut' };
      else {
        const account = record(response.account);
        if (account.type !== 'chatgpt') throw new Error('Official ChatGPT login required');
        this.state.account = { state: 'signedIn', displayLabel: 'ChatGPT' };
      }
      accountVerified = true;
      const models: ModelOption[] = []; const cursors = new Set<string>(); let cursor: string | null = null;
      do {
        const page = record(await connection.request('model/list', { cursor, limit: 100, includeHidden: false }));
        if (this.closing || epoch !== this.accountEpoch) return;
        if (!Array.isArray(page.data) || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new Error('Protocol model list invalid');
        for (const data of page.data) { const model = parseModel(data); if (model) models.push(model); }
        cursor = page.nextCursor;
        if (cursor && (cursors.has(cursor) || cursors.size >= 20)) throw new Error('Protocol pagination invalid');
        if (cursor) cursors.add(cursor);
        if (models.length > 1000) throw new Error('Protocol model list too large');
      } while (cursor);
      if (new Set(models.map(m => m.id)).size !== models.length) throw new Error('Protocol duplicate model');
      this.state.models = models; this.state.error = null; this.emit();
      this.queueOptional(epoch, this.state.account.state === 'signedIn');
    } catch { if (this.closing || epoch !== this.accountEpoch) return; this.state.models = []; this.state.error = 'Unable to read the official account or model catalog.'; this.emit(); if (accountVerified && this.state.account.state === 'signedOut') return; throw new RuntimeFailure(this.state.error); }
  }
  private queueOptional(epoch: number, signedIn: boolean): void {
    if (this.closing || epoch !== this.accountEpoch) return;
    this.optionalNext = { epoch, signedIn }; if (this.optionalFlight) return;
    const flight = this.readOptional(); this.optionalFlight = flight;
    void flight.finally(() => {
      if (this.optionalFlight === flight) this.optionalFlight = null;
      const next = this.optionalNext; if (next && !this.closing) this.queueOptional(next.epoch, next.signedIn);
    }).catch(() => undefined);
  }
  private async readOptional(): Promise<void> {
    while (this.optionalNext && !this.closing) {
      const requested = this.optionalNext; this.optionalNext = null;
      if (requested.epoch !== this.accountEpoch) continue;
      const noticeVersion = this.rateNoticeVersion;
      const applyProvider = (value: unknown) => {
        if (this.closing || requested.epoch !== this.accountEpoch) return;
        const before = JSON.stringify(this.state.capabilities); const capabilities = parseProviderCapabilities(value);
        if (capabilities) this.state.capabilities = capabilities; else delete this.state.capabilities;
        if (JSON.stringify(this.state.capabilities) !== before) this.emit();
      };
      const applyRates = (value: unknown) => {
        // A late full read must not replace newer rolling usage already received.
        if (this.closing || requested.epoch !== this.accountEpoch || this.state.account.state !== 'signedIn' || noticeVersion !== this.rateNoticeVersion) return;
        const before = JSON.stringify(this.state.rateLimits); this.rateBuckets = parseRateLimits(value);
        const visible = visibleRateLimits(this.rateBuckets); if (visible) this.state.rateLimits = visible; else delete this.state.rateLimits;
        if (JSON.stringify(this.state.rateLimits) !== before) this.emit();
      };
      const connection = this.connection;
      if (!connection) continue;
      await Promise.allSettled([
        connection.requestOptional('modelProvider/capabilities/read', {}).then(applyProvider, () => applyProvider(undefined)),
        requested.signedIn ? connection.requestOptional('account/rateLimits/read', {}).then(applyRates, () => applyRates(undefined)) : Promise.resolve(),
      ]);
    }
  }
  startLogin(): Promise<LoginFlow> {
    if (this.closing || this.state.runtime !== 'ready') return Promise.reject(new Error('Runtime unavailable'));
    if (this.loginFlight) return this.loginFlight.then(flow => ({ ...flow }));
    this.invalidateAccountExtras();
    this.state.login = null; this.loginNotices.clear();
    this.state.account = { state: 'signingIn' }; this.state.error = null; this.emit();
    const flight = this.beginLogin(); this.loginFlight = flight;
    void flight.catch(() => { this.loginFlight = null; });
    return flight.then(flow => ({ ...flow }));
  }
  private async beginLogin(): Promise<LoginFlow> {
    try {
      // Login is an explicit Agent-runtime request: it is allowed to open the channel.
      const connection = await this.ensureConnection();
      const response = record(await connection.request('account/login/start', { type: 'chatgpt' }));
      if (this.closing) throw new Error('Runtime stopped');
      const loginId = string(response.loginId); const url = new URL(string(response.authUrl));
      if (response.type !== 'chatgpt' || !loginId || url.protocol !== 'https:' || url.hostname !== 'auth.openai.com' || url.username || url.password || (url.port && url.port !== '443')) {
        if (loginId) await connection.request('account/login/cancel', { loginId }).catch(() => undefined);
        throw new Error('Invalid official login URL');
      }
      this.state.login = { loginId, state: 'pending' }; this.emit();
      this.loginTimer = setTimeout(() => { void this.finishLoginCancel(true); }, Math.min(Math.max(this.options.loginTimeoutMs ?? 300_000, 100), 300_000));
      const early = this.loginNotices.get(loginId); this.loginNotices.clear();
      if (early) await this.applyLoginNotice(early);
      return { loginId, authorizationUrl: url.href };
    } catch { if (this.closing) throw new Error('Runtime stopped'); this.state.account = { state: 'signedOut' }; this.state.error = 'Unable to start official ChatGPT login.'; this.emit(); throw new Error(this.state.error); }
  }
  async cancelLogin() {
    if (this.loginFlight && !this.state.login) await this.loginFlight.catch(() => undefined);
    await this.finishLoginCancel(false);
  }
  private clearLoginTimer() { if (this.loginTimer) clearTimeout(this.loginTimer); this.loginTimer = null; }
  private async finishLoginCancel(timeout: boolean) {
    const login = this.state.login;
    if (!login || login.state !== 'pending') return;
    this.clearLoginTimer(); this.state.login = { ...login, state: timeout ? 'failed' : 'cancelled', ...(timeout ? { message: 'Login timed out. Start a new login to continue.' } : {}) };
    this.state.account = { state: 'signedOut' }; this.loginFlight = null; this.invalidateAccountExtras(); this.emit();
    try {
      const connection = this.connection; if (!connection) throw new Error('No connection');
      const result = record(await connection.request('account/login/cancel', { loginId: login.loginId }));
      if (!['canceled', 'notFound'].includes(string(result.status))) throw new Error('Protocol cancel invalid');
    }
    catch { this.state.error = 'Login cancellation could not be confirmed.'; this.emit(); }
  }
  private async applyLoginNotice(params: Record<string, unknown>) {
    const login = this.state.login;
    if (this.closing || !login || login.loginId !== params.loginId || login.state !== 'pending') return;
    if (typeof params.success !== 'boolean') throw new Error('Protocol login completion invalid');
    this.clearLoginTimer(); this.loginFlight = null;
    this.state.login = { loginId: login.loginId, state: params.success ? 'succeeded' : 'failed', ...(!params.success ? { message: 'Official login did not complete.' } : {}) };
    this.state.account = { state: 'signedOut' }; this.invalidateAccountExtras(); this.emit();
    if (params.success) await this.refreshAccount().catch(() => undefined);
  }
  // ---- notifications --------------------------------------------------------------------------
  private async notice(message: Record<string, unknown>) {
    const method = string(message.method);
    if (method === 'account/rateLimits/updated' && !('id' in message)) {
      if (this.state.account.state !== 'signedIn') return;
      const previous = JSON.stringify(this.state.rateLimits);
      this.rateBuckets = mergeRateLimitNotice(message.params, this.rateBuckets);
      const visible = visibleRateLimits(this.rateBuckets); if (visible) this.state.rateLimits = visible; else delete this.state.rateLimits;
      if (JSON.stringify(this.state.rateLimits) !== previous) { this.rateNoticeVersion++; this.emit(); }
      return;
    }
    const params = record(message.params ?? {});
    if ('id' in message) {
      // Server-initiated requests (approvals, tools) are never granted; the affected request fails closed.
      const connection = this.connection;
      if (connection) {
        if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(string(message.method))) await connection.respond(message.id, { decision: 'decline' });
        else await connection.rejectRequest(message.id);
      }
      if (typeof params.threadId === 'string') await this.service.failThread(params.threadId, 'UNSUPPORTED_INTERACTION', 'Unsupported tool or approval interaction was rejected.');
      this.state.runtime = 'error'; this.state.error = 'Reader policy rejected an unsupported interaction.'; this.emit();
      await connection?.close().catch(() => undefined); return;
    }
    if (method === 'account/login/completed') {
      if (typeof params.loginId !== 'string') return;
      if (!this.state.login) { if (this.loginNotices.size >= 16) this.loginNotices.clear(); this.loginNotices.set(params.loginId, params); }
      else await this.applyLoginNotice(params);
      return;
    }
    if (method === 'account/updated') { void this.refreshAccount().catch(() => undefined); return; }
    this.service.handleNotice(method, params);
  }
  // ---- conversations (delegated) --------------------------------------------------------------
  current(paper: PaperScope, title: string, settings?: GenerationSettings): Promise<Conversation> { return this.service.current(paper, title, settings); }
  peekCurrent(paper: PaperScope): Promise<Conversation | null> { return this.service.peekCurrent(paper); }
  newConversation(paper: PaperScope, title: string, settings?: GenerationSettings): Promise<Conversation> { return this.service.newConversation(paper, title, settings); }
  list(paper: PaperScope): Promise<Conversation[]> { return this.service.list(paper); }
  get(conversationId: string): Promise<Conversation> { return this.service.get(conversationId); }
  select(paper: PaperScope, conversationId: string): Promise<Conversation> { return this.service.select(paper, conversationId); }
  renameConversation(conversationId: string, title: string): Promise<Conversation> { return this.service.renameConversation(conversationId, title); }
  branchConversation(conversationId: string, messageId: string): Promise<Conversation> { return this.service.branchConversation(conversationId, messageId); }
  deleteConversation(paper: PaperScope, conversationId: string): Promise<Conversation | null> { return this.service.deleteConversation(paper, conversationId); }
  send(input: SendInput): Promise<SendReceipt> { return this.service.send(input); }
  enqueue(input: SendInput): Promise<SendReceipt> { return this.service.enqueue(input); }
  releaseBatch(conversationId: string, batchId: string): Promise<void> { return this.service.releaseBatch(conversationId, batchId); }
  request(conversationId: string, requestId: string): Promise<SendReceipt> { return this.service.request(conversationId, requestId); }
  cancel(conversationId: string, requestId: string): Promise<SendReceipt> { return this.service.cancel(conversationId, requestId); }
  diagnostics(conversationId: string): Promise<ShareableDiagnostics> {
    return this.service.diagnostics(conversationId, {
      pluginVersion: this.options.pluginVersion ?? '0.1.0',
      runtimeVersion: this.options.codexVersion,
      errorCode: this.runtimeErrorCode(),
    });
  }
  subscribe(listener: (event: ReaderEvent) => void): () => void { return this.service.subscribe(listener); }
  private runtimeErrorCode(): ErrorCode | null {
    if (this.state.runtime !== 'error') return null;
    if (this.state.error === 'Codex connection ended.') return 'CODEX_EXITED';
    if (this.state.error === 'Reader policy rejected an unsupported interaction.') return 'READER_POLICY_UNAVAILABLE';
    return 'RUNTIME_UNAVAILABLE';
  }
  // ---- shutdown -------------------------------------------------------------------------------
  close(): Promise<void> {
    if (this.closeFlight) return this.closeFlight;
    this.closing = true; this.clearLoginTimer();
    this.invalidateAccountExtras();
    if (this.state.login?.state === 'pending') this.state.login = { ...this.state.login, state: 'cancelled' };
    if (this.state.account.state === 'signingIn') this.state.account = { state: 'signedOut' };
    this.loginFlight = null;
    this.closeFlight = this.stop(); return this.closeFlight;
  }
  private async stop() {
    // Fail the channel first so pending RPC calls cannot hold shutdown open. A client that never
    // touched Codex has no channel at all, and closing it must not create one.
    const connection = this.connection; this.connection = null;
    const termination = connection ? connection.close() : Promise.resolve();
    termination.catch(() => undefined);
    await this.service.close();
    this.state.runtime = 'stopped'; this.emit();
    this.observers.clear();
    await termination;
  }
}
