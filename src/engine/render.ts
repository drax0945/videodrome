import type { Clip, MediaItem, TextStyle, Track } from '../state/types';
import { clamp, fadeEnvelope, filterString, hexToRgba } from '../lib/util';

export interface LayoutBox {
  clipId: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

export interface RenderInput {
  ctx: CanvasRenderingContext2D;
  W: number;
  H: number;
  /** canvas px per project px */
  rs: number;
  time: number;
  background: string;
  tracks: Track[];
  clips: Clip[];
  media: Map<string, MediaItem>;
  getVideo: (clip: Clip) => HTMLVideoElement | undefined;
  getImage: (m: MediaItem) => HTMLImageElement | undefined;
  ensureFont: (font: string) => void;
}

export function fontString(ts: TextStyle) {
  return `${ts.italic ? 'italic ' : ''}${ts.weight} ${ts.size}px "${ts.font}", "Space Grotesk", sans-serif`;
}

interface TextMetrics {
  lines: string[];
  lh: number;
  pad: number;
  w: number;
  h: number;
}

function measureText(ctx: CanvasRenderingContext2D, ts: TextStyle): TextMetrics {
  const content = ts.uppercase ? ts.content.toUpperCase() : ts.content;
  const lines = content.split('\n');
  ctx.font = fontString(ts);
  ctx.letterSpacing = `${ts.letterSpacing}px`;
  const widths = lines.map((l) => ctx.measureText(l).width);
  const lh = ts.size * ts.lineHeight;
  const pad = ts.bgOpacity > 0 ? ts.bgPadding : ts.size * 0.12;
  const w = Math.max(ts.size * 0.6, ...widths) + pad * 2;
  const h = lines.length * lh + pad * 2;
  return { lines, lh, pad, w, h };
}

function visualSize(clip: Clip, m: MediaItem | undefined, el: HTMLVideoElement | undefined, W: number, H: number) {
  const sw = el?.videoWidth || m?.width || W;
  const sh = el?.videoHeight || m?.height || H;
  const s0 = clip.fit === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh);
  return { w: sw * s0 * clip.scale, h: sh * s0 * clip.scale };
}

/* deterministic pseudo-random for glitch frames */
function rand(seed: number) {
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const easeOutBack = (p: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
};

function drawTextLines(
  ctx: CanvasRenderingContext2D,
  ts: TextStyle,
  m: TextMetrics,
  maxChars: number,
  fill: string | null,
  ox = 0,
  oy = 0,
) {
  ctx.textAlign = ts.align;
  ctx.textBaseline = 'middle';
  const x = ts.align === 'left' ? -m.w / 2 + m.pad : ts.align === 'right' ? m.w / 2 - m.pad : 0;
  let remaining = maxChars;
  m.lines.forEach((line, i) => {
    if (remaining <= 0) return;
    const shown = line.slice(0, remaining);
    remaining -= line.length + 1;
    const y = -m.h / 2 + m.pad + m.lh * (i + 0.5);
    if (ts.strokeWidth > 0 && fill === null) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = ts.strokeWidth * 2;
      ctx.strokeStyle = ts.stroke;
      ctx.strokeText(shown, x + ox, y + oy);
    }
    const color = fill ?? (ts.fillOpacity > 0 ? hexToRgba(ts.color, ts.fillOpacity) : null);
    if (color) {
      ctx.fillStyle = color;
      ctx.fillText(shown, x + ox, y + oy);
    }
  });
}

function drawText(ctx: CanvasRenderingContext2D, clip: Clip, local: number, time: number, rs: number, m: TextMetrics) {
  const ts = clip.text!;
  let alpha = 1;
  let dy = 0;
  let sc = 1;
  let maxChars = Infinity;
  let glitch = 0;
  const seed = hash(clip.id);

  switch (ts.anim) {
    case 'typewriter': {
      const total = m.lines.join('\n').length;
      const dur = clamp(clip.duration * 0.6, 0.4, 2.5);
      maxChars = Math.floor(total * clamp(local / dur, 0, 1));
      break;
    }
    case 'slide': {
      const p = easeOut(clamp(local / 0.6, 0, 1));
      dy = (1 - p) * ts.size * 0.9;
      alpha = p;
      break;
    }
    case 'pop': {
      const p = clamp(local / 0.45, 0, 1);
      sc = 0.4 + 0.6 * easeOutBack(p);
      alpha = clamp(p * 2.5, 0, 1);
      break;
    }
    case 'glitch': {
      const frame = Math.floor(time * 24);
      const r = rand(seed + frame);
      glitch = local < 0.6 ? 1 - (local / 0.6) * 0.7 : r < 0.1 ? 0.8 : 0.12;
      break;
    }
  }

  ctx.globalAlpha *= alpha;
  ctx.translate(0, dy);
  ctx.scale(sc, sc);

  if (ts.bgOpacity > 0) {
    ctx.fillStyle = hexToRgba(ts.bg, ts.bgOpacity);
    ctx.beginPath();
    ctx.roundRect(-m.w / 2, -m.h / 2, m.w, m.h, ts.bgRadius);
    ctx.fill();
  }

  ctx.font = fontString(ts);
  ctx.letterSpacing = `${ts.letterSpacing}px`;

  if (ts.glow > 0) {
    ctx.shadowColor = ts.glowColor;
    ctx.shadowBlur = ts.glow * rs * clip.scale;
  }

  if (glitch > 0) {
    const frame = Math.floor(time * 24);
    const off = glitch * ts.size * 0.09;
    const jx = (rand(seed + frame * 3) - 0.5) * off;
    const jy = (rand(seed + frame * 7) - 0.5) * off * 0.4;
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    drawTextLines(ctx, ts, m, maxChars, 'rgba(0,240,255,0.85)', -off + jx, jy);
    drawTextLines(ctx, ts, m, maxChars, 'rgba(255,0,90,0.85)', off + jx, -jy);
    ctx.globalCompositeOperation = prev;
    drawTextLines(ctx, ts, m, maxChars, null, jx * 0.3, 0);
    // displaced horizontal slices
    const slices = glitch > 0.5 ? 3 : 1;
    for (let i = 0; i < slices; i++) {
      const r1 = rand(seed + frame * 13 + i);
      const r2 = rand(seed + frame * 17 + i);
      if (r2 > glitch + 0.15) continue;
      const sh = m.h * (0.06 + r1 * 0.12);
      const sy = -m.h / 2 + r2 * (m.h - sh);
      ctx.save();
      ctx.beginPath();
      ctx.rect(-m.w, sy, m.w * 2, sh);
      ctx.clip();
      drawTextLines(ctx, ts, m, maxChars, i % 2 ? '#2ef2ff' : '#c8ff2e', (r1 - 0.5) * ts.size * 0.6, 0);
      ctx.restore();
    }
  } else {
    drawTextLines(ctx, ts, m, maxChars, null);
  }

  // blinking caret for typewriter
  if (ts.anim === 'typewriter' && Math.floor(time * 2.5) % 2 === 0) {
    ctx.shadowBlur = 0;
    const total = m.lines.join('\n').length;
    if (maxChars < total || local < clip.duration - 0.2) {
      let left = maxChars;
      let lineIdx = 0;
      for (; lineIdx < m.lines.length; lineIdx++) {
        if (left <= m.lines[lineIdx].length) break;
        left -= m.lines[lineIdx].length + 1;
      }
      lineIdx = Math.min(lineIdx, m.lines.length - 1);
      const line = m.lines[lineIdx].slice(0, Math.max(0, left));
      const lw = ctx.measureText(line).width;
      const full = ctx.measureText(m.lines[lineIdx]).width;
      const x0 = ts.align === 'left' ? -m.w / 2 + m.pad : ts.align === 'right' ? m.w / 2 - m.pad - full : -full / 2;
      const y = -m.h / 2 + m.pad + m.lh * lineIdx;
      ctx.fillStyle = hexToRgba(ts.color, 1);
      ctx.fillRect(x0 + lw + ts.size * 0.05, y + m.lh * 0.15, ts.size * 0.08, m.lh * 0.7);
    }
  }
}

export function renderFrame(r: RenderInput): LayoutBox[] {
  const { ctx, W, H, rs, time } = r;
  const layout: LayoutBox[] = [];
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.fillStyle = r.background;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.setTransform(rs, 0, 0, rs, 0, 0);

  const visual = r.tracks.filter((t) => t.kind === 'visual' && !t.hidden);
  for (let ti = visual.length - 1; ti >= 0; ti--) {
    const track = visual[ti];
    for (const clip of r.clips) {
      if (clip.trackId !== track.id) continue;
      const local = time - clip.start;
      if (local < 0 || local >= clip.duration) continue;
      const env = fadeEnvelope(clip, local);
      const alpha = clip.opacity * env;
      const cx = clip.x * W;
      const cy = clip.y * H;
      const rot = (clip.rotation * Math.PI) / 180;

      if (clip.type === 'text' && clip.text) {
        r.ensureFont(fontString(clip.text));
        const m = measureText(ctx, clip.text);
        layout.push({ clipId: clip.id, cx, cy, w: m.w * clip.scale, h: m.h * clip.scale, rotation: clip.rotation });
        if (alpha <= 0.001) continue;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(rot);
        ctx.scale(clip.scale, clip.scale);
        ctx.globalAlpha = alpha;
        drawText(ctx, clip, local, time, rs, m);
        ctx.restore();
        continue;
      }

      const m = clip.mediaId ? r.media.get(clip.mediaId) : undefined;
      if (!m) continue;
      let source: CanvasImageSource | undefined;
      let el: HTMLVideoElement | undefined;
      if (clip.type === 'video') {
        el = r.getVideo(clip);
        if (el && el.readyState >= 2) source = el;
      } else if (clip.type === 'image') {
        const img = r.getImage(m);
        if (img && img.complete && img.naturalWidth) source = img;
      }
      const { w, h } = visualSize(clip, m, el, W, H);
      layout.push({ clipId: clip.id, cx, cy, w, h, rotation: clip.rotation });
      if (!source || alpha <= 0.001) continue;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rot);
      ctx.globalAlpha = alpha;
      ctx.filter = filterString(clip.filters, rs);
      ctx.drawImage(source, -w / 2, -h / 2, w, h);
      ctx.restore();
    }
  }
  return layout;
}

/** Topmost box under a point (project coords). */
export function hitTest(layout: LayoutBox[], px: number, py: number) {
  for (let i = layout.length - 1; i >= 0; i--) {
    const b = layout[i];
    const a = (-b.rotation * Math.PI) / 180;
    const dx = px - b.cx;
    const dy = py - b.cy;
    const lx = dx * Math.cos(a) - dy * Math.sin(a);
    const ly = dx * Math.sin(a) + dy * Math.cos(a);
    if (Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2) return b.clipId;
  }
  return null;
}
