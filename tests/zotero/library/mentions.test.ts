import { describe, expect, it } from 'vitest';
import { createLibraryMentionResolver } from '../../../packages/zotero/src/library/mentions.ts';

interface TestItem {
  id: number; key: string; libraryID: number; itemType: string; dateModified: string; deleted: boolean;
  title: string; authors: string[]; year: string; DOI: string; publicationTitle: string; abstractNote: string; editable: boolean;
  collections: number[];
  isRegularItem(): boolean; isPDFAttachment(): boolean; isEditable(operation?: 'edit' | 'erase'): boolean;
  getField(field: string): string; getCreators(): Array<{ firstName?: string; lastName?: string; name?: string; creatorType?: string }>;
  getTags(): Array<{ tag: string }>; getCollections(): number[]; getAttachments(): number[];
}

function setup(itemCount = 2) {
  const items: TestItem[] = Array.from({ length: itemCount }, (_, index) => {
    const number = index + 1;
    return {
      id: number, key: `ITEM${String(number).padStart(4, '0')}`, libraryID: number === 2 ? 2 : 1, itemType: 'journalArticle', dateModified: '2026-09-01 12:00:00', deleted: false,
      title: number === 1 ? 'Same Topic Paper' : `Other Topic Paper ${number}`, authors: [number === 1 ? 'Ada Lovelace' : `Author ${number}`], year: '2024', DOI: `10.1000/paper${number}`,
      publicationTitle: 'Journal of Tests', abstractNote: 'A bounded abstract.', editable: true, collections: number === 1 ? [11] : [],
      isRegularItem: () => true, isPDFAttachment: () => false, isEditable: () => items[number - 1]!.editable,
      getField: field => ({ title: items[number - 1]!.title, date: items[number - 1]!.year, DOI: items[number - 1]!.DOI, publicationTitle: items[number - 1]!.publicationTitle, abstractNote: items[number - 1]!.abstractNote }[field] ?? ''),
      getCreators: () => items[number - 1]!.authors.map(name => ({ name, creatorType: 'author' })), getTags: () => [], getCollections: () => items[number - 1]!.collections, getAttachments: () => [],
    };
  });
  const libraries = [
    { libraryID: 1, name: 'My Library', editable: true, filesEditable: true, libraryType: 'user' },
    { libraryID: 2, name: 'Research Group', editable: true, filesEditable: true, libraryType: 'group' },
    { libraryID: 9, name: 'Feeds', editable: false, filesEditable: false, libraryType: 'feed' },
  ];
  const collections = [
    { id: 10, key: 'PARENT01', libraryID: 1, name: 'Methods', parentKey: null as string | null, isEditable: () => true },
    { id: 11, key: 'CHILD001', libraryID: 1, name: 'Predictive coding', parentKey: 'PARENT01' as string | null, isEditable: () => true },
    { id: 12, key: 'GROUP001', libraryID: 2, name: 'Predictive coding', parentKey: null as string | null, isEditable: () => true },
  ];
  const searched: Array<{ libraryID: number; term: string }> = [];
  const host = {
    Libraries: {
      getAll: () => libraries,
      get: (id: number) => libraries.find(library => library.libraryID === id),
    },
    Collections: {
      getByLibrary: (libraryID: number, _recursive: boolean, includeTrashed: boolean) => collections.filter(collection => collection.libraryID === libraryID && (includeTrashed || !('deleted' in collection && collection.deleted))),
      getByLibraryAndKey: (libraryID: number, key: string) => collections.find(collection => collection.libraryID === libraryID && collection.key === key),
    },
    Items: {
      get: (id: number) => items.find(item => item.id === id),
      getAsync: (id: number) => Promise.resolve(items.find(item => item.id === id)),
      getByLibraryAndKey: (libraryID: number, key: string) => items.find(item => item.libraryID === libraryID && item.key === key),
    },
    Search: class {
      libraryID = 1; term = ''; collectionId: number | null = null;
      addCondition(condition: string, operator: string, value?: string) {
        if (condition === 'quicksearch-titleCreatorYear' && operator === 'contains') this.term = value ?? '';
        if (condition === 'collection' && operator === 'is') this.collectionId = Number(value);
      }
      search() {
        if (this.collectionId !== null) return Promise.resolve(items.filter(item => item.libraryID === this.libraryID && item.collections.includes(this.collectionId!)).map(item => item.id));
        searched.push({ libraryID: this.libraryID, term: this.term });
        return Promise.resolve(items.filter(item => item.libraryID === this.libraryID && `${item.title} ${item.authors.join(' ')} ${item.year}`.toLocaleLowerCase().includes(this.term.toLocaleLowerCase())).map(item => item.id));
      }
    },
  };
  let serial = 0;
  const resolver = createLibraryMentionResolver(host, { uuid: () => `mention-${++serial}` });
  return { resolver, host, items, libraries, collections, searched };
}

describe('main-window Zotero mentions', () => {
  it('searches library and collection names plus regular item titles/authors, including items without PDFs', async () => {
    const f = setup();
    const results = await f.resolver.search('Ada', 'client-1');
    expect(f.searched).toEqual([{ libraryID: 1, term: 'Ada' }, { libraryID: 2, term: 'Ada' }]);
    expect(results.map(row => row.kind)).toContain('article');
    const article = results.find(row => row.kind === 'article');
    expect(article?.label).toContain('Same Topic Paper');
    expect(article?.detail).toContain('Ada Lovelace');
    expect(results.some(row => row.kind === 'collection' && row.label.includes('Predictive coding'))).toBe(false);
    expect(f.items.every(item => item.getAttachments().length === 0)).toBe(true);
  });

  it('keeps stable opaque IDs while returning collection ancestry in labels', async () => {
    const f = setup();
    const first = await f.resolver.search('Predictive coding', 'client-1', 1);
    const second = await f.resolver.search('Predictive coding', 'client-1', 1);
    const collection = first.find(row => row.kind === 'collection');
    expect(collection?.label).toBe('My Library / Methods / Predictive coding');
    expect(second.find(row => row.kind === 'collection')?.id).toBe(collection?.id);
    expect(collection?.id).not.toContain('CHILD001');
  });

  it('disambiguates same-title items from different libraries without exposing native keys', async () => {
    const f = setup(); f.items[1]!.title = 'Same Topic Paper';
    const results = await f.resolver.search('Same Topic Paper', 'client-1');
    const articles = results.filter(row => row.kind === 'article');
    expect(articles).toHaveLength(2);
    expect(articles[0]?.label).not.toBe(articles[1]?.label);
    expect(articles.some(row => row.detail?.includes('My Library'))).toBe(true);
    expect(articles.some(row => row.detail?.includes('Research Group'))).toBe(true);
    expect(articles.some(row => row.id.includes('ITEM000'))).toBe(false);
  });

  it('caps search results at 30', async () => {
    const f = setup(40);
    for (const item of f.items) { item.libraryID = 1; item.title = 'Predictive coding article'; }
    const results = await f.resolver.search('Predictive coding', 'client-1', 1);
    expect(results).toHaveLength(30);
  });

  it('freezes a selected collection with an exact count, an explicit over-limit flag, and separated native refs', async () => {
    const f = setup(55);
    for (const item of f.items) { item.libraryID = 1; item.collections = [11]; }
    const mention = (await f.resolver.search('', 'client-1', 1)).find(row => row.kind === 'collection' && row.label.endsWith('Predictive coding'))!;
    const snapshot = await f.resolver.snapshotCollectionItems(mention.id, 50);
    expect(snapshot).toMatchObject({ totalItems: 55, max: 50, overLimit: true, target: { libraryId: 1, collectionKey: 'CHILD001' } });
    expect(snapshot.nativeTargets).toHaveLength(50);
    expect(snapshot.modelContext.items).toHaveLength(50);
    expect(JSON.stringify(snapshot.modelContext)).not.toContain('ITEM0001');
    expect(JSON.stringify(snapshot.modelContext)).not.toContain('CHILD001');
  });

  it('requires a bounded query for a library snapshot instead of enumerating the whole library', async () => {
    const f = setup(5);
    for (const item of f.items) { item.libraryID = 1; item.title = 'Target article'; }
    const mention = (await f.resolver.search('My Library', 'client-1', 1)).find(row => row.kind === 'library')!;
    await expect(f.resolver.snapshotLibraryItems(mention.id, { query: '', max: 5 })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    const snapshot = await f.resolver.snapshotLibraryItems(mention.id, { query: 'Target article', max: 2 });
    expect(snapshot).toMatchObject({ totalItems: 5, max: 2, overLimit: true, target: { kind: 'library', libraryId: 1 } });
    expect(snapshot.nativeTargets).toHaveLength(2);
  });

  it('rechecks selected item identity and rejects deletion or metadata changes before freezing', async () => {
    const f = setup();
    const option = (await f.resolver.search('Same Topic Paper', 'client-1', 1)).find(row => row.kind === 'article')!;
    f.items[0]!.deleted = true;
    await expect(f.resolver.resolve([option.id])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const fresh = setup();
    const selected = (await fresh.resolver.search('Same Topic Paper', 'client-1', 1)).find(row => row.kind === 'article')!;
    fresh.items[0]!.title = 'A changed title'; fresh.items[0]!.dateModified = '2026-09-02 12:00:00';
    await expect(fresh.resolver.resolve([selected.id])).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
    const collectionCase = setup();
    const chosenCollection = (await collectionCase.resolver.search('Predictive coding', 'client-1', 1)).find(row => row.kind === 'collection')!;
    collectionCase.collections.splice(1, 1);
    await expect(collectionCase.resolver.resolve([chosenCollection.id])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const renamed = setup();
    const oldCollection = (await renamed.resolver.search('Predictive coding', 'client-1', 1)).find(row => row.kind === 'collection')!;
    renamed.collections[1]!.name = 'Updated collection';
    await expect(renamed.resolver.resolve([oldCollection.id])).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' });
  });

  it('freezes native keys separately from bounded model metadata and rechecks editability', async () => {
    const f = setup();
    f.items[0]!.abstractNote = 'a'.repeat(4000);
    const option = (await f.resolver.search('Same Topic Paper', 'client-1', 1)).find(row => row.kind === 'article')!;
    f.items[0]!.editable = false;
    const resolved = await f.resolver.resolve([option.id]);
    expect(resolved.modelContext[0]).toMatchObject({ kind: 'article', metadata: { title: 'Same Topic Paper', DOI: '10.1000/paper1' } });
    expect(JSON.stringify(resolved.modelContext)).not.toContain('ITEM0001');
    expect(resolved.modelContext[0]?.metadata?.abstractNote).toHaveLength(3000);
    expect(resolved.nativeTargets[0]).toMatchObject({ libraryId: 1, itemKey: 'ITEM0001', editable: false });
  });

  it('rejects unknown, repeated, or over-limit mention IDs', async () => {
    const f = setup();
    await expect(f.resolver.resolve(['missing'])).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const rows = await f.resolver.search('', 'client-1');
    await expect(f.resolver.resolve([rows[0]!.id, rows[0]!.id])).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(f.resolver.resolve(Array.from({ length: 33 }, (_, index) => `id-${index}`))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });
});
