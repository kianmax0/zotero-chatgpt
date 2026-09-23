import { describe, expect, it } from 'vitest';
import type { PaperIdentity } from '../../packages/contracts/src/index.ts';
import { DOCUMENT_BRIEF_HEADER, documentBrief, selectionBrief } from '../../packages/core/src/chat/document-brief.ts';
import { paperA } from '../contracts/factories.ts';

const identity: PaperIdentity = {
  title: 'Synthetic Paper A',
  authors: ['Ada Lovelace', ' Grace Hopper '],
  year: '2024',
  doi: '10.1000/synthetic',
  publicationTitle: 'Journal of Synthetic Results',
  abstractNote: '<p>A compact abstract about the result.</p>',
};

describe('documentBrief', () => {
  it('includes core bibliography and abstract without accepting a PDF document', () => {
    const brief = documentBrief(identity);
    expect(brief).not.toBeNull();
    expect(brief?.text.startsWith('Title: Synthetic Paper A')).toBe(true);
    expect(brief?.text).toContain('Authors: Ada Lovelace; Grace Hopper');
    expect(brief?.text).toContain('Publication: Journal of Synthetic Results');
    expect(brief?.text).toContain('Year: 2024');
    expect(brief?.text).toContain('DOI: 10.1000/synthetic');
    expect(brief?.text).toContain('Abstract:\nA compact abstract about the result.');
    expect(brief?.text).not.toContain(DOCUMENT_BRIEF_HEADER);
    expect(brief?.text).not.toContain('[page');
    expect(brief?.text).not.toContain('Definition: x denotes the hidden state.');
    expect(brief).toMatchObject({ included: 0, totalPages: 0, truncated: false, hasAbstract: true });
  });

  it('returns null only when no bibliography is available', () => {
    expect(documentBrief(identity)).not.toBeNull();
    expect(documentBrief({ title: 'Attachment filename', authors: [] })).toBeNull();
  });
});

describe('selectionBrief', () => {
  it('names the paper, the page and the exact original text', () => {
    const text = selectionBrief({ text: 'Definition: x denotes the hidden state.', title: 'Synthetic Paper A', pageLabel: 'i' });
    expect(text.startsWith('Selection from the PDF open in Zotero: Synthetic Paper A (page i)')).toBe(true);
    expect(text.endsWith('Definition: x denotes the hidden state.')).toBe(true);
  });

  it('omits the page when the reader reported none', () => {
    expect(selectionBrief({ text: 'Body.', title: '', pageLabel: '  ' })).toBe('Selection from the PDF open in Zotero: Untitled\n\nBody.');
  });
});

describe('the brief is a local read', () => {
  it('carries no request, model or Codex field, so nothing here can become an Agent call', () => {
    const brief = documentBrief(identity);
    expect(Object.keys(brief ?? {}).sort()).toEqual(['fields', 'hasAbstract', 'included', 'text', 'totalPages', 'truncated']);
    expect(brief?.text).not.toContain(paperA.attachmentKey);
  });
});
