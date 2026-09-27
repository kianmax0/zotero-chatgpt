# Pinned Codex runtime

The development XPI bundles Codex 0.156.1 for macOS Apple Silicon and Linux x86_64.
Gecko OS/ABI selects the pinned executable before preparing private state. Linux uses the official
static musl build, without a system CLI, system Node, PATH lookup or credential import. Agent login
is separate from Chat and uses the plugin-owned CODEX_HOME on both platforms.

Run `node scripts/runtime-prepare.mjs` once after checkout. It downloads both fixed official assets into ignored `.zotero-chatgpt-dev/runtime-cache/`, verifies the archive before extracting its one fixed entry, verifies the executable, and checks the existing Apple signature on macOS. `npm run build` and `npm run package:dev` require both prepared assets and independently reverify it. The binary stays out of Git. The small injectable asset used by unit tests is only a test fixture; it cannot serve a model request.

Source: OpenAI Codex tag `rust-v0.156.1`. The official archive is 94,626,816 bytes with SHA-256 `2bd64af14dedd47795f2f6bfd5d125cf79199acc2c7ba222144e08127111a5ca`; its extracted arm64 binary is 238,138,912 bytes with SHA-256 `0196e89fe5a7598f816ee54232c3d7c26d75e502ab5cfe2c9240e81d90f7255a`. The signature verifies as OpenAI OpCo, LLC (Team ID `2DC432GLL2`). The official source's Apache-2.0 `LICENSE` and `NOTICE` remain byte-identical to the included copies. The source's `third_party/wezterm/LICENSE` also matches the included copy; the source lockfile still pins `ratatui 0.30.2`, whose included MIT license is unchanged. A complete release dependency/license audit remains an S6 task.

Native runtime state lives under `PathUtils.profileDir/zotero-chatgpt/v1/`. `account/` is the dedicated official CODEX_HOME, `home/` the child HOME/XDG home, `records/` the plugin request journal, `scratch/` its working directory, and `tmp/` its temporary directory. Only the official flow touches credentials. Before each spawn, the service replaces its own config with an empty config and writes `environments.toml` with `include_local = false`. The child environment is an explicit whitelist; it inherits only the standard proxy variables (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY` and their lowercase forms) from the Zotero process, preserving their values and case. Empty/unset variables are omitted. It does not inherit ordinary Codex settings, provider keys, executable paths, or app-server debug overrides. Proxy values are never logged or persisted by the plugin. `CODEX_EXEC_SERVER_URL=none` and the pinned remote-control-disable marker complement the empty environment catalog. Core verifies the effective configuration before allowing use.

Zotero owns its profile lock; one bootstrap-held Agent runtime owns at most one process for that plugin lifetime, and it starts that process lazily. Opening the dock, reading local history and staying in Chat mode create no process and no runtime directory; the first Agent action (switching to Agent mode, `refreshAccount`, official login, an Agent send, or retry) is what extracts the bundled executable and opens the channel. Concurrent Agent callers share one startup; closing views does not stop it. Explicit retry after process failure disposes the old connection and restores the same journal. Disabling the plugin stops the owned handle. This is profile-local ownership, not a separate cross-process lock implementation.

Runtime paths reject traversal, ambiguous components, and existing symlinks. Private directories use 0700, journal files 0600, executable 0700. Snapshot writes use same-directory IOUtils temporary replacement with `flush:true`; append uses `appendOrCreate` with `flush:true`. These are process-crash recovery primitives, not a proven power-loss guarantee: the inspected Gecko implementation does not fsync the parent directory. Component checks do not claim defense against a malicious same-user process racing filesystem operations. Raw stderr is drained and discarded; raw RPC, auth, paper contents, and child environment are not logged.

Local signature verification preserves the official binary bytes. The code does not remove quarantine attributes or re-sign. Download-origin quarantine propagation, Gatekeeper behavior, real XPI extraction/launch, forced process exit and native crash recovery must be separately verified on the dedicated Zotero development profile.

Linux source: the same official `rust-v0.156.1` release, `codex-x86_64-unknown-linux-musl.tar.gz`.
Archive: 107,380,357 bytes, SHA-256 `aff46539a83aff86e3c62c592bce2c50d95391f9df289afaf03a50c01d14533d` (matches the GitHub release asset digest).
Executable: 284,479,848 bytes, SHA-256 `0b2e9301d6100dddda3b9d5c80ebaeaa3a2f1962388f2f36f6b96a9f08b1f33f` (measured after extracting the verified archive).
`manifest.json` records both targets, and packaging verifies each binary. Extraction uses a
version/platform/architecture/hash directory, retaining the existing Mac cache layout.
Windows, Linux ARM64 and Intel Mac are not supported by this bundle. Bundling both executables
increases the XPI size; only the selected executable is extracted into the Zotero profile.
