import type { HostReader } from '../reader/host-types.ts';

/**
 * Private Zotero 9.0.6 surfaces used by the native library/action layers. Keep native details out of
 * contracts and core; these interfaces are the only place that names Zotero's internal objects.
 */
export interface NativeHostItem {
  id: number;
  key: string;
  libraryID: number;
  parentID: number | false | null;
  deleted?: boolean;
  itemType: string;
  dateModified: string;
  annotationType: string;
  annotationText: string | null;
  annotationComment: string | null;
  annotationColor: string | null;
  annotationPageLabel: string | null;
  annotationSortIndex: string | null;
  annotationPosition: string | null;
  annotationAuthorName: string | null;
  annotationIsExternal: boolean;
  attachmentContentType: string;
  isAnnotation(): boolean;
  isRegularItem(): boolean;
  isPDFAttachment(): boolean;
  isEditable(operation?: 'edit' | 'erase'): boolean;
  getField(field: string): string;
  setField(field: string, value: string): void;
  getCreators(): Array<{ firstName?: string; lastName?: string; name?: string; creatorType?: string; fieldMode?: number }>;
  getCreatorsJSON(): Array<{ firstName?: string; lastName?: string; name?: string; creatorType?: string }>;
  getExtraField?(field: string): string | false;
  getTags(): Array<{ tag: string; type?: number }>;
  getCollections(includeTrashed?: boolean): number[];
  getAttachments(includeTrashed?: boolean): number[];
  getNotes(includeTrashed?: boolean): number[];
  getAnnotations(): NativeHostItem[];
  toJSON(): object;
  getFilePathAsync(): Promise<string | false>;
  fromJSON(json: object): void;
  getNote(): string;
  setNote(note: string): void;
  loadPrimaryData(): Promise<void>;
  addToCollection(key: string): void;
  removeFromCollection(key: string): void;
  addTag(tag: string, type?: number): boolean;
  removeTag(tag: string): boolean;
  loadAllData?(): Promise<void>;
  save(options?: { skipSelect?: boolean }): Promise<number | boolean>;
  erase(): Promise<void>;
}
export interface NativeHostCollection { id: number; key: string; libraryID: number; deleted?: boolean; isEditable(): boolean }
export interface NativeHostCollection {
  name: string;
  parentID: number | false | null;
  parentKey: string | false | null;
  dateModified: string;
  toJSON(): object;
  loadDataType(type: 'primaryData' | 'childItems' | 'childCollections', reload?: boolean): Promise<void>;
  getChildItems(asIDs?: boolean, includeTrashed?: boolean): Array<number | NativeHostItem>;
  getChildCollections(asIDs?: boolean, includeTrashed?: boolean): Array<number | NativeHostCollection>;
  save(options?: { skipSelect?: boolean }): Promise<number | boolean>;
  saveTx(options?: { skipSelect?: boolean }): Promise<number | boolean>;
}
interface TranslatorBase {
  getTranslators(): Promise<Array<{ translatorID: string }>>;
  setTranslator(translator: Array<{ translatorID: string }> | { translatorID: string }): void;
  setUserContextId(id: number): void;
  setHandler(type: string, callback: (object: unknown, items: Record<string, string>, done: (selected: Record<string, string>) => void) => void): void;
  translate(options: { libraryID: false; saveAttachments: false }): Promise<unknown[]>;
}
export interface HostSearchTranslator extends TranslatorBase { setIdentifier(identifier: object): void }
export interface HostWebTranslator extends TranslatorBase { setDocument(doc: Document): void }
export interface HostHTTPOptions {
  responseType?: string;
  anon?: boolean;
  timeout?: number;
  errorDelayMax?: number;
  followRedirects?: boolean;
  numRedirects?: number;
  cancellerReceiver?: (cancel: () => void) => void;
}
export interface HostHTTPResponse { response: unknown; status: number; responseURL: string; getResponseHeader?(name: string): string | null }
export interface NativeZoteroHost {
  Item: new (itemType: string) => NativeHostItem;
  Collection: new () => NativeHostCollection;
  Items: {
    getByLibraryAndKey(libraryID: number, key: string): NativeHostItem | false | undefined;
    get(id: number): NativeHostItem | false | undefined;
    getAsync(id: number): Promise<NativeHostItem>;
  };
  Collections: {
    getByLibraryAndKey(libraryID: number, key: string): NativeHostCollection | false | undefined;
    get(id: number): NativeHostCollection | false | undefined;
    getByLibrary(libraryID: number, recursive: boolean, includeTrashed: boolean): NativeHostCollection[];
  };
  Libraries: { get(id: number): { editable: boolean; filesEditable: boolean } | undefined };
  DB: { executeTransaction<T>(callback: () => Promise<T>): Promise<T> };
  Annotations: {
    saveFromJSON(attachment: NativeHostItem, json: object, options?: { skipSelect?: boolean }): Promise<NativeHostItem>;
    saveCacheImage(item: NativeHostItem, image: Blob): Promise<string>;
    removeCacheImage(item: Pick<NativeHostItem, 'libraryID' | 'key'>): Promise<void>;
    toJSON(item: NativeHostItem): Promise<Record<string, unknown>>;
  };
  Search: new () => { libraryID: number; addCondition(condition: string, operator: string, value?: string): void; search(): Promise<number[]> };
  Reader: { _readers: HostReader[] };
  Utilities: {
    cleanDOI(value: string): string | false;
    extractIdentifiers(value: string): Array<Record<string, string>>;
    Internal: { getOpenAccessPDFURLs(doi: string, options: { timeout: number }): Promise<Array<{ url?: string; pageURL?: string; version?: string }>> };
  };
  Translate: { Search: new () => HostSearchTranslator; Web: new () => HostWebTranslator };
  HTTP: {
    newCookieContext(): { id: number; dispose(): void };
    request(method: string, url: string, options: HostHTTPOptions): Promise<HostHTTPResponse>;
    download(url: string, path: string, options: HostHTTPOptions): Promise<HostHTTPResponse>;
  };
  MIME: { getMIMETypeFromFile(path: string): Promise<string> };
  Attachments: {
    createTemporaryStorageDirectory(): Promise<{ path: string }>;
    createURLAttachmentFromTemporaryStorageDirectory(options: { directory: string; filename: string; libraryID: number; parentItemID: number; title: string; url: string; contentType: string; saveOptions: { skipSelect: true } }): Promise<NativeHostItem>;
  };
  PDFWorker: {
    _enqueue<T>(callback: () => Promise<T>, isPriority: boolean): Promise<T>;
    _query(action: string, data: { buf: ArrayBuffer; maxPages: number }, transfer: ArrayBuffer[]): Promise<unknown>;
  };
}
/** Native file primitives; kept injectable so the action layer's I/O stays testable. */
export interface HostEnvironment {
  join(...parts: string[]): string;
  stat(path: string): Promise<{ size: number }>;
  read(path: string): Promise<Uint8Array>;
  remove(path: string, options: { recursive: true; ignoreAbsent: true }): Promise<void>;
  computeHexDigest(path: string, algorithm: 'sha256'): Promise<string>;
}
