import type { ChatStreamEvent, ChatTransport } from '../../../contracts/src/execution.ts';

/**
 * The honest placeholder for the not-yet-integrated ChatGPT chat transport.
 *
 * Chat is a first-class sibling of Agent, but the concrete transport that reaches a plain ChatGPT
 * conversation is an unresolved platform integration boundary. Until one is identified and reviewed,
 * Chat must fail loudly and truthfully — it must NOT fall back to the Codex runtime, and it must NOT
 * be implemented as a stateless Codex turn. Agent mode remains fully available through the bundled
 * Codex App Server.
 *
 * This module intentionally imports nothing from `codex/`, `sessions/`, `tasks/` or `context/`: a
 * compile-time boundary that keeps the placeholder from quietly becoming an Agent path.
 */
/**
 * The one user-facing reason Chat cannot run in this build. Exported so the shared composer refuses
 * a Chat send with the same words the placeholder would fail with, instead of a sign-in message.
 */
export const CHAT_TRANSPORT_UNAVAILABLE_MESSAGE = 'Chat is unavailable in this build. Update the plugin when official ChatGPT support is available.';

export function unavailableChatTransport(): ChatTransport {
  return {
    available: false,
    stream(): AsyncIterable<ChatStreamEvent> {
      return {
        async *[Symbol.asyncIterator](): AsyncIterator<ChatStreamEvent> {
          // Async generator with an explicit await so the method is a real stream, not a sync list.
          await Promise.resolve();
          yield { type: 'chat.failed', code: 'UNSUPPORTED_INTERACTION', message: CHAT_TRANSPORT_UNAVAILABLE_MESSAGE };
        },
      };
    },
    // Nothing was ever started: no remote work to stop and no native session to release.
    cancel: () => Promise.resolve(),
  };
}
