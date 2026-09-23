/**
 * Whitelisted fields from the JSON catalog embedded in the pinned binary.
 * Audited 2026-09-23 against the official rust-v0.156.1 release catalog and binary.
 * This is a fallback catalog, not an account entitlement or effective window.
 * Keep both identity literals: a manifest upgrade must invalidate stale data.
 * Order mirrors the embedded catalog (newest listed first); the first id is the composer default.
 */
export const PINNED_MODEL_CATALOG = {
  runtimeVersion: '0.156.1',
  runtimeSha256: '0196e89fe5a7598f816ee54232c3d7c26d75e502ab5cfe2c9240e81d90f7255a',
  models: {
    'gpt-6-astra': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-6-sol': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-6-luna': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-5.6-sol': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-5.6-terra': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-5.6-luna': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-daybreak-blue-latest': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
    'gpt-daybreak-red-latest': { contextWindow: 372000, maxContextWindow: 372000, inputModalities: ['text', 'image'] },
    'gpt-5.5': { contextWindow: 272000, maxContextWindow: 272000, inputModalities: ['text', 'image'] },
    'gpt-5.4': { contextWindow: 272000, maxContextWindow: 1000000, inputModalities: ['text', 'image'] },
    'gpt-5.4-mini': { contextWindow: 272000, maxContextWindow: 272000, inputModalities: ['text', 'image'] },
    'gpt-5.2': { contextWindow: 272000, maxContextWindow: 272000, inputModalities: ['text', 'image'] },
    'codex-auto-review': { contextWindow: 272000, maxContextWindow: 872000, inputModalities: ['text', 'image'] },
  },
} as const;
