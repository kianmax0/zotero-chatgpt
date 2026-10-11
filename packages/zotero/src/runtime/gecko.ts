import type { RuntimeHost } from './prepare.ts';
import type { FileAPI } from './storage.ts';
import type { SubprocessAPI } from './process.ts';
interface NativeFile { initWithPath(path: string): void; isSymlink(): boolean }
declare const ChromeUtils: { importESModule(uri: string): { Subprocess: SubprocessAPI } };
declare const IOUtils: FileAPI;
declare const PathUtils: { profileDir: string; join(...parts: string[]): string };
declare const Services: { appinfo: { OS: string; XPCOMABI: string }; env: { get(name: string): string } };
declare const Cc: Record<string, { createInstance(iface: unknown): NativeFile }>;
declare const Ci: { nsIFile: unknown };
export function geckoHost(): { host: RuntimeHost; subprocess: SubprocessAPI } {
  const { Subprocess } = ChromeUtils.importESModule('resource://gre/modules/Subprocess.sys.mjs');
  return {
    subprocess: Subprocess,
    host: {
      io: IOUtils,
      join: (...parts) => PathUtils.join(...parts),
      profileDir: PathUtils.profileDir,
      os: Services.appinfo.OS,
      abi: Services.appinfo.XPCOMABI,
      getEnvironmentVariable: name => Services.env.get(name),
      uuid: () => crypto.randomUUID(),
      isSymlink: path => {
        const file = Cc['@mozilla.org/file/local;1']!.createInstance(Ci.nsIFile); file.initWithPath(path);
        try { return file.isSymlink(); }
        catch (error) {
          if (error && typeof error === 'object' && 'name' in error && (error.name === 'NS_ERROR_FILE_NOT_FOUND' || error.name === 'NS_ERROR_FILE_TARGET_DOES_NOT_EXIST')) return false;
          throw new Error('Unable to verify private file path');
        }
      },
      load: async url => {
        const response = await fetch(url); if (!response.ok) throw new Error('Bundled resource unavailable');
        return new Uint8Array(await response.arrayBuffer());
      },
    },
  };
}
