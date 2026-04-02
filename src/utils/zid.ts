import { Token } from '../types';

// ── ZID tokeniser ─────────────────────────────────────────────────────────────

export function tokenize(zid: string): Token[] {
  const s = String(zid);
  const parts = s.match(/(\d+|[A-Z]+|[a-z]+|[.,/])/g) || [];
  return parts.map((p) => {
    if (/^\d+$/.test(p)) return { type: 'num', value: parseInt(p, 10) };
    if (/^[A-Z]+$/.test(p)) return { type: 'upper', value: p };
    if (/^[a-z]+$/.test(p)) return { type: 'lower', value: p };
    return { type: 'sep', value: p };
  });
}

function typeRank(t: Token['type']): number {
  if (t === 'upper') return 1;
  if (t === 'lower') return 2;
  if (t === 'num') return 3;
  return 4;
}

export function compareZid(a: string, b: string): number {
  const ta = tokenize(a);
  const tb = tokenize(b);
  const len = Math.max(ta.length, tb.length);
  for (let i = 0; i < len; i++) {
    const xa = ta[i];
    const xb = tb[i];
    if (!xa) return -1;
    if (!xb) return 1;
    if (xa.type === xb.type) {
      if (xa.type === 'num') {
        const na = xa.value as number;
        const nb = (xb.value as number) || 0;
        if (na !== nb) return na - nb;
      } else {
        const sa = String(xa.value);
        const sb = String(xb.value);
        if (sa !== sb) return sa < sb ? -1 : 1;
      }
    } else {
      return typeRank(xa.type) - typeRank(xb.type);
    }
  }
  return 0;
}

export function calculateDepth(zid: string): number {
  const tokens = tokenize(zid);
  let depth = 0;
  let lastType: Token['type'] | null = null;
  for (const t of tokens) {
    if (lastType === null) {
      depth = 0;
    } else if (t.type === 'sep') {
      depth += 1;
    } else if (t.type === 'upper' && (lastType === 'num' || lastType === 'lower')) {
      depth += 1;
    } else if (t.type === 'lower' && lastType === 'upper') {
      depth += 1;
    }
    lastType = t.type;
  }
  return depth;
}

export function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}
