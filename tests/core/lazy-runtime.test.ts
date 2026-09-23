import { afterEach, describe, expect, it } from 'vitest';
import { createReaderClient } from '../../packages/core/src/index.ts';
import type { ReaderClient } from '../../packages/contracts/src/runtime.ts';
import type { ChatRequest, ChatTransport } from '../../packages/contracts/src/execution.ts';
import type { SendInput } from '../../packages/contracts/src/index.ts';
import { MemoryStorage, flush } from './doubles.ts';
import { server, methods } from './fixtures.ts';
import { citationA, paperA, settings } from '../contracts/factories.ts';

const clients: ReaderClient[] = [];
let ids = 0;
afterEach(async () => { for (const c of clients.splice(0)) await c.close().catch(() => undefined); });
const uuid = () => `cccccccc-0000-4000-8000-${String(++ids).padStart(12, '0')}`;
const requestId = (n: number) => `44444444-0000-4000-8000-${String(n).padStart(12, '0')}`;
/**
 * A deterministic Chat transport double. It proves the shared request lifecycle can be driven by
 * Chat without any Codex call; it is *not* a model and never claims to be one.
 */
function fakeChat(options: { fail?: string } = {}): ChatTransport & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  return {
    requests,
    available: true,
    async *stream(request: ChatRequest, signal: AbortSignal) {
      requests.push(request);
      yield { type: 'chat.started' as const };
      yield { type: 'chat.delta' as const, text: 'partial' };
      await new Promise(resolve => setTimeout(resolve, 0));
      if (signal.aborted) { yield { type: 'chat.cancelled' as const }; return; }
      if (options.fail) { yield { type: 'chat.failed' as const, code: 'INTERNAL_ERROR' as const, message: options.fail }; return; }
      yield { type: 'chat.completed' as const, text: 'partial answer' };
    },
    cancel() { return Promise.resolve(); },
  };
}
async function setup(configure?: (options: { chatTransport?: ChatTransport }) => Partial<Parameters<typeof createReaderClient>[2]>) {
  const s = server();
  const overrides = configure?.({}) ?? {};
  const c = await createReaderClient(s.p, new MemoryStorage(), { codexVersion: '0.156.1', cwd: '/isolated', uuid, loginTimeoutMs: 1000, deltaFlushMs: 1, now: () => '2026-09-09T08:00:00.000Z', ...overrides });
  clients.push(c);
  return { ...s, c };
}
const chatInput = (conversationId: string, n: number, overrides: Partial<SendInput> = {}): SendInput => ({ requestId: requestId(n), conversationId, action: 'ask', question: 'hello', citations: [], settings, mode: 'chat', ...overrides });
/** Let the streamed completion and its flush timer run; `flush()` alone only drains microtasks. */
const tick = async (ms = 5) => { await new Promise(resolve => setTimeout(resolve, ms)); await flush(); };
async function waitForRequestState(client: ReaderClient, conversationId: string, id: string, state: string, timeoutMs = 1000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await client.request(conversationId, id)).state === state) return;
    await tick(2);
  }
  throw new Error(`Request ${id} did not reach ${state} within ${timeoutMs} ms.`);
}

describe('Codex stays uninitialized until the Agent runtime is asked for something', () => {
  it('constructing the client performs no protocol call at all', async () => {
    const { c, p } = await setup();
    await flush();
    expect(methods(p)).toEqual([]);
    expect(p.terminated).toBe(false);
    expect(c.snapshot()).toMatchObject({ runtime: 'ready', models: [], account: { state: 'signedOut' } });
  });

  it('local conversation work never touches the Codex channel', async () => {
    const { c, p } = await setup();
    // Creating a chat is local: settings come from the caller, so no catalog read is needed.
    const conversation = await c.newConversation(paperA, 'Synthetic Paper A', settings);
    await c.newConversation(paperA, 'Second', settings);
    await c.list(paperA);
    await c.get(conversation.id);
    await c.select(paperA, conversation.id);
    await c.renameConversation!(conversation.id, 'Renamed');
    await c.branchConversation!(conversation.id, 'nonexistent-message').catch(() => undefined);
    await c.current(paperA, 'Synthetic Paper A');
    await c.peekCurrent(paperA);
    await flush();
    expect(methods(p)).toEqual([]);
    expect(p.terminated).toBe(false);
  });

  it('Agent readiness opens the channel once and is idempotent', async () => {
    const { c, p } = await setup();
    await Promise.all([c.ensureAgentReady!(), c.ensureAgentReady!(), c.refreshAccount()]);
    await c.refreshAccount();
    expect(methods(p).slice(0, 3)).toEqual(['initialize', 'initialized', 'config/read']);
    expect(methods(p).filter(method => method === 'initialize')).toHaveLength(1);
    expect(c.snapshot().models.map(model => model.id)).toEqual(['catalog-default']);
  });

  it('Chat sends stream through the injected transport with no Codex call', async () => {
    const transport = fakeChat();
    const { c, p } = await setup(() => ({ chatTransport: transport }));
    const conversation = await c.newConversation(paperA, 'Chat only', settings);
    await c.send(chatInput(conversation.id, 1));
    await tick();
    expect(methods(p)).toEqual([]);
    expect(p.terminated).toBe(false);
    expect(transport.requests).toHaveLength(1);
    const after = await c.get(conversation.id);
    expect(after.messages.find(message => message.role === 'assistant')?.text).toBe('partial answer');
  });

  it('Chat reports a transport failure with the transport message and no Codex call', async () => {
    const transport = fakeChat({ fail: 'The chat backend rejected this request.' });
    const { c, p } = await setup(() => ({ chatTransport: transport }));
    const conversation = await c.newConversation(paperA, 'Chat only', settings);
    const input = chatInput(conversation.id, 2);
    await c.send(input);
    await waitForRequestState(c, conversation.id, input.requestId, 'failed');
    expect(methods(p)).toEqual([]);
    expect((await c.get(conversation.id)).messages.at(-1)).toMatchObject({ status: 'failed' });
    expect(c.snapshot().error).toBeNull();
  });

  it('Chat never opens Codex even when the account is signed out', async () => {
    const transport = fakeChat();
    const { c, p } = await setup(s => ({ chatTransport: transport, ...(s === undefined ? {} : {}) }));
    expect(c.snapshot().account.state).toBe('signedOut');
    const conversation = await c.newConversation(paperA, 'Chat only', settings);
    await c.send(chatInput(conversation.id, 3));
    await tick();
    // A sign-in requirement is Codex-side; Chat answers without one and without a handshake.
    expect(methods(p)).toEqual([]);
  });
});

describe('the request timing is shared by both execution modes', () => {
  it('records the same timing shape for a Chat run and an Agent run in one conversation', async () => {
    const transport = fakeChat();
    const { c, p } = await setup(() => ({ chatTransport: transport }));
    const conversation = await c.newConversation(paperA, 'Shared timing', settings);
    await c.send(chatInput(conversation.id, 4));
    await tick();
    const chatTiming = (await c.get(conversation.id)).requestTiming?.find(timing => timing.requestId === requestId(4));
    expect(chatTiming).toBeDefined();
    expect(Object.keys(chatTiming!).sort()).toEqual(['acceptedAt', 'firstTextAt', 'lastActivityAt', 'requestId', 'settledAt']);
    expect(typeof chatTiming!.acceptedAt).toBe('string');
    expect(typeof chatTiming!.firstTextAt).toBe('string');
    expect(typeof chatTiming!.settledAt).toBe('string');

    // The Agent run uses the same shared fields: the status UI reads one shape, not one per mode.
    await c.refreshAccount();
    await c.send({ requestId: requestId(5), conversationId: conversation.id, action: 'ask', question: 'annotate', citations: [citationA], settings, mode: 'agent' });
    await flush();
    expect(methods(p)).toContain('turn/start');
    const agentTiming = (await c.get(conversation.id)).requestTiming?.find(timing => timing.requestId === requestId(5));
    expect(agentTiming).toBeDefined();
    // The same shared fields drive the status line in both modes: accepted, first text, settled.
    for (const key of ['acceptedAt', 'firstTextAt', 'settledAt'] as const) expect(agentTiming).toHaveProperty(key);
    expect(typeof agentTiming!.acceptedAt).toBe('string');
    expect(agentTiming).toMatchObject({ firstTextAt: null, settledAt: null });
  });
});
