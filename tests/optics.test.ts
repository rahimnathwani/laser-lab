import { describe, expect, it } from 'vitest';
import { LEVELS } from '../src/data/levels';
import { reflectDir, traceOptics } from '../src/sim/optics';
import { COLOR_BLUE, COLOR_RED, Piece } from '../src/sim/types';

function makePieces(levelId: number, extra: Omit<Piece, 'id'>[]): Piece[] {
  const level = LEVELS.find((l) => l.id === levelId)!;
  return [...level.pieces, ...extra].map((p, i) => ({ ...p, id: `p${i}` }));
}

describe('Optics engine', () => {
  it('reflects 8 directions accurately for mirrors', () => {
    expect(reflectDir(0, 6)).toBe(6); // E hits / -> N
    expect(reflectDir(0, 2)).toBe(2); // E hits \ -> S
    expect(reflectDir(0, 7)).toBe(7); // E hits 157.5° -> NE
    expect(reflectDir(0, 1)).toBe(1); // E hits 22.5° -> SE
    expect(reflectDir(7, 3)).toBe(4); // NE hits 67.5° -> W
    expect(reflectDir(1, 5)).toBe(4); // SE hits 112.5° -> W
  });

  it('terminates cleanly even in an infinity-mirror loop', () => {
    const loopPieces: Piece[] = [
      { id: 'l', kind: 'LASER', col: 1, row: 3, orient: 0, color: COLOR_RED },
      { id: 's1', kind: 'SPLITTER', col: 3, row: 3, orient: 4 },
      { id: 'm2', kind: 'MIRROR', col: 7, row: 3, orient: 4 },
    ];
    const res = traceOptics(loopPieces);
    expect(res.segments.length).toBeGreaterThan(0);
  });
});

describe('Campaign levels 1..14 solvability', () => {
  const SOLUTIONS: Record<number, Omit<Piece, 'id'>[]> = {
    1: [{ kind: 'MIRROR', col: 5, row: 3, orient: 6 }],
    2: [
      { kind: 'MIRROR', col: 4, row: 5, orient: 6 },
      { kind: 'MIRROR', col: 4, row: 2, orient: 6 },
    ],
    3: [
      { kind: 'MIRROR', col: 3, row: 5, orient: 7 },
      { kind: 'MIRROR', col: 6, row: 2, orient: 3 },
    ],
    4: [{ kind: 'SPLITTER', col: 5, row: 3, orient: 6 }],
    5: [
      { kind: 'SPLITTER', col: 4, row: 3, orient: 6 },
      { kind: 'SPLITTER', col: 7, row: 3, orient: 2 },
    ],
    6: [
      { kind: 'MIRROR', col: 6, row: 2, orient: 1 },
      { kind: 'MIRROR', col: 6, row: 4, orient: 7 },
    ],
    7: [
      { kind: 'MIRROR', col: 7, row: 1, orient: 2 },
      { kind: 'MIRROR', col: 5, row: 5, orient: 7 },
    ],
    8: [
      { kind: 'MIRROR', col: 5, row: 1, orient: 1 },
      { kind: 'MIRROR', col: 5, row: 5, orient: 7 },
    ],
    9: [{ kind: 'PRISM', col: 5, row: 3, orient: 0 }],
    10: [
      { kind: 'PRISM', col: 5, row: 3, orient: 0 },
      { kind: 'MIRROR', col: 7, row: 1, orient: 3 },
      { kind: 'MIRROR', col: 7, row: 5, orient: 5 },
    ],
    11: [
      { kind: 'SPLITTER', col: 5, row: 3, orient: 6 },
      { kind: 'FILTER', col: 7, row: 3, orient: 0, color: COLOR_RED },
      { kind: 'FILTER', col: 5, row: 2, orient: 0, color: COLOR_BLUE },
    ],
    12: [
      { kind: 'PRISM', col: 3, row: 3, orient: 0 },
      { kind: 'MIRROR', col: 4, row: 2, orient: 7 },
      { kind: 'MIRROR', col: 6, row: 3, orient: 1 },
      { kind: 'MIRROR', col: 4, row: 4, orient: 1 },
      { kind: 'MIRROR', col: 8, row: 4, orient: 6 },
    ],
    13: [
      { kind: 'MIRROR', col: 2, row: 1, orient: 2 },
      { kind: 'MIRROR', col: 2, row: 5, orient: 2 },
      { kind: 'PRISM', col: 7, row: 3, orient: 0 },
    ],
    14: [
      { kind: 'PRISM', col: 2, row: 3, orient: 0 },
      { kind: 'MIRROR', col: 4, row: 1, orient: 7 },
      { kind: 'MIRROR', col: 7, row: 1, orient: 1 },
      { kind: 'MIRROR', col: 4, row: 5, orient: 1 },
      { kind: 'MIRROR', col: 7, row: 5, orient: 7 },
      { kind: 'SPLITTER', col: 7, row: 3, orient: 7 },
      { kind: 'MIRROR', col: 8, row: 3, orient: 2 },
    ],
  };

  for (const level of LEVELS.filter((l) => !l.sandbox)) {
    it(`Level ${level.id} (${level.title}): unsolved at start, solved with inventory`, () => {
      const startRes = traceOptics(makePieces(level.id, []));
      expect(startRes.allSolved).toBe(false);

      const solution = SOLUTIONS[level.id];
      expect(solution, `Missing test solution for level ${level.id}`).toBeDefined();

      // Verify solution uses only pieces available in level.inventory
      const remaining = new Map<string, number>();
      for (const item of level.inventory) {
        const key = `${item.kind}:${item.color ?? 0}`;
        remaining.set(key, (remaining.get(key) ?? 0) + item.count);
      }
      for (const p of solution) {
        const key = `${p.kind}:${p.color ?? 0}`;
        const left = remaining.get(key) ?? 0;
        expect(left, `Level ${level.id} used too many ${key}`).toBeGreaterThan(0);
        remaining.set(key, left - 1);
      }

      const solvedRes = traceOptics(makePieces(level.id, solution));
      expect(solvedRes.allSolved, `Level ${level.id} did not solve: ${JSON.stringify(solvedRes.targets)}`).toBe(true);
    });
  }
});
