import { describe, expect, it, vi } from 'vitest';
import { createOpenAlexDiscoveryPort } from '../../../packages/zotero/src/library/discovery.ts';

function openAlexResponse(results: unknown[]) {
  return { meta: { count: results.length }, results };
}
function work(overrides: Record<string, unknown> = {}) {
  return {
    id: 'https://openalex.org/W123', doi: 'https://doi.org/10.1000/Example', title: 'A bounded search paper', publication_year: 2024,
    authorships: [{ author: { display_name: 'A Researcher' } }],
    open_access: { is_oa: true, oa_status: 'gold', oa_url: 'https://journal.example/article', any_repository_has_fulltext: true },
    best_oa_location: { landing_page_url: 'https://journal.example/article', pdf_url: 'https://journal.example/article.pdf', source: { display_name: 'Example Journal' } },
    ...overrides,
  };
}

function adapter(response: unknown, responseURL?: (url: string) => string, status = 200) {
  const request = vi.fn((_method: string, url: string, options: Record<string, unknown>) => {
    void options;
    return Promise.resolve({
    response, status, responseURL: responseURL?.(url) ?? url,
    });
  });
  const port = createOpenAlexDiscoveryPort({ HTTP: { request } } as never);
  return { port, request };
}

describe('OpenAlex discovery adapter', () => {
  it('maps DOI, authors, year and open-access provenance into an acquisition-ready candidate', async () => {
    const { port, request } = adapter(openAlexResponse([work()]));
    const found = await port.search({ topic: 'predictive coding', limit: 5, yearFrom: 2020, yearTo: 2024, openAccessOnly: false });
    expect(found).toEqual([{
      id: 'https://openalex.org/W123', identifier: 'https://doi.org/10.1000/Example', doi: '10.1000/Example',
      title: 'A bounded search paper', authors: ['A Researcher'], year: 2024,
      source: { provider: 'openalex', workUrl: 'https://openalex.org/W123' },
      openAccess: { isOpenAccess: true, status: 'gold', landingPageUrl: 'https://journal.example/article', pdfUrl: 'https://journal.example/article.pdf', repository: 'Example Journal' },
    }]);
    const [method, rawURL, options] = request.mock.calls[0]!;
    expect(method).toBe('GET');
    const url = new URL(rawURL);
    expect(url.origin + url.pathname).toBe('https://api.openalex.org/works');
    expect(url.searchParams.get('search')).toBe('predictive coding');
    expect(url.searchParams.get('per-page')).toBe('5');
    expect(url.searchParams.get('filter')).toBe('from_publication_date:2020-01-01,to_publication_date:2024-12-31');
    expect(options).toMatchObject({ anon: true, timeout: 12000, followRedirects: false, responseType: 'json' });
  });

  it('uses a safe article URL when DOI is missing or malformed and drops works without either identifier', async () => {
    const { port } = adapter(openAlexResponse([
      work({ doi: null }),
      work({ id: 'https://openalex.org/W124', doi: 'not-a-doi', best_oa_location: { landing_page_url: 'https://journal.example/fallback' } }),
      work({ id: 'https://openalex.org/W125', doi: null, best_oa_location: { landing_page_url: null } }),
    ]));
    const found = await port.search({ topic: 'topic', limit: 10, openAccessOnly: false });
    expect(found.map(item => item.identifier)).toEqual(['https://journal.example/article', 'https://journal.example/fallback']);
    expect(found.every(item => item.doi === null)).toBe(true);
  });

  it('rejects unsafe identifiers and OA URLs from the remote response', async () => {
    const { port } = adapter(openAlexResponse([
      work({ id: 'https://openalex.org/W200', doi: null, open_access: { is_oa: true, oa_status: 'gold', oa_url: 'http://127.0.0.1/paper' }, best_oa_location: { landing_page_url: 'http://127.0.0.1/paper' } }),
      work({ id: 'https://openalex.org/W201', doi: 'https://doi.org/10.1000/good', open_access: { is_oa: true, oa_status: 'gold', oa_url: 'https://user:pass@journal.example/paper' }, best_oa_location: { landing_page_url: 'https://user:pass@journal.example/paper', pdf_url: 'http://192.168.1.10/file.pdf' } }),
    ]));
    const found = await port.search({ topic: 'topic', limit: 10, openAccessOnly: false });
    expect(found.map(item => item.identifier)).toEqual(['https://doi.org/10.1000/good']);
    expect(found[0]?.openAccess).toMatchObject({ landingPageUrl: null, pdfUrl: null });
  });

  it('deduplicates DOI works and applies the OA filter and result limit', async () => {
    const { port } = adapter(openAlexResponse([
      work(), work({ id: 'https://openalex.org/W124' }),
      work({ id: 'https://openalex.org/W125', doi: 'https://doi.org/10.1000/closed', open_access: { is_oa: false, oa_status: 'closed' }, best_oa_location: null }),
      work({ id: 'https://openalex.org/W126', doi: 'https://doi.org/10.1000/last' }),
    ]));
    const found = await port.search({ topic: 'topic', limit: 2, openAccessOnly: true });
    expect(found.map(item => item.doi)).toEqual(['10.1000/Example', '10.1000/last']);
  });

  it('rejects malformed API payloads, non-success responses and redirects outside the fixed endpoint', async () => {
    await expect(adapter({ results: 'not-array' }).port.search({ topic: 'topic', limit: 5, openAccessOnly: false })).rejects.toThrow('Scholarly search returned an invalid response.');
    await expect(adapter(openAlexResponse([]), undefined, 503).port.search({ topic: 'topic', limit: 5, openAccessOnly: false })).rejects.toThrow('Scholarly search is currently unavailable.');
    await expect(adapter(openAlexResponse([]), () => 'https://attacker.example/works').port.search({ topic: 'topic', limit: 5, openAccessOnly: false })).rejects.toThrow('Scholarly search left the permitted source.');
  });

  it('turns host network failures into a stable user-facing error', async () => {
    const zotero = { HTTP: { request: vi.fn(() => Promise.reject(new Error('private network detail'))) } };
    await expect(createOpenAlexDiscoveryPort(zotero as never).search({ topic: 'topic', limit: 5, openAccessOnly: false })).rejects.toThrow('Scholarly search is currently unavailable.');
  });

  it('refuses an adapter request above the bounded result limit without opening a connection', async () => {
    const { port, request } = adapter(openAlexResponse([]));
    await expect(port.search({ topic: 'topic', limit: 21, openAccessOnly: false })).rejects.toThrow('The scholarly search request is invalid.');
    expect(request).not.toHaveBeenCalled();
  });
});
