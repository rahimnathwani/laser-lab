export const COLS = 10;
export const ROWS = 7;

/** 3-bit RGB additive color bitmask (1..7). */
export type ColorMask = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const COLOR_RED: ColorMask = 1;
export const COLOR_GREEN: ColorMask = 2;
export const COLOR_BLUE: ColorMask = 4;
export const COLOR_YELLOW: ColorMask = 3; // RED | GREEN
export const COLOR_MAGENTA: ColorMask = 5; // RED | BLUE
export const COLOR_CYAN: ColorMask = 6; // GREEN | BLUE
export const COLOR_WHITE: ColorMask = 7; // RED | GREEN | BLUE

/** 8 compass directions in 45° increments (0 = East, 1 = SE, 2 = S, ... 7 = NE). */
export type Dir = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Mirror/splitter orientation in 22.5° steps (0..7). */
export type Orient = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type PieceKind =
  | 'LASER'
  | 'MIRROR'
  | 'SPLITTER'
  | 'PRISM'
  | 'FILTER'
  | 'TARGET'
  | 'WALL'
  | 'PORTAL';

export type PortalGroup = 'A' | 'B';

export interface Piece {
  id: string;
  kind: PieceKind;
  col: number;
  row: number;
  /**
   * - LASER: Dir (0..7)
   * - MIRROR / SPLITTER: Orient (0..7), tangent angle = orient * 22.5°
   * - PRISM: 0..7 (even = normal RGB fan, odd = flipped RGB fan)
   * - FILTER / TARGET / WALL / PORTAL: unused (0)
   */
  orient: Orient;
  /** Used by LASER, FILTER, TARGET. */
  color?: ColorMask;
  /** Used by PORTAL. */
  portalGroup?: PortalGroup;
  /** True for level-owned fixed pieces (cannot be moved or deleted). */
  locked?: boolean;
}

export interface InventoryItem {
  kind: PieceKind;
  count: number;
  color?: ColorMask;
  portalGroup?: PortalGroup;
}

export interface BeamSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: ColorMask;
  dir: Dir;
}

export interface TargetStatus {
  pieceId: string;
  required: ColorMask;
  received: number; // 0..7 bitmask
  lit: boolean;
  wrongMix: boolean;
}

export interface TraceResult {
  segments: BeamSegment[];
  targets: TargetStatus[];
  allSolved: boolean;
}

export interface LevelDef {
  id: number;
  title: string;
  subtitle: string;
  chapter: 'Reflections' | 'Splitters' | 'Color Mixing' | 'Prisms & Filters' | 'Sandbox';
  hint: string;
  pieces: Omit<Piece, 'id'>[];
  inventory: InventoryItem[];
  sandbox?: boolean;
}

export interface SandboxPreset {
  name: string;
  emoji: string;
  pieces: Omit<Piece, 'id'>[];
}

export const DIR_DX: readonly number[] = [1, 1, 0, -1, -1, -1, 0, 1];
export const DIR_DY: readonly number[] = [0, 1, 1, 1, 0, -1, -1, -1];

export function colorHex(mask: number): string {
  switch (mask & 7) {
    case COLOR_RED:
      return '#ff3b5c';
    case COLOR_GREEN:
      return '#22e584';
    case COLOR_BLUE:
      return '#38b6ff';
    case COLOR_YELLOW:
      return '#ffe14d';
    case COLOR_MAGENTA:
      return '#ff5cf4';
    case COLOR_CYAN:
      return '#2cf5ff';
    case COLOR_WHITE:
      return '#ffffff';
    default:
      return '#64748b';
  }
}

export function colorName(mask: number): string {
  switch (mask & 7) {
    case COLOR_RED:
      return 'Red';
    case COLOR_GREEN:
      return 'Green';
    case COLOR_BLUE:
      return 'Blue';
    case COLOR_YELLOW:
      return 'Yellow';
    case COLOR_MAGENTA:
      return 'Magenta';
    case COLOR_CYAN:
      return 'Cyan';
    case COLOR_WHITE:
      return 'White';
    default:
      return 'None';
  }
}
