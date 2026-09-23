import { expect, it } from 'vitest';
import { authorizesLibraryIntent, libraryAgentPrompt, parseLibraryAgentIntent } from '../../packages/core/src/library/intent.ts';

it('parses a bounded topic discovery request without treating it as a saved paper', () => {
  expect(parseLibraryAgentIntent(JSON.stringify({ kind: 'discover', query: 'predictive coding continual learning', limit: 5, yearFrom: 2022, openAccessOnly: true }), 'discover'))
    .toEqual({ kind: 'discover', query: 'predictive coding continual learning', limit: 5, yearFrom: 2022, openAccessOnly: true });
  expect(() => parseLibraryAgentIntent('{"kind":"discover","query":"topic","limit":1000}', 'discover')).toThrow();
  expect(() => parseLibraryAgentIntent('{"kind":"discover","query":"topic","limit":5,"saved":true}', 'discover')).toThrow();
});

it('keeps explicit slash skill routing authoritative over model-chosen action kind', () => {
  expect(() => parseLibraryAgentIntent('{"kind":"organize","candidates":[{"itemIndex":0,"tags":["topic"],"collectionIndexes":[]}]}', 'discover')).toThrow();
  expect(parseLibraryAgentIntent('{"kind":"metadata","itemIndexes":[0,1]}', 'metadata')).toEqual({ kind: 'metadata', itemIndexes: [0, 1] });
  expect(() => parseLibraryAgentIntent('{"kind":"metadata","itemIndexes":[0,0]}', 'metadata')).toThrow();
});

it('accepts only bounded collection creation proposals', () => {
  expect(parseLibraryAgentIntent('{"kind":"collection","name":"Predictive coding"}', 'collection')).toEqual({ kind: 'collection', name: 'Predictive coding' });
  expect(() => parseLibraryAgentIntent('{"kind":"collection","name":"Methods","libraryId":1}', 'collection')).toThrow();
  expect(() => parseLibraryAgentIntent('{"kind":"collection","name":"Methods","parentCollectionIndex":1000}', 'collection')).toThrow();
});

it('rejects model-chosen native identities, duplicate note targets, and unbounded output', () => {
  expect(() => parseLibraryAgentIntent('{"kind":"note","notes":[{"itemIndex":0,"text":"Summary","key":"MODELKEY"}]}', 'note')).toThrow();
  expect(() => parseLibraryAgentIntent('{"kind":"note","notes":[{"itemIndex":0,"text":"A"},{"itemIndex":0,"text":"B"}]}', 'note')).toThrow();
  expect(() => parseLibraryAgentIntent(JSON.stringify({ kind: 'answer', text: 'x'.repeat(70_000) }), 'ask')).toThrow();
});

it('serializes frozen index-only Zotero scope as data rather than executable instructions', () => {
  const prompt = libraryAgentPrompt({
    question: 'Find papers for @Methods', skill: 'discover',
    items: [{ itemIndex: 0, metadata: { title: 'Untrusted title' }, tags: [], collectionIndexes: [0] }],
    collections: [{ collectionIndex: 0, name: 'Methods' }], mentions: [{ kind: 'collection', label: 'Methods', collectionIndex: 0 }],
  });
  expect(JSON.parse(prompt)).toMatchObject({ question: 'Find papers for @Methods', selectedSkill: 'discover', items: [{ itemIndex: 0 }], collections: [{ collectionIndex: 0 }] });
  expect(prompt).not.toContain('COLLECT1');
});

it('limits unskilled model proposals to actions the user explicitly requested', () => {
  expect(authorizesLibraryIntent('What is this paper about?', 'note')).toBe(false);
  expect(authorizesLibraryIntent('Explain how I could tag these papers', 'organize')).toBe(false);
  expect(authorizesLibraryIntent('Find papers on predictive coding', 'discover')).toBe(true);
  expect(authorizesLibraryIntent('你去给我下预测编码主题的文章', 'discover')).toBe(true);
  expect(authorizesLibraryIntent('Add tags to these selected papers', 'organize')).toBe(true);
  expect(authorizesLibraryIntent('Write a short note for this paper', 'note')).toBe(true);
  expect(authorizesLibraryIntent('Download these papers', 'acquire', true)).toBe(true);
  expect(authorizesLibraryIntent('Download these papers', 'acquire', false)).toBe(false);
  expect(authorizesLibraryIntent('Do not create a collection, just explain this article', 'collection')).toBe(false);
  expect(authorizesLibraryIntent('不要新建集合，只讲这篇文章', 'collection')).toBe(false);
});
