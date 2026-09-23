import { expect, it, vi } from 'vitest';
import { ReaderError } from '../../../packages/contracts/src/index.ts';
import type { LocatedPosition } from '../../../packages/zotero/src/reader/locate.ts';
import { openFigureSelection, openSourcePage, type SourcePageNavigator, type SourcePageTarget } from '../../../packages/zotero/src/reader/source-highlight.ts';
import { paperA } from '../../contracts/factories.ts';

const target: SourcePageTarget = { paper: paperA, revision: { fingerprint: 'synthetic', size: 200, modifiedAt: 1000, sha256: 'a'.repeat(64) } };
const position: LocatedPosition = { pageIndex: 7, rects: [[72, 500, 300, 512]] };

interface NavigatorMocks {
  validate: ReturnType<typeof vi.fn<SourcePageNavigator['validate']>>;
  locate: ReturnType<typeof vi.fn<SourcePageNavigator['locate']>>;
  navigate: ReturnType<typeof vi.fn<SourcePageNavigator['navigate']>>;
}

function navigator(overrides: Partial<NavigatorMocks> = {}): NavigatorMocks {
  const validate = vi.fn<SourcePageNavigator['validate']>().mockResolvedValue(undefined);
  const locate = vi.fn<SourcePageNavigator['locate']>().mockResolvedValue(null);
  const navigate = vi.fn<SourcePageNavigator['navigate']>().mockResolvedValue(undefined);
  return { validate, locate, navigate, ...overrides };
}

it('refuses a changed revision before navigating or locating anything', async () => {
  const nav = navigator({ validate: vi.fn<SourcePageNavigator['validate']>().mockRejectedValue(new ReaderError('INVALID_REQUEST', 'The cited PDF version changed.')) });
  await expect(openSourcePage(nav, target, 7, 'exact words')).rejects.toThrow('The cited PDF version changed.');
  expect(nav.locate).not.toHaveBeenCalled();
  expect(nav.navigate).not.toHaveBeenCalled();
});

it('navigates to the cited page when no quote was supplied', async () => {
  const nav = navigator();
  await expect(openSourcePage(nav, target, 3, null)).resolves.toBe('opened');
  expect(nav.locate).not.toHaveBeenCalled();
  expect(nav.navigate).toHaveBeenCalledWith(3, null);
});

it('opens a saved Figure at its frozen rectangle only after validating the PDF revision', async () => {
  const selection = { ...target, pageIndex: 7, rect: [72, 500, 300, 512] as [number, number, number, number] };
  const nav = navigator(); await openFigureSelection(nav, selection);
  expect(nav.validate).toHaveBeenCalledWith(target);
  expect(nav.navigate).toHaveBeenCalledWith(7, { pageIndex: 7, rects: [[72, 500, 300, 512]] });
  const changed = navigator({ validate: vi.fn<SourcePageNavigator['validate']>().mockRejectedValue(new ReaderError('INVALID_REQUEST', 'The PDF changed.')) });
  await expect(openFigureSelection(changed, selection)).rejects.toThrow('The PDF changed.');
  expect(changed.navigate).not.toHaveBeenCalled();
});

it('highlights only when the quote is located on the cited page', async () => {
  const nav = navigator({ locate: vi.fn<SourcePageNavigator['locate']>().mockResolvedValue(position) });
  await expect(openSourcePage(nav, target, 7, 'exact words')).resolves.toBe('highlighted');
  expect(nav.locate).toHaveBeenCalledWith(target, 7, 'exact words');
  expect(nav.navigate).toHaveBeenCalledWith(7, position);
});

it('degrades honestly when the quote cannot be located and never fabricates a highlight', async () => {
  const nav = navigator({ locate: vi.fn<SourcePageNavigator['locate']>().mockResolvedValue(null) });
  await expect(openSourcePage(nav, target, 7, 'unfindable words')).resolves.toBe('unlocated');
  expect(nav.navigate).toHaveBeenCalledWith(7, null);
  const anyValue = expect.anything() as unknown;
  expect(nav.navigate).not.toHaveBeenCalledWith(7, expect.objectContaining({ rects: anyValue }));
});

it('performs no library write: the navigator only validates, locates and navigates', async () => {
  const nav = navigator({ locate: vi.fn<SourcePageNavigator['locate']>().mockResolvedValue(position) });
  await openSourcePage(nav, target, 7, 'exact words');
  const calls: unknown[] = [
    ...(nav.validate.mock.calls as unknown[]),
    ...(nav.locate.mock.calls as unknown[]),
    ...(nav.navigate.mock.calls as unknown[]),
  ];
  for (const call of calls) {
    expect(JSON.stringify(call)).not.toMatch(/annotat|saveFromJSON|Items|DB/iu);
  }
});
