import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import vm from "node:vm";

import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, "../..");
const temporaryDirectories: string[] = [];

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "zchatgpt-build-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("development build", () => {
  it("creates a loadable Zotero global and copies required root files", async () => {
    const outputDirectory = await makeTemporaryDirectory();

    await execFileAsync(
      process.execPath,
      ["tests/runtime/package-fixture.mjs", "build", "--outdir", outputDirectory],
      { cwd: repositoryRoot },
    );

    expect(await readFile(path.join(outputDirectory, "content/runtime/codex-aarch64-apple-darwin"), "utf8")).toBe("abc");
    const [bundle, manifest, bootstrap, chatParentActor, chatChildActor, chatDom] = await Promise.all([
      readFile(path.join(outputDirectory, "content/zchatgpt.js"), "utf8"),
      readFile(path.join(outputDirectory, "manifest.json"), "utf8"),
      readFile(path.join(outputDirectory, "bootstrap.js"), "utf8"),
      readFile(path.join(outputDirectory, "content/actors/OfficialChatParent.mjs"), "utf8"),
      readFile(path.join(outputDirectory, "content/actors/OfficialChatChild.mjs"), "utf8"),
      readFile(path.join(outputDirectory, "content/actors/chatgpt-dom.mjs"), "utf8"),
    ]);
    const moduleScope: Record<string, unknown> = {};
    vm.createContext(moduleScope);
    vm.runInContext(bundle, moduleScope);

    expect(moduleScope.ZoteroChatGPT).toBeTypeOf("object");
    const api = moduleScope.ZoteroChatGPT as Record<string, unknown>;
    for (const method of [
      "onMainWindowLoad",
      "onMainWindowUnload",
      "shutdown",
      "startup",
    ]) {
      expect(api[method], method).toBeTypeOf("function");
    }

    const parsedManifest = JSON.parse(manifest) as { version?: unknown };
    const sourceManifest = JSON.parse(
      await readFile(
        path.join(repositoryRoot, "packages/zotero/manifest.json"),
        "utf8",
      ),
    ) as { version?: unknown };
    expect(parsedManifest).toMatchObject({
      applications: {
        zotero: {
          id: "{90909501-7b5b-4985-9f55-566e9890746c}",
          strict_max_version: "10.0.*",
          strict_min_version: "9.0.6",
        },
      },
      name: "Zotero ChatGPT",
    });
    expect(parsedManifest.version).toBe(sourceManifest.version);
    expect(bootstrap.length).toBeGreaterThan(0);
    expect(chatParentActor.length).toBeGreaterThan(0);
    expect(chatChildActor.length).toBeGreaterThan(0);
    expect(chatDom.length).toBeGreaterThan(0);
    expect((await readdir(path.join(outputDirectory, "content/actors"))).sort()).toEqual([
      "OfficialChatChild.mjs",
      "OfficialChatParent.mjs",
      "chatgpt-dom.mjs",
    ]);
    const katexCss = await readFile(path.join(outputDirectory, "content/assets/katex/katex.min.css"), "utf8");
    expect(katexCss).toContain("@font-face");
    expect(katexCss).not.toMatch(/https?:\/\//u);
    expect(bundle).not.toMatch(/cdn\.jsdelivr|cdnjs\.cloudflare|katex\.org\/css/u);
  });

  it("ships a license notice for every third-party package bundled into the extension", async () => {
    const outputDirectory = await makeTemporaryDirectory();

    await execFileAsync(
      process.execPath,
      ["tests/runtime/package-fixture.mjs", "build", "--outdir", outputDirectory],
      { cwd: repositoryRoot },
    );

    const licensesDirectory = path.join(outputDirectory, "content/assets/licenses");
    const names = (await readdir(licensesDirectory)).sort();
    expect(names).toEqual([
      "dompurify.LICENSE",
      "entities.LICENSE",
      "katex.LICENSE",
      "linkify-it.LICENSE",
      "markdown-it.LICENSE",
      "mdurl.LICENSE",
      "punycode.js.LICENSE",
      "uc.micro.LICENSE",
    ]);
    for (const name of names) {
      const text = await readFile(path.join(licensesDirectory, name), "utf8");
      expect(text.trim().length, name).toBeGreaterThan(0);
    }
  });
});
