// ── Shared TypeScript types ───────────────────────────────────────────────────

export type Token = { type: 'num' | 'upper' | 'lower' | 'sep'; value: number | string };
export type ZettelType = 'next' | 'branch' | 'inserted';

export interface BibEntry {
  author?: string;
  authors?: string[];
  title?: string;
  year?: string | number;
}
