import {
  BeamSegment,
  COLOR_BLUE,
  COLOR_GREEN,
  COLOR_RED,
  COLS,
  ColorMask,
  DIR_DX,
  DIR_DY,
  Dir,
  Orient,
  Piece,
  ROWS,
  TargetStatus,
  TraceResult,
} from './types';

interface RayJob {
  col: number;
  row: number;
  dir: Dir;
  color: ColorMask;
}

export function reflectDir(inDir: Dir, mirrorOrient: Orient): Dir {
  return ((((mirrorOrient - inDir) % 8) + 8) % 8) as Dir;
}

export function inBounds(col: number, row: number): boolean {
  return col >= 0 && col < COLS && row >= 0 && row < ROWS;
}

/**
 * Trace all laser beams across the 10x7 optical breadboard.
 * - Deterministic & guaranteed to terminate via per-(cell, dir) 3-bit RGB visited mask.
 * - Overlapping beams on the same grid segment merge via bitwise OR (R+G=Y, R+B=M, G+B=C, R+G+B=W).
 */
export function traceOptics(pieces: Piece[]): TraceResult {
  const grid = new Map<string, Piece>();
  const portals = new Map<string, Piece[]>();

  for (const p of pieces) {
    grid.set(`${p.col},${p.row}`, p);
    if (p.kind === 'PORTAL') {
      const group = p.portalGroup ?? 'A';
      const list = portals.get(group) ?? [];
      list.push(p);
      portals.set(group, list);
    }
  }

  // Track which RGB channels have already left (col, row) in direction dir.
  const emittedMask = new Uint8Array(COLS * ROWS * 8);
  // Accumulate RGB colors per undirected cell-to-cell edge for clean color-mixed rendering.
  const edgeColors = new Map<string, { x1: number; y1: number; x2: number; y2: number; color: number; dir: Dir }>();
  // Accumulate RGB colors hitting each target piece.
  const targetHits = new Map<string, number>();

  const queue: RayJob[] = [];

  const enqueue = (col: number, row: number, dir: Dir, color: number) => {
    const mask = color & 7;
    if (mask === 0) return;
    if (!inBounds(col, row)) return;
    const idx = (row * COLS + col) * 8 + dir;
    const fresh = mask & ~emittedMask[idx];
    if (fresh === 0) return;
    emittedMask[idx] |= fresh;
    queue.push({ col, row, dir, color: fresh as ColorMask });
  };

  const addSegment = (x1: number, y1: number, x2: number, y2: number, color: number, dir: Dir) => {
    // Normalize key so opposing beams on the same segment also blend their RGB colors!
    const forward = x1 < x2 || (x1 === x2 && y1 <= y2);
    const key = forward ? `${x1},${y1}:${x2},${y2}` : `${x2},${y2}:${x1},${y1}`;
    const existing = edgeColors.get(key);
    if (existing) {
      existing.color |= color;
    } else {
      edgeColors.set(key, { x1, y1, x2, y2, color, dir });
    }
  };

  // Seed queue from all LASER sources.
  for (const p of pieces) {
    if (p.kind === 'LASER') {
      const dir = (p.orient % 8) as Dir;
      const color = (p.color ?? COLOR_RED) as ColorMask;
      enqueue(p.col, p.row, dir, color);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const job = queue[head++];
    const dx = DIR_DX[job.dir];
    const dy = DIR_DY[job.dir];
    const nc = job.col + dx;
    const nr = job.row + dy;

    if (!inBounds(nc, nr)) {
      // Extend beam smoothly to the outer edge of the board.
      addSegment(job.col + 0.5, job.row + 0.5, job.col + 0.5 + dx * 0.5, job.row + 0.5 + dy * 0.5, job.color, job.dir);
      continue;
    }

    addSegment(job.col + 0.5, job.row + 0.5, nc + 0.5, nr + 0.5, job.color, job.dir);

    const hit = grid.get(`${nc},${nr}`);
    if (!hit) {
      enqueue(nc, nr, job.dir, job.color);
      continue;
    }

    switch (hit.kind) {
      case 'WALL':
      case 'LASER':
        // Absorbs beam.
        break;

      case 'TARGET': {
        const prev = targetHits.get(hit.id) ?? 0;
        targetHits.set(hit.id, prev | job.color);
        // Transparent crystal: beam continues straight through!
        enqueue(nc, nr, job.dir, job.color);
        break;
      }

      case 'MIRROR': {
        const outDir = reflectDir(job.dir, hit.orient);
        enqueue(nc, nr, outDir, job.color);
        break;
      }

      case 'SPLITTER': {
        const outDir = reflectDir(job.dir, hit.orient);
        enqueue(nc, nr, job.dir, job.color);
        if (outDir !== job.dir) {
          enqueue(nc, nr, outDir, job.color);
        }
        break;
      }

      case 'PRISM': {
        const sign = hit.orient % 2 === 0 ? 1 : -1;
        if (job.color & COLOR_RED) {
          const rDir = (((job.dir - sign) % 8) + 8) % 8 as Dir;
          enqueue(nc, nr, rDir, COLOR_RED);
        }
        if (job.color & COLOR_GREEN) {
          enqueue(nc, nr, job.dir, COLOR_GREEN);
        }
        if (job.color & COLOR_BLUE) {
          const bDir = (((job.dir + sign) % 8) + 8) % 8 as Dir;
          enqueue(nc, nr, bDir, COLOR_BLUE);
        }
        break;
      }

      case 'FILTER': {
        const filtered = job.color & (hit.color ?? COLOR_RED);
        if (filtered) {
          enqueue(nc, nr, job.dir, filtered);
        }
        break;
      }

      case 'PORTAL': {
        const group = hit.portalGroup ?? 'A';
        const pair = portals.get(group) ?? [];
        const partner = pair.find((p) => p.id !== hit.id);
        if (partner) {
          enqueue(partner.col, partner.row, job.dir, job.color);
        } else {
          // Unpaired portal passes straight through.
          enqueue(nc, nr, job.dir, job.color);
        }
        break;
      }
    }
  }

  const segments: BeamSegment[] = [];
  for (const seg of edgeColors.values()) {
    segments.push({
      x1: seg.x1,
      y1: seg.y1,
      x2: seg.x2,
      y2: seg.y2,
      color: (seg.color & 7) as ColorMask,
      dir: seg.dir,
    });
  }

  const targets: TargetStatus[] = [];
  for (const p of pieces) {
    if (p.kind !== 'TARGET') continue;
    const required = (p.color ?? COLOR_RED) as ColorMask;
    const received = (targetHits.get(p.id) ?? 0) & 7;
    const lit = received === required;
    const wrongMix = received !== 0 && received !== required && (received & ~required) !== 0;
    targets.push({ pieceId: p.id, required, received, lit, wrongMix });
  }

  const allSolved = targets.length > 0 && targets.every((t) => t.lit);
  return { segments, targets, allSolved };
}
