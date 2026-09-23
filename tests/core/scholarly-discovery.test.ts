import { describe, expect, it, vi } from 'vitest';
import { discoverScholarlyWorks, type ScholarlyDiscoveryCandidate, type ScholarlyDiscoveryPort } from '../../packages/core/src/discovery/scholarly.ts';

function candidate(overrides: Partial<ScholarlyDiscoveryCandidate> = {}): ScholarlyDiscoveryCandidate {
  return {
    id: 'https://openalex.org/W1', identifier: 'https://doi.org/10.1000/example',
    doi: '10.1000/example', title: 'A paper', authors: ['A Author'], year: 2024,
    source: { provider: 'openalex', workUrl: 'https://openalex.org/W1' },
    openAccess: { isOpenAccess: true, status: 'gold', landingPageUrl: 'https://journal.example/paper', pdfUrl: 'https://journal.example/paper.pdf', repository: 'Journal' },
    ...overrides,
  };
}

describe('scholarly discovery', () => {
  it('normalizes the topic request and returns no more than the requested number of unique DOI works', async () => {
    const search = vi.fn(() => Promise.resolve([candidate(), candidate({ id: 'https://openalex.org/W2', source: { provider: 'openalex', workUrl: 'https://openalex.org/W2' } }), candidate({ id: 'https://openalex.org/W3', doi: '10.1000/other', identifier: 'https://doi.org/10.1000/other' })]));
    const port: ScholarlyDiscoveryPort = { search };
    const preview = await discoverScholarlyWorks(port, { topic: '  predictive coding  ', limit: 2, yearFrom: 2020, yearTo: 2025, openAccessOnly: true });
    expect(preview).toMatchObject({ source: 'openalex', query: { topic: 'predictive coding', limit: 2, yearFrom: 2020, yearTo: 2025, openAccessOnly: true } });
    expect(preview.candidates.map(item => item.doi)).toEqual(['10.1000/example', '10.1000/other']);
    expect(search).toHaveBeenCalledWith({ topic: 'predictive coding', limit: 2, yearFrom: 2020, yearTo: 2025, openAccessOnly: true }, undefined);
  });

  it('rejects empty topics and invalid or unbounded result limits before calling the source', async () => {
    const search = vi.fn(() => Promise.resolve([]));
    const port: ScholarlyDiscoveryPort = { search };
    await expect(discoverScholarlyWorks(port, { topic: '  ' })).rejects.toThrow('Enter a research topic.');
    await expect(discoverScholarlyWorks(port, { topic: 'topic', limit: 21 })).rejects.toThrow('Choose between 1 and 20 results.');
    await expect(discoverScholarlyWorks(port, { topic: 'topic', yearFrom: 2025, yearTo: 2020 })).rejects.toThrow('The publication year range is invalid.');
    expect(search).not.toHaveBeenCalled();
  });

  it('keeps URL-only works distinct and omits malformed candidates from an adapter', async () => {
    const noDoi = candidate({ id: 'https://openalex.org/W4', doi: null, identifier: 'https://journal.example/another', source: { provider: 'openalex', workUrl: 'https://openalex.org/W4' } });
    const malformed = candidate({ id: 'https://openalex.org/W5', doi: 'not-a-doi', identifier: 'not-a-doi', source: { provider: 'openalex', workUrl: 'https://openalex.org/W5' } });
    const port: ScholarlyDiscoveryPort = { search: () => Promise.resolve([noDoi, malformed]) };
    const preview = await discoverScholarlyWorks(port, { topic: 'topic' });
    expect(preview.candidates.map(item => item.identifier)).toEqual(['https://journal.example/another']);
  });
});
