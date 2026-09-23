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
