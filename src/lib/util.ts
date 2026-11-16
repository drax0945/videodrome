import type { AspectKey, Clip, Filters } from '../state/types';

export const uid = (p = 'id') => `${p}_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-3)}`;

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export const FPS = 30;
export const PEAKS_PER_SEC = 100;
export const MIN_CLIP = 0.1;

export const ASPECTS: Record<AspectKey, { w: number; h: number; label: string }> = {
  '16:9': { w: 1920, h: 1080, label: 'Widescreen' },
  '9:16': { w: 1080, h: 1920, label: 'Vertical' },
  '1:1': { w: 1080, h: 1080, label: 'Square' },
  '4:5': { w: 1080, h: 1350, label: 'Portrait' },
  '21:9': { w: 2520, h: 1080, label: 'Cinema' },
};

/** HH:MM:SS:FF */
export function timecode(t: number, fps = FPS) {
  const safe = Math.max(0, t);
  const total = Math.floor(safe * fps + 1e-6);
  const f = total % fps;
  const s = Math.floor(total / fps) % 60;
  const m = Math.floor(total / (fps * 60)) % 60;
  const h = Math.floor(total / (fps * 3600));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}:${p(f)}`;
}

/** Compact mm:ss.d */
export function shortTime(t: number) {
  const safe = Math.max(0, t);
  const m = Math.floor(safe / 60);
  const s = safe - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}

export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const clipEnd = (c: Clip) => c.start + c.duration;

export const DEFAULT_FILTERS: Filters = {
  brightness: 100,
  contrast: 100,
  saturate: 100,
  hue: 0,
  blur: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
};

export const FILTER_PRESETS: { id: string; label: string; f: Partial<Filters> }[] = [
  { id: 'none', label: 'Raw', f: {} },
  { id: 'noir', label: 'Noir', f: { grayscale: 100, contrast: 135, brightness: 95 } },
  { id: 'cyber', label: 'Cyber', f: { hue: 170, saturate: 160, contrast: 115 } },
  { id: 'vapor', label: 'Vapor', f: { hue: 290, saturate: 140, brightness: 108 } },
  { id: 'film', label: 'Film', f: { sepia: 35, contrast: 110, saturate: 85 } },
  { id: 'vivid', label: 'Vivid', f: { saturate: 175, contrast: 112 } },
  { id: 'fade', label: 'Washed', f: { contrast: 78, brightness: 112, saturate: 70 } },
  { id: 'acid', label: 'Acid', f: { hue: 80, saturate: 220, contrast: 125 } },
  { id: 'xray', label: 'X-Ray', f: { invert: 100, grayscale: 100, contrast: 120 } },
];

export function filterString(f: Filters, blurScale = 1) {
  const parts: string[] = [];
  if (f.brightness !== 100) parts.push(`brightness(${f.brightness}%)`);
  if (f.contrast !== 100) parts.push(`contrast(${f.contrast}%)`);
  if (f.saturate !== 100) parts.push(`saturate(${f.saturate}%)`);
  if (f.hue !== 0) parts.push(`hue-rotate(${f.hue}deg)`);
  if (f.grayscale) parts.push(`grayscale(${f.grayscale}%)`);
  if (f.sepia) parts.push(`sepia(${f.sepia}%)`);
  if (f.invert) parts.push(`invert(${f.invert}%)`);
  if (f.blur) parts.push(`blur(${(f.blur * blurScale).toFixed(2)}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

/** 0..1 envelope from the clip's fade in / fade out at local time `local`. */
export function fadeEnvelope(c: Clip, local: number) {
  let e = 1;
  if (c.fadeIn > 0 && local < c.fadeIn) e = Math.min(e, local / c.fadeIn);
  if (c.fadeOut > 0 && local > c.duration - c.fadeOut) e = Math.min(e, (c.duration - local) / c.fadeOut);
  return clamp(e, 0, 1);
}

export function isEditableTarget(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function hexToRgba(hex: string, a: number) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
