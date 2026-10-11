/** Source-controlled release identity; build never substitutes the locally installed CLI. */
export const PINNED_RUNTIME = {
  codexVersion: '0.156.1',
  platform: 'darwin',
  architecture: 'arm64',
  entry: 'content/runtime/codex-aarch64-apple-darwin',
  size: 238138912,
  sha256: '0196e89fe5a7598f816ee54232c3d7c26d75e502ab5cfe2c9240e81d90f7255a',
  archive: {
    url: 'https://github.com/openai/codex/releases/download/rust-v0.156.1/codex-aarch64-apple-darwin.tar.gz',
    filename: 'codex-aarch64-apple-darwin.tar.gz',
    entry: 'codex-aarch64-apple-darwin',
    size: 94626816,
    sha256: '2bd64af14dedd47795f2f6bfd5d125cf79199acc2c7ba222144e08127111a5ca',
  },
  licenses: ['LICENSE', 'NOTICE', 'RATATUI-LICENSE', 'WEZTERM-LICENSE'],
} as const;

/** Static musl executable: no system Node, CLI or glibc version dependency. */
export const LINUX_RUNTIME = {
  codexVersion: PINNED_RUNTIME.codexVersion,
  platform: 'linux',
  architecture: 'x64',
  entry: 'content/runtime/codex-x86_64-unknown-linux-musl',
  size: 284479848,
  sha256: '0b2e9301d6100dddda3b9d5c80ebaeaa3a2f1962388f2f36f6b96a9f08b1f33f',
  archive: {
    url: 'https://github.com/openai/codex/releases/download/rust-v0.156.1/codex-x86_64-unknown-linux-musl.tar.gz',
    filename: 'codex-x86_64-unknown-linux-musl.tar.gz',
    entry: 'codex-x86_64-unknown-linux-musl',
    size: 107380357,
    sha256: 'aff46539a83aff86e3c62c592bce2c50d95391f9df289afaf03a50c01d14533d',
  },
  licenses: PINNED_RUNTIME.licenses,
} as const;
export const PINNED_RUNTIMES = [PINNED_RUNTIME, LINUX_RUNTIME] as const;

/** Gecko platform names; unsupported combinations fail before any profile writes. */
export function selectRuntime(os: string, abi: string): typeof PINNED_RUNTIMES[number] {
  if (os === 'Darwin' && /^(aarch64|arm64)-/u.test(abi)) return PINNED_RUNTIME;
  if (os === 'Linux' && /^(x86_64|x64|amd64)-/u.test(abi)) return LINUX_RUNTIME;
  throw new Error('Unsupported runtime platform: macOS Apple Silicon or Linux x86_64 is required');
}
