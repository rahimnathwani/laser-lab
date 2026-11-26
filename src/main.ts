import './styles.css';
import { LEVELS, SANDBOX_PRESETS } from './data/levels';
import { inBounds, traceOptics } from './sim/optics';
import {
  COLOR_BLUE,
  COLOR_CYAN,
  COLOR_GREEN,
  COLOR_MAGENTA,
  COLOR_RED,
  COLOR_WHITE,
  COLOR_YELLOW,
  COLS,
  ColorMask,
  LevelDef,
  Orient,
  Piece,
  PieceKind,
  PortalGroup,
  ROWS,
  TraceResult,
  colorHex,
  colorName,
} from './sim/types';
import { loadSave, writeSave } from './storage';
import { isMuted, setMuted, sfxCrystalLit, sfxPlace, sfxRemove, sfxRotate, sfxWin } from './ui/sfx';

const CELL = 72;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;

const SANDBOX_COLORS: ColorMask[] = [
  COLOR_RED,
  COLOR_GREEN,
  COLOR_BLUE,
  COLOR_YELLOW,
  COLOR_MAGENTA,
  COLOR_CYAN,
  COLOR_WHITE,
];

interface PaletteTool {
  key: string;
  kind: PieceKind;
  label: string;
  icon: string;
  color?: ColorMask;
  portalGroup?: PortalGroup;
}

const SANDBOX_TOOLS: PaletteTool[] = [
  { key: 'LASER', kind: 'LASER', label: 'Laser', icon: '🔦' },
  { key: 'MIRROR', kind: 'MIRROR', label: 'Mirror', icon: '🪞' },
  { key: 'SPLITTER', kind: 'SPLITTER', label: 'Splitter', icon: '❖' },
  { key: 'PRISM', kind: 'PRISM', label: 'Prism', icon: '🔺' },
  { key: 'FILTER', kind: 'FILTER', label: 'Filter', icon: '◎' },
  { key: 'TARGET', kind: 'TARGET', label: 'Crystal', icon: '💎' },
  { key: 'PORTAL:A', kind: 'PORTAL', label: 'Portal A', icon: '🌀', portalGroup: 'A' },
  { key: 'PORTAL:B', kind: 'PORTAL', label: 'Portal B', icon: '✨', portalGroup: 'B' },
  { key: 'WALL', kind: 'WALL', label: 'Wall', icon: '🧱' },
];

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  color: string;
}

// App State
const save = loadSave();
setMuted(save.muted);

let currentLevelId = LEVELS.some((l) => l.id === save.lastLevel) ? save.lastLevel : 1;
let pieces: Piece[] = [];
let nextPieceId = 1;
let trace: TraceResult = { segments: [], targets: [], allSolved: false };
let selectedPieceId: string | null = null;
let selectedToolKey: string | null = null;
let sandboxColor: ColorMask = COLOR_WHITE;
let showHint = false;
let showLevelModal = false;
let levelWonThisRun = false;
let prevLitCount = 0;
let spinShow = false;
let lastSpinTick = 0;

// Drag state
let draggingPieceId: string | null = null;
let dragStartClientX = 0;
let dragStartClientY = 0;
let dragMoved = false;
let hoverCell: { col: number; row: number } | null = null;

// Animation state
let animTime = 0;
const sparkles: Sparkle[] = [];

const app = document.getElementById('app')!;

function currentLevel(): LevelDef {
  return LEVELS.find((l) => l.id === currentLevelId) ?? LEVELS[0];
}

function makePieceId(): string {
  return `p${nextPieceId++}`;
}

function toolKeyOf(kind: PieceKind, color?: ColorMask, portalGroup?: PortalGroup): string {
  if (kind === 'FILTER' && color) return `FILTER:${color}`;
  if (kind === 'PORTAL' && portalGroup) return `PORTAL:${portalGroup}`;
  return kind;
}

function loadLevel(id: number): void {
  currentLevelId = id;
  save.lastLevel = id;
  writeSave(save);
  const lvl = currentLevel();
  pieces = lvl.pieces.map((p) => ({ ...p, id: makePieceId() }));
  selectedPieceId = null;
  selectedToolKey = null;
  showHint = false;
  levelWonThisRun = false;
  spinShow = false;
  if (!lvl.sandbox && lvl.inventory.length > 0) {
    const first = lvl.inventory[0];
    selectedToolKey = toolKeyOf(first.kind, first.color, first.portalGroup);
  }
  recompute(false);
  renderUI();
}

function getInventoryRemaining(kind: PieceKind, color?: ColorMask, portalGroup?: PortalGroup): number {
  const lvl = currentLevel();
  if (lvl.sandbox) return 99;
  const total = lvl.inventory
    .filter((i) => i.kind === kind && i.color === color && i.portalGroup === portalGroup)
    .reduce((acc, i) => acc + i.count, 0);
  const used = pieces.filter(
    (p) => !p.locked && p.kind === kind && p.color === color && p.portalGroup === portalGroup
  ).length;
  return Math.max(0, total - used);
}

function spawnBurst(cx: number, cy: number, color: string, count = 18): void {
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const sp = 40 + Math.random() * 90;
    sparkles.push({
      x: cx,
      y: cy,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      life: 1,
      color,
    });
  }
}

function recompute(playAudio = true): void {
  trace = traceOptics(pieces);
  const litCount = trace.targets.filter((t) => t.lit).length;

  if (playAudio && litCount > prevLitCount && !trace.allSolved) {
    sfxCrystalLit();
  }
  prevLitCount = litCount;

  const lvl = currentLevel();
  if (!lvl.sandbox && trace.allSolved && !levelWonThisRun) {
    levelWonThisRun = true;
    if (!save.solved.includes(lvl.id)) {
      save.solved.push(lvl.id);
      writeSave(save);
    }
    if (playAudio) sfxWin();
    for (const t of trace.targets) {
      const piece = pieces.find((p) => p.id === t.pieceId);
      if (piece) {
        spawnBurst((piece.col + 0.5) * CELL, (piece.row + 0.5) * CELL, colorHex(t.required), 24);
      }
    }
  } else if (!trace.allSolved) {
    levelWonThisRun = false;
  }
}

function pieceAt(col: number, row: number): Piece | undefined {
  return pieces.find((p) => p.col === col && p.row === row);
}

function defaultOrientFor(kind: PieceKind): Orient {
  if (kind === 'MIRROR' || kind === 'SPLITTER') return 6; // '/' diagonal is immediately useful
  return 0;
}

function placeFromTool(col: number, row: number): boolean {
  if (!selectedToolKey || !inBounds(col, row) || pieceAt(col, row)) return false;
  const lvl = currentLevel();

  if (lvl.sandbox) {
    const tool = SANDBOX_TOOLS.find((t) => t.key === selectedToolKey);
    if (!tool) return false;
    const needsColor = tool.kind === 'LASER' || tool.kind === 'FILTER' || tool.kind === 'TARGET';
    let color: ColorMask | undefined = needsColor ? sandboxColor : undefined;
    if (tool.kind === 'FILTER' && color && ![COLOR_RED, COLOR_GREEN, COLOR_BLUE].includes(color)) {
      color = COLOR_RED;
    }
    const piece: Piece = {
      id: makePieceId(),
      kind: tool.kind,
      col,
      row,
      orient: defaultOrientFor(tool.kind),
      color,
      portalGroup: tool.portalGroup,
    };
    pieces.push(piece);
    selectedPieceId = piece.id;
    sfxPlace();
    recompute();
    renderUI();
    return true;
  }

  // Campaign inventory placement
  const item = lvl.inventory.find((i) => toolKeyOf(i.kind, i.color, i.portalGroup) === selectedToolKey);
  if (!item) return false;
  if (getInventoryRemaining(item.kind, item.color, item.portalGroup) <= 0) return false;

  const piece: Piece = {
    id: makePieceId(),
    kind: item.kind,
    col,
    row,
    orient: defaultOrientFor(item.kind),
    color: item.color,
    portalGroup: item.portalGroup,
  };
  pieces.push(piece);
  selectedPieceId = piece.id;
  sfxPlace();
  recompute();
  renderUI();
  return true;
}

function rotatePiece(id: string, delta: 1 | -1): void {
  const p = pieces.find((x) => x.id === id);
  if (!p || p.locked) return;
  if (p.kind === 'WALL' || p.kind === 'TARGET' || p.kind === 'FILTER' || p.kind === 'PORTAL') return;
  p.orient = ((((p.orient + delta) % 8) + 8) % 8) as Orient;
  sfxRotate();
  recompute();
  renderUI();
}

function cyclePieceColor(id: string): void {
  const p = pieces.find((x) => x.id === id);
  if (!p || p.locked || !currentLevel().sandbox) return;
  if (p.kind !== 'LASER' && p.kind !== 'FILTER' && p.kind !== 'TARGET') return;
  const list: ColorMask[] =
    p.kind === 'FILTER' ? [COLOR_RED, COLOR_GREEN, COLOR_BLUE] : SANDBOX_COLORS;
  const idx = list.indexOf((p.color ?? COLOR_RED) as ColorMask);
  p.color = list[(idx + 1) % list.length];
  sfxRotate();
  recompute();
  renderUI();
}

function removePiece(id: string): void {
  const idx = pieces.findIndex((x) => x.id === id && !x.locked);
  if (idx === -1) return;
  const removed = pieces[idx];
  pieces.splice(idx, 1);
  if (selectedPieceId === id) selectedPieceId = null;
  if (!currentLevel().sandbox) {
    selectedToolKey = toolKeyOf(removed.kind, removed.color, removed.portalGroup);
  }
  sfxRemove();
  recompute();
  renderUI();
}

function clearUnlocked(): void {
  pieces = pieces.filter((p) => p.locked);
  selectedPieceId = null;
  levelWonThisRun = false;
  spinShow = false;
  sfxRemove();
  recompute(false);
  renderUI();
}

function loadPreset(index: number): void {
  const preset = SANDBOX_PRESETS[index];
  if (!preset) return;
  pieces = preset.pieces.map((p) => ({ ...p, id: makePieceId() }));
  selectedPieceId = null;
  sfxPlace();
  recompute(false);
  renderUI();
}

// ---------- Canvas Rendering ----------

function resizeCanvas(canvas: HTMLCanvasElement): void {
  const parent = canvas.parentElement;
  if (!parent) return;
  const rect = parent.getBoundingClientRect();
  const scale = Math.min((rect.width - 12) / BOARD_W, (rect.height - 12) / BOARD_H);
  const cssW = Math.max(240, Math.floor(BOARD_W * scale));
  const cssH = Math.max(168, Math.floor(BOARD_H * scale));
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  if (canvas.style.width !== `${cssW}px` || canvas.style.height !== `${cssH}px`) {
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  }
  const targetW = Math.round(cssW * dpr);
  const targetH = Math.round(cssH * dpr);
  if (canvas.width !== targetW || canvas.height !== targetH) {
    canvas.width = targetW;
    canvas.height = targetH;
  }
}

function drawBoard(canvas: HTMLCanvasElement, dt: number): void {
  resizeCanvas(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const sx = canvas.width / BOARD_W;
  const sy = canvas.height / BOARD_H;
  ctx.save();
  ctx.scale(sx, sy);

  // Background optical breadboard
  ctx.fillStyle = '#090f1f';
  ctx.fillRect(0, 0, BOARD_W, BOARD_H);

  // Subtle grid lines & breadboard screw-holes
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.09)';
  ctx.lineWidth = 1;
  for (let c = 0; c <= COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CELL, 0);
    ctx.lineTo(c * CELL, BOARD_H);
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * CELL);
    ctx.lineTo(BOARD_W, r * CELL);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(148, 163, 184, 0.18)';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.beginPath();
      ctx.arc((c + 0.5) * CELL, (r + 0.5) * CELL, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Hover cell highlight
  if (hoverCell && inBounds(hoverCell.col, hoverCell.row)) {
    ctx.fillStyle = 'rgba(56, 189, 248, 0.1)';
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(hoverCell.col * CELL + 4, hoverCell.row * CELL + 4, CELL - 8, CELL - 8, 10);
    ctx.fill();
    ctx.stroke();
  }

  // Draw laser beams with additive neon bloom
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  for (const seg of trace.segments) {
    const x1 = seg.x1 * CELL;
    const y1 = seg.y1 * CELL;
    const x2 = seg.x2 * CELL;
    const y2 = seg.y2 * CELL;
    const hex = colorHex(seg.color);

    // Outer bloom
    ctx.strokeStyle = hex;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Mid glow
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Hot white core
    ctx.strokeStyle = '#ffffff';
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    // Animated photon pulse along segment
    const phase = (animTime * 2.2) % 1;
    const px = x1 + (x2 - x1) * phase;
    const py = y1 + (y2 - y1) * phase;
    ctx.fillStyle = '#ffffff';
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    ctx.arc(px, py, 3.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  // Draw pieces
  const targetMap = new Map(trace.targets.map((t) => [t.pieceId, t]));
  for (const p of pieces) {
    drawPiece(ctx, p, p.id === selectedPieceId, targetMap.get(p.id));
  }

  // Update & draw victory sparkles
  for (let i = sparkles.length - 1; i >= 0; i--) {
    const s = sparkles[i];
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.vx *= 0.96;
    s.vy *= 0.96;
    s.life -= dt * 1.1;
    if (s.life <= 0) {
      sparkles.splice(i, 1);
      continue;
    }
    ctx.save();
    ctx.globalAlpha = Math.max(0, s.life);
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.x, s.y, 3.5 * s.life + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  p: Piece,
  selected: boolean,
  targetStatus?: { required: ColorMask; received: number; lit: boolean; wrongMix: boolean }
): void {
  const cx = (p.col + 0.5) * CELL;
  const cy = (p.row + 0.5) * CELL;

  ctx.save();
  ctx.translate(cx, cy);

  // Selection ring
  if (selected) {
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.arc(0, 0, 31, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  switch (p.kind) {
    case 'WALL': {
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-28, -28, 56, 56, 9);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.2)';
      ctx.beginPath();
      ctx.moveTo(-18, 18);
      ctx.lineTo(18, -18);
      ctx.moveTo(-18, -2);
      ctx.lineTo(-2, -18);
      ctx.moveTo(2, 18);
      ctx.lineTo(18, 2);
      ctx.stroke();
      break;
    }

    case 'LASER': {
      const hex = colorHex(p.color ?? COLOR_RED);
      ctx.rotate((p.orient * Math.PI) / 4);
      // Emitter chassis
      ctx.fillStyle = '#1e293b';
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(-24, -18, 38, 36, 9);
      ctx.fill();
      ctx.stroke();
      // Barrel nozzle
      ctx.fillStyle = '#334155';
      ctx.fillRect(10, -10, 15, 20);
      ctx.strokeRect(10, -10, 15, 20);
      // Glowing emitter lens
      ctx.fillStyle = hex;
      ctx.shadowColor = hex;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(24, 0, 6.5, 0, Math.PI * 2);
      ctx.fill();
      // Power core dot
      ctx.beginPath();
      ctx.arc(-5, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      break;
    }

    case 'MIRROR': {
      const angle = (p.orient * Math.PI) / 8;
      ctx.rotate(angle);
      // Base mount
      ctx.fillStyle = 'rgba(15, 23, 42, 0.7)';
      ctx.beginPath();
      ctx.arc(0, 0, 11, 0, Math.PI * 2);
      ctx.fill();
      // Metallic backing + polished mirror bar
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#475569';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(-24, 0);
      ctx.lineTo(24, 0);
      ctx.stroke();

      ctx.strokeStyle = '#e0f2fe';
      ctx.shadowColor = '#38bdf8';
      ctx.shadowBlur = 10;
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.moveTo(-22, 0);
      ctx.lineTo(22, 0);
      ctx.stroke();
      break;
    }

    case 'SPLITTER': {
      const angle = (p.orient * Math.PI) / 8;
      ctx.rotate(angle);
      // Translucent half-silvered glass plate
      ctx.fillStyle = 'rgba(56, 189, 248, 0.22)';
      ctx.strokeStyle = '#7dd3fc';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(-24, -6, 48, 12, 5);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#e0f2fe';
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(-20, 0);
      ctx.lineTo(20, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    }

    case 'PRISM': {
      const flipped = p.orient % 2 === 1;
      ctx.save();
      if (flipped) ctx.scale(1, -1);
      // Equilateral glass triangle
      ctx.fillStyle = 'rgba(186, 230, 253, 0.22)';
      ctx.strokeStyle = '#e0f2fe';
      ctx.shadowColor = '#a78bfa';
      ctx.shadowBlur = 12;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(0, -24);
      ctx.lineTo(23, 18);
      ctx.lineTo(-23, 18);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Tiny RGB dispersion indicator dots
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ff3b5c';
      ctx.beginPath();
      ctx.arc(0, -10, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#22e584';
      ctx.beginPath();
      ctx.arc(0, 2, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#38b6ff';
      ctx.beginPath();
      ctx.arc(0, 12, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }

    case 'FILTER': {
      const hex = colorHex(p.color ?? COLOR_RED);
      ctx.fillStyle = `${hex}33`;
      ctx.strokeStyle = hex;
      ctx.shadowColor = hex;
      ctx.shadowBlur = 10;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff';
      ctx.font = '900 13px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(colorName(p.color ?? COLOR_RED)[0], 0, 1);
      break;
    }

    case 'PORTAL': {
      const isA = (p.portalGroup ?? 'A') === 'A';
      const c1 = isA ? '#a855f7' : '#f59e0b';
      const c2 = isA ? '#38bdf8' : '#ec4899';
      const spin = animTime * (isA ? 2.4 : -2.4);

      ctx.save();
      ctx.rotate(spin);
      ctx.strokeStyle = c1;
      ctx.shadowColor = c1;
      ctx.shadowBlur = 14;
      ctx.lineWidth = 3.5;
      ctx.setLineDash([10, 6]);
      ctx.beginPath();
      ctx.arc(0, 0, 22, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = c2;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 14, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.fillStyle = '#ffffff';
      ctx.font = '900 13px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.portalGroup ?? 'A', 0, 1);
      break;
    }

    case 'TARGET': {
      const req = p.color ?? COLOR_RED;
      const hex = colorHex(req);
      const lit = targetStatus?.lit ?? false;
      const wrong = targetStatus?.wrongMix ?? false;
      const pulse = lit ? 1 + Math.sin(animTime * 6) * 0.06 : 1;

      ctx.save();
      ctx.scale(pulse, pulse);

      // Outer radiant halo when lit
      if (lit) {
        ctx.fillStyle = `${hex}44`;
        ctx.shadowColor = hex;
        ctx.shadowBlur = 22;
        ctx.beginPath();
        ctx.arc(0, 0, 27, 0, Math.PI * 2);
        ctx.fill();
      } else if (wrong) {
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2.5;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Hexagonal crystal body
      ctx.fillStyle = lit ? hex : 'rgba(15, 23, 42, 0.85)';
      ctx.strokeStyle = hex;
      ctx.lineWidth = lit ? 3.5 : 2.8;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i - Math.PI / 6;
        const rx = Math.cos(a) * 20;
        const ry = Math.sin(a) * 20;
        if (i === 0) ctx.moveTo(rx, ry);
        else ctx.lineTo(rx, ry);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Inner crystal facet / status icon
      ctx.shadowBlur = 0;
      ctx.fillStyle = lit ? '#070b16' : hex;
      ctx.font = '900 13px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(lit ? '✓' : colorName(req)[0], 0, 1);
      ctx.restore();
      break;
    }
  }

  ctx.restore();
}

// ---------- Pointer Handling ----------

function clientToCell(canvas: HTMLCanvasElement, clientX: number, clientY: number): { col: number; row: number } {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * BOARD_W;
  const y = ((clientY - rect.top) / rect.height) * BOARD_H;
  return { col: Math.floor(x / CELL), row: Math.floor(y / CELL) };
}

function attachCanvasEvents(canvas: HTMLCanvasElement): void {
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const { col, row } = clientToCell(canvas, e.clientX, e.clientY);
    if (!inBounds(col, row)) return;

    const existing = pieceAt(col, row);
    if (existing) {
      if (!existing.locked) {
        draggingPieceId = existing.id;
        selectedPieceId = existing.id;
        dragStartClientX = e.clientX;
        dragStartClientY = e.clientY;
        dragMoved = false;
        canvas.setPointerCapture(e.pointerId);
        renderUI();
      } else {
        selectedPieceId = null;
        renderUI();
      }
      return;
    }

    // Empty cell: place currently selected tool
    placeFromTool(col, row);
  });

  canvas.addEventListener('pointermove', (e) => {
    const cell = clientToCell(canvas, e.clientX, e.clientY);
    hoverCell = inBounds(cell.col, cell.row) ? cell : null;

    if (!draggingPieceId) return;
    const dist = Math.hypot(e.clientX - dragStartClientX, e.clientY - dragStartClientY);
    if (dist > 10) dragMoved = true;

    if (dragMoved && inBounds(cell.col, cell.row)) {
      const piece = pieces.find((p) => p.id === draggingPieceId);
      if (piece && (piece.col !== cell.col || piece.row !== cell.row)) {
        const occupant = pieceAt(cell.col, cell.row);
        if (!occupant) {
          piece.col = cell.col;
          piece.row = cell.row;
          recompute();
          updateDynamicUI();
        }
      }
    }
  });

  const endDrag = (e: PointerEvent) => {
    if (!draggingPieceId) return;
    const id = draggingPieceId;
    const wasMoved = dragMoved;
    draggingPieceId = null;
    dragMoved = false;
    if (canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }

    if (!wasMoved) {
      // Tap on an unlocked piece rotates it 1 step!
      rotatePiece(id, 1);
    } else {
      sfxPlace();
      renderUI();
    }
  };

  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('pointerleave', () => {
    if (!draggingPieceId) hoverCell = null;
  });
}

// ---------- UI Rendering ----------

let canvasEl: HTMLCanvasElement | null = null;

function pieceLabel(p: Piece): string {
  if (p.kind === 'FILTER') return `${colorName(p.color ?? COLOR_RED)} Filter`;
  if (p.kind === 'LASER') return `${colorName(p.color ?? COLOR_RED)} Laser`;
  if (p.kind === 'TARGET') return `${colorName(p.color ?? COLOR_RED)} Crystal`;
  if (p.kind === 'PORTAL') return `Portal ${p.portalGroup ?? 'A'}`;
  return p.kind[0] + p.kind.slice(1).toLowerCase();
}

function inventoryLabel(kind: PieceKind, color?: ColorMask, portalGroup?: PortalGroup): { label: string; icon: string } {
  switch (kind) {
    case 'MIRROR':
      return { label: 'Mirror', icon: '🪞' };
    case 'SPLITTER':
      return { label: 'Splitter', icon: '❖' };
    case 'PRISM':
      return { label: 'Prism', icon: '🔺' };
    case 'FILTER':
      return { label: `${colorName(color ?? COLOR_RED)} Filter`, icon: '◎' };
    case 'PORTAL':
      return { label: `Portal ${portalGroup ?? 'A'}`, icon: '🌀' };
    default:
      return { label: kind, icon: '✦' };
  }
}

function updateDynamicUI(): void {
  const victoryEl = document.getElementById('victory-slot');
  if (victoryEl) {
    const lvl = currentLevel();
    const nextLvl = LEVELS.find((l) => l.id === lvl.id + 1);
    victoryEl.innerHTML =
      !lvl.sandbox && trace.allSolved
        ? `<div class="victory-banner">
            <div class="victory-text">
              <span class="victory-title">✨ All Crystals Lit!</span>
              <span class="victory-sub">Level ${lvl.id} complete</span>
            </div>
            ${
              nextLvl
                ? `<button class="success" data-action="next-level">${nextLvl.sandbox ? 'Open Sandbox →' : 'Next Level →'}</button>`
                : ''
            }
          </div>`
        : '';
  }

  const pillsEl = document.getElementById('target-pills');
  if (pillsEl) {
    pillsEl.innerHTML = trace.targets
      .map((t) => {
        const cls = t.lit ? 'lit' : t.wrongMix ? 'wrong' : '';
        const status = t.lit ? '✓' : t.wrongMix ? '!' : '';
        return `<span class="target-pill ${cls}">
          <span class="dot" style="background:${colorHex(t.required)};color:${colorHex(t.required)}"></span>
          ${colorName(t.required)} ${status}
        </span>`;
      })
      .join('');
  }
}

function renderUI(): void {
  const lvl = currentLevel();
  const selectedPiece = pieces.find((p) => p.id === selectedPieceId && !p.locked) ?? null;
  const campaignCount = LEVELS.filter((l) => !l.sandbox).length;
  const solvedCount = save.solved.filter((id) => id <= campaignCount).length;

  const canRotate =
    selectedPiece &&
    (selectedPiece.kind === 'MIRROR' ||
      selectedPiece.kind === 'SPLITTER' ||
      selectedPiece.kind === 'PRISM' ||
      selectedPiece.kind === 'LASER');
  const canRecolor =
    lvl.sandbox &&
    selectedPiece &&
    (selectedPiece.kind === 'LASER' || selectedPiece.kind === 'FILTER' || selectedPiece.kind === 'TARGET');

  // Preserve canvas element across re-renders so animation & pointer capture stay smooth
  const hadCanvas = canvasEl !== null;

  app.innerHTML = `
    <header class="topbar">
      <div class="brand">
        <div class="brand-icon">🔺</div>
        <span class="brand-text">Laser &amp; Prism Lab</span>
      </div>
      <div class="topbar-center">
        <button class="level-btn" data-action="open-levels">
          ${lvl.sandbox ? '🌈 Sandbox' : `Level ${lvl.id}/${campaignCount}`} · ${lvl.title} ▾
        </button>
        <span class="badge">★ ${solvedCount}/${campaignCount}</span>
      </div>
      <div class="topbar-actions">
        ${!lvl.sandbox ? `<button class="${showHint ? 'active' : ''}" data-action="toggle-hint">💡 Hint</button>` : ''}
        <button data-action="clear">↺ Clear</button>
        <button data-action="toggle-mute" aria-label="Toggle sound">${isMuted() ? '🔇' : '🔊'}</button>
      </div>
    </header>

    <main class="workspace">
      <section class="stage-col">
        <div class="board-shell" id="board-shell">
          <div id="victory-slot"></div>
        </div>

        <div class="piece-bar">
          <div class="piece-bar-info">
            ${
              selectedPiece
                ? `Selected: <strong>${pieceLabel(selectedPiece)}</strong> — tap piece to rotate, or drag to move`
                : 'Tap any empty square to place · Tap a placed optic to rotate · Drag to move'
            }
          </div>
          <div class="piece-bar-actions">
            ${
              selectedPiece
                ? `
              ${canRotate ? `<button data-action="rot-left">↺ Rotate</button><button data-action="rot-right">Rotate ↻</button>` : ''}
              ${canRecolor ? `<button data-action="cycle-color">🎨 ${colorName(selectedPiece.color ?? COLOR_RED)}</button>` : ''}
              <button data-action="remove">🗑 Remove</button>
            `
                : lvl.sandbox
                ? `<button class="${spinShow ? 'primary' : ''}" data-action="toggle-spin">${spinShow ? '⏸ Stop Spin' : '✨ Spin Show'}</button>`
                : ''
            }
          </div>
        </div>
      </section>

      <aside class="sidebar">
        <div class="card">
          <span class="chapter-tag">${lvl.chapter}</span>
          <h1 class="mission-title">${lvl.title}</h1>
          <p class="mission-sub">${lvl.subtitle}</p>
          ${!lvl.sandbox ? `<div class="target-pills" id="target-pills"></div>` : ''}
          ${showHint ? `<div class="hint-box">💡 ${lvl.hint}</div>` : ''}
        </div>

        <div class="card">
          <div class="section-label">${lvl.sandbox ? 'Optics Palette' : 'Your Optics Kit'}</div>
          ${
            lvl.sandbox
              ? `
            <div class="palette-grid">
              ${SANDBOX_TOOLS.map(
                (t) => `
                <button class="palette-item ${selectedToolKey === t.key ? 'selected' : ''}" data-tool="${t.key}">
                  <span class="palette-icon">${t.icon}</span>
                  <span class="palette-name">${t.label}</span>
                </button>`
              ).join('')}
            </div>
            <div class="section-label" style="margin-top:4px;">Beam / Crystal Color</div>
            <div class="color-row">
              ${SANDBOX_COLORS.map(
                (c) => `
                <button
                  class="swatch ${sandboxColor === c ? 'selected' : ''}"
                  style="background:${colorHex(c)}"
                  title="${colorName(c)}"
                  data-sandbox-color="${c}"
                ></button>`
              ).join('')}
            </div>
            <div class="section-label" style="margin-top:4px;">Light Show Presets</div>
            <div class="preset-list">
              ${SANDBOX_PRESETS.map(
                (p, idx) => `<button class="preset-btn" data-preset="${idx}">${p.emoji} ${p.name}</button>`
              ).join('')}
            </div>
          `
              : `
            <div class="palette-grid">
              ${lvl.inventory
                .map((item) => {
                  const key = toolKeyOf(item.kind, item.color, item.portalGroup);
                  const rem = getInventoryRemaining(item.kind, item.color, item.portalGroup);
                  const meta = inventoryLabel(item.kind, item.color, item.portalGroup);
                  const dot = item.color
                    ? `<span class="dot" style="background:${colorHex(item.color)};color:${colorHex(item.color)}"></span>`
                    : '';
                  return `
                  <button class="palette-item ${selectedToolKey === key ? 'selected' : ''} ${rem === 0 ? 'empty' : ''}" data-tool="${key}">
                    <span class="palette-count">×${rem}</span>
                    <span class="palette-icon">${dot || meta.icon}</span>
                    <span class="palette-name">${meta.label}</span>
                  </button>`;
                })
                .join('')}
            </div>
          `
          }
        </div>

        <div class="card">
          <div class="section-label">Light Mixing Guide</div>
          <div class="rgb-guide">
            <div class="rgb-row"><span class="dot" style="background:#ff3b5c"></span>+<span class="dot" style="background:#22e584"></span>=<span style="color:#ffe14d">Yellow</span></div>
            <div class="rgb-row"><span class="dot" style="background:#ff3b5c"></span>+<span class="dot" style="background:#38b6ff"></span>=<span style="color:#ff5cf4">Magenta</span></div>
            <div class="rgb-row"><span class="dot" style="background:#22e584"></span>+<span class="dot" style="background:#38b6ff"></span>=<span style="color:#2cf5ff">Cyan</span></div>
            <div class="rgb-row"><span class="dot" style="background:#ff3b5c"></span><span class="dot" style="background:#22e584"></span><span class="dot" style="background:#38b6ff"></span>=<span style="color:#fff">White</span></div>
          </div>
        </div>
      </aside>
    </main>

    ${showLevelModal ? renderLevelModal() : ''}
  `;

  const shell = document.getElementById('board-shell')!;
  if (!hadCanvas) {
    canvasEl = document.createElement('canvas');
    canvasEl.id = 'board';
    attachCanvasEvents(canvasEl);
  }
  shell.prepend(canvasEl!);
  updateDynamicUI();
}

function renderLevelModal(): string {
  const chapters = ['Reflections', 'Splitters', 'Color Mixing', 'Prisms & Filters', 'Sandbox'] as const;
  return `
    <div class="modal-backdrop" data-backdrop="close-levels">
      <div class="modal" role="dialog" aria-label="Choose Level">
        <div class="modal-header">
          <h2>🔦 Choose a Mission</h2>
          <button data-action="close-levels">✕ Close</button>
        </div>
        ${chapters
          .map((ch) => {
            const list = LEVELS.filter((l) => l.chapter === ch);
            return `
            <div class="chapter-group">
              <div class="section-label">${ch}</div>
              <div class="level-grid">
                ${list
                  .map((l) => {
                    const isSolved = save.solved.includes(l.id);
                    const isCurrent = l.id === currentLevelId;
                    return `
                    <button class="level-card ${isCurrent ? 'current' : ''} ${isSolved ? 'solved' : ''}" data-level="${l.id}">
                      <span class="level-card-num">
                        <span>${l.sandbox ? 'SANDBOX' : `LEVEL ${l.id}`}</span>
                        <span>${isSolved ? '★' : ''}</span>
                      </span>
                      <span class="level-card-title">${l.title}</span>
                    </button>`;
                  })
                  .join('')}
              </div>
            </div>`;
          })
          .join('')}
      </div>
    </div>
  `;
}

// Event delegation
app.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;

  if (target.dataset.backdrop === 'close-levels') {
    showLevelModal = false;
    renderUI();
    return;
  }

  const btn = target.closest<HTMLElement>('[data-action], [data-tool], [data-level], [data-sandbox-color], [data-preset]');
  if (!btn) return;

  if (btn.dataset.tool) {
    selectedToolKey = btn.dataset.tool;
    selectedPieceId = null;
    renderUI();
    return;
  }

  if (btn.dataset.level) {
    showLevelModal = false;
    loadLevel(Number(btn.dataset.level));
    return;
  }

  if (btn.dataset.sandboxColor) {
    sandboxColor = Number(btn.dataset.sandboxColor) as ColorMask;
    renderUI();
    return;
  }

  if (btn.dataset.preset) {
    loadPreset(Number(btn.dataset.preset));
    return;
  }

  switch (btn.dataset.action) {
    case 'open-levels':
      showLevelModal = true;
      renderUI();
      break;
    case 'close-levels':
      showLevelModal = false;
      renderUI();
      break;
    case 'toggle-hint':
      showHint = !showHint;
      renderUI();
      break;
    case 'clear':
      clearUnlocked();
      break;
    case 'toggle-mute':
      setMuted(!isMuted());
      save.muted = isMuted();
      writeSave(save);
      renderUI();
      break;
    case 'rot-left':
      if (selectedPieceId) rotatePiece(selectedPieceId, -1);
      break;
    case 'rot-right':
      if (selectedPieceId) rotatePiece(selectedPieceId, 1);
      break;
    case 'cycle-color':
      if (selectedPieceId) cyclePieceColor(selectedPieceId);
      break;
    case 'remove':
      if (selectedPieceId) removePiece(selectedPieceId);
      break;
    case 'next-level':
      loadLevel(currentLevelId + 1);
      break;
    case 'toggle-spin':
      spinShow = !spinShow;
      lastSpinTick = performance.now();
      renderUI();
      break;
  }
});

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && showLevelModal) {
    showLevelModal = false;
    renderUI();
    return;
  }
  if (!selectedPieceId) return;
  if (e.key === 'r' || e.key === 'R' || e.key === 'ArrowRight') {
    rotatePiece(selectedPieceId, 1);
  } else if (e.key === 'ArrowLeft') {
    rotatePiece(selectedPieceId, -1);
  } else if (e.key === 'Backspace' || e.key === 'Delete') {
    removePiece(selectedPieceId);
  }
});

// Animation Loop
let lastFrame = performance.now();
function loop(now: number): void {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  animTime += dt;

  if (spinShow && currentLevel().sandbox && now - lastSpinTick > 650) {
    lastSpinTick = now;
    for (const p of pieces) {
      if (p.kind === 'MIRROR' || p.kind === 'SPLITTER' || p.kind === 'PRISM') {
        p.orient = ((p.orient + 1) % 8) as Orient;
      }
    }
    recompute(false);
  }

  if (canvasEl) {
    drawBoard(canvasEl, dt);
  }
  requestAnimationFrame(loop);
}

loadLevel(currentLevelId);
requestAnimationFrame(loop);
