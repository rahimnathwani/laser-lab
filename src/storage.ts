const STORAGE_KEY = 'laser-lab:v1';

export interface SaveData {
  solved: number[];
  muted: boolean;
  lastLevel: number;
}

const DEFAULT_SAVE: SaveData = {
  solved: [],
  muted: false,
  lastLevel: 1,
};

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SAVE, solved: [] };
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return {
      solved: Array.isArray(parsed.solved) ? parsed.solved.filter((n) => typeof n === 'number') : [],
      muted: Boolean(parsed.muted),
      lastLevel: typeof parsed.lastLevel === 'number' ? parsed.lastLevel : 1,
    };
  } catch {
    return { ...DEFAULT_SAVE, solved: [] };
  }
}

export function writeSave(data: SaveData): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors in private mode.
  }
}
