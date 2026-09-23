import { describe, expect, it } from 'vitest';
import type { PaperIdentity } from '../../packages/contracts/src/index.ts';
import { DOCUMENT_BRIEF_HEADER, documentBrief } from '../../packages/core/src/chat/document-brief.ts';
import { cleanAbstract, hasBibliographicIdentity, normalizeDoi, paperContext, publicationOf } from '../../packages/core/src/chat/paper-context.ts';

/** A marker that must never reach the manual copy: it exists only in the locally read PDF text. */
const FULLTEXT_ONLY_SHOULD_NOT_COPY = 'FULLTEXT_ONLY_SHOULD_NOT_COPY';

const identity: PaperIdentity = {
  title: 'Synthetic Paper A',
  authors: ['Ada Lovelace', 'Grace Hopper'],
  itemType: 'journalArticle',
  publicationTitle: 'Journal of Synthetic Results',
  year: '2024',
  doi: '10.1000/synthetic',
  abstractNote: 'A stored abstract that is not the PDF body.',
};

describe('paperContext', () => {
  it('writes the fixed field order and omits a field the item does not carry', () => {
    const context = paperContext(identity);
    expect(context).not.toBeNull();
    expect(context!.text).toBe([
      'Title: Synthetic Paper A',
      'Authors: Ada Lovelace; Grace Hopper',
      'Publication: Journal of Synthetic Results',
      'Year: 2024',
      'DOI: 10.1000/synthetic',
      '',
      'Abstract:',
      'A stored abstract that is not the PDF body.',
    ].join('\n'));
    expect(context!.fields).toEqual(['Title', 'Authors', 'Publication', 'Year', 'DOI', 'Abstract']);
    expect(context!.hasAbstract).toBe(true);
  });

  it('never carries PDF text, a selection, a status line or an internal marker', () => {
    const context = paperContext(identity)!;
    // Both compact paper-context paths accept only frozen identity, never a PDF document.
    const brief = documentBrief(identity);
    expect(brief?.text).not.toContain(FULLTEXT_ONLY_SHOULD_NOT_COPY);
    expect(brief?.text).not.toContain(DOCUMENT_BRIEF_HEADER);
    expect(context.text).not.toContain(FULLTEXT_ONLY_SHOULD_NOT_COPY);
    for (const forbidden of ['Context from the PDF', '[page i]', 'pages read locally', 'Current PDF', 'Locally read text', 'marker', 'shortened']) {
      expect(context.text).not.toContain(forbidden);
    }
  });

  it('omits an absent abstract instead of inventing one, and keeps an unknown field absent', () => {
    const context = paperContext({ title: 'No abstract paper', authors: ['A. Author'], itemType: 'book', bookTitle: 'A Book' })!;
    expect(context.text).toBe(['Title: No abstract paper', 'Authors: A. Author', 'Publication: A Book'].join('\n'));
    expect(context.hasAbstract).toBe(false);
    expect(context.fields).toEqual(['Title', 'Authors', 'Publication']);
    for (const filler of ['N/A', 'Unknown', 'Abstract:', 'DOI:', 'Year:']) expect(context.text).not.toContain(filler);
  });

  it('uses the real carrier for the item type instead of dressing every paper as a journal article', () => {
    expect(publicationOf({ title: 'x', authors: [], itemType: 'conferencePaper', proceedingsTitle: 'Proc. of Things', conferenceName: 'Conf' })).toBe('Proc. of Things');
    expect(publicationOf({ title: 'x', authors: [], itemType: 'thesis', university: 'Some University', publisher: 'Press' })).toBe('Some University');
    expect(publicationOf({ title: 'x', authors: [], itemType: 'book', bookTitle: 'Book Title', publisher: 'Press' })).toBe('Book Title');
    // A bare PDF has no item type and therefore no fabricated journal.
    expect(publicationOf({ title: 'scan.pdf', authors: [] })).toBe('');
  });

  it('keeps a non-journal paper honest and copies only what exists', () => {
    const context = paperContext({ title: 'A conference paper', authors: ['Ada Lovelace'], itemType: 'conferencePaper', proceedingsTitle: 'Proceedings of SyntheticConf', year: '2025' })!;
    expect(context.text).toContain('Publication: Proceedings of SyntheticConf');
    expect(context.text).not.toContain('Journal');
  });

  it('preserves the authors in local order and asks no model, network or PDF read', () => {
    const context = paperContext({ title: 'T', authors: ['First Author', 'Second Author', 'Third Author'], itemType: 'journalArticle', publicationTitle: 'J' })!;
    expect(context.text).toContain('Authors: First Author; Second Author; Third Author');
    // Pure: it takes a plain identity and returns a string.
    expect(Object.keys(context).sort()).toEqual(['fields', 'hasAbstract', 'text']);
  });

  it('normalizes a DOI but never rewrites its suffix', () => {
    expect(normalizeDoi('https://doi.org/10.1000/ABC.1')).toBe('10.1000/ABC.1');
    expect(normalizeDoi('doi: 10.1000/XYZ')).toBe('10.1000/XYZ');
    expect(normalizeDoi('DX.DOI.ORG/10.1/x').toLowerCase()).toBe('dx.doi.org/10.1/x');
    expect(normalizeDoi('  10.1000/ bare  ')).toBe('10.1000/bare');
    expect(paperContext({ title: 'T', authors: [], itemType: 'journalArticle', doi: 'https://doi.org/10.1000/xyz' })!.text).toContain('DOI: 10.1000/xyz');
  });

  it('cleans display HTML and entities without executing them or destroying math text', () => {
    expect(cleanAbstract('<p>First &amp; second</p><p>Third&nbsp;part</p>')).toBe('First & second\n\nThird part');
    expect(cleanAbstract('A <b>bold</b> claim')).toBe('A bold claim');
    expect(cleanAbstract('Set x &lt; 5 and y &#62; 3')).toBe('Set x < 5 and y > 3');
    // An angle bracket that is not a real tag stays as math text.
    expect(cleanAbstract('若 x < 5 且 y > 2，则成立')).toBe('若 x < 5 且 y > 2，则成立');
    expect(cleanAbstract('p(θ|D) ∝ p(D|θ)p(θ)')).toBe('p(θ|D) ∝ p(D|θ)p(θ)');
    expect(cleanAbstract('line one\r\nline two')).toBe('line one\nline two');
    expect(cleanAbstract('<script>alert(1)</script>safe')).toBe('alert(1) safe');
    // A tag that is never closed is left alone rather than eating the rest of the abstract.
    expect(cleanAbstract('comparison a < b, done')).toBe('comparison a < b, done');
  });

  it('refuses a bare PDF that proves no bibliographic fact', () => {
    // The reader falls back to the attachment's own name; that is not a citation.
    expect(hasBibliographicIdentity({ title: 'scan-0001.pdf', authors: [] })).toBe(false);
    expect(paperContext({ title: 'scan-0001.pdf', authors: [] })).toBeNull();
    expect(paperContext({ title: '', authors: [] })).toBeNull();
    // One provable field is enough, whichever one the reader read.
    expect(hasBibliographicIdentity({ title: 'x', authors: ['A'] })).toBe(true);
    expect(hasBibliographicIdentity({ title: 'x', authors: [], year: '2024' })).toBe(true);
    expect(hasBibliographicIdentity({ title: 'x', authors: [], doi: '10.1/x' })).toBe(true);
    expect(hasBibliographicIdentity({ title: 'x', authors: [], abstractNote: 'a' })).toBe(true);
    expect(hasBibliographicIdentity({ title: 'x', authors: [], itemType: 'journalArticle' })).toBe(true);
    expect(paperContext({ title: 'x', authors: [], itemType: 'journalArticle' })).not.toBeNull();
  });

  it('keeps Unicode and multi-paragraph abstracts intact in the copied text', () => {
    const context = paperContext({
      title: '中文标题',
      authors: ['张 三'],
      itemType: 'journalArticle',
      publicationTitle: '示例期刊',
      abstractNote: '第一段。\n\n第二段：p(θ|D) ∝ p(D|θ)p(θ)。',
    })!;
    expect(context.text).toContain('Title: 中文标题');
    expect(context.text).toContain('Authors: 张 三');
    expect(context.text).toContain('Publication: 示例期刊\n');
    expect(context.text.endsWith('Abstract:\n第一段。\n\n第二段：p(θ|D) ∝ p(D|θ)p(θ)。')).toBe(true);
  });
});
