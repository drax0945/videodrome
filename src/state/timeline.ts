import type { Clip, MediaItem, Track } from './types';
import { clipEnd } from '../lib/util';

const EPS = 1e-4;

export function clipsOnTrack(clips: Clip[], trackId: string, excludeId?: string) {
  return clips.filter((c) => c.trackId === trackId && c.id !== excludeId).sort((a, b) => a.start - b.start);
}

export function isFree(others: Clip[], start: number, dur: number) {
  return others.every((o) => start >= clipEnd(o) - EPS || start + dur <= o.start + EPS);
}

/** Closest start time to `desired` where a clip of length `dur` fits between `others`. */
export function findFreeStart(others: Clip[], desired: number, dur: number) {
  const want = Math.max(0, desired);
  if (isFree(others, want, dur)) return want;
  const candidates = [0];
  for (const o of others) {
    candidates.push(clipEnd(o), o.start - dur);
  }
  let best = Infinity;
  let bestD = Infinity;
  for (const c of candidates) {
    if (c < 0 || !isFree(others, c, dur)) continue;
    const d = Math.abs(c - want);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (best === Infinity) return others.reduce((m, o) => Math.max(m, clipEnd(o)), 0);
  return best;
}

/** End of the nearest clip before `clip` and start of the nearest one after it, on the same track. */
export function neighbourBounds(clips: Clip[], clip: Clip) {
  const others = clipsOnTrack(clips, clip.trackId, clip.id);
  let prevEnd = 0;
  let nextStart = Infinity;
  for (const o of others) {
    if (clipEnd(o) <= clip.start + EPS) prevEnd = Math.max(prevEnd, clipEnd(o));
    if (o.start >= clipEnd(clip) - EPS) nextStart = Math.min(nextStart, o.start);
  }
  return { prevEnd, nextStart };
}

export function projectDuration(clips: Clip[]) {
  return clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
}

/** Max source time available for the clip (Infinity for stills and text). */
export function sourceLength(clip: Clip, media?: MediaItem) {
  if ((clip.type === 'video' || clip.type === 'audio') && media) return media.duration;
  return Infinity;
}

export function trackAccepts(track: Track, clip: Pick<Clip, 'type'>) {
  return clip.type === 'audio' ? track.kind === 'audio' : track.kind === 'visual';
}

export function trackLabels(tracks: Track[]) {
  const labels = new Map<string, string>();
  const visual = tracks.filter((t) => t.kind === 'visual');
  const audio = tracks.filter((t) => t.kind === 'audio');
  visual.forEach((t, i) => labels.set(t.id, `V${visual.length - i}`));
  audio.forEach((t, i) => labels.set(t.id, `A${i + 1}`));
  return labels;
}

export function snapTargets(clips: Clip[], excludeId: string | null, playhead: number) {
  const pts = [0, playhead];
  for (const c of clips) {
    if (c.id === excludeId) continue;
    pts.push(c.start, clipEnd(c));
  }
  return pts;
}

/** Snap any of `edges` (relative offsets) to the nearest target; returns the delta to apply. */
export function snapDelta(values: number[], targets: number[], threshold: number) {
  let best: { delta: number; at: number } | null = null;
  for (const v of values) {
    for (const t of targets) {
      const d = t - v;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t };
    }
  }
  return best;
}
