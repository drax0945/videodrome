import { create } from 'zustand';
import type { AspectKey, Clip, MediaItem, TextStyle, Toast, Track, TrackKind } from './types';
import { BASE_TEXT, TEXT_PRESETS } from './textPresets';
import { DEFAULT_FILTERS, MIN_CLIP, clipEnd, uid } from '../lib/util';
import { clipsOnTrack, findFreeStart, isFree, projectDuration, trackAccepts } from './timeline';

interface Snapshot {
  tracks: Track[];
  clips: Clip[];
  aspect: AspectKey;
  background: string;
}

export type LeftTab = 'media' | 'text' | 'canvas' | 'keys';

export interface EditorState {
  projectName: string;
  aspect: AspectKey;
  background: string;
  media: MediaItem[];
  tracks: Track[];
  clips: Clip[];
  selectedId: string | null;
  pps: number;
  snap: boolean;
  guides: boolean;
  leftTab: LeftTab;
  exportOpen: boolean;
  toasts: Toast[];
  past: Snapshot[];
  future: Snapshot[];
  lastCommit: { key: string; at: number } | null;
}

const mainTrack: Track = { id: 'track_main', kind: 'visual', hidden: false, muted: false, main: true };

const initialState = (): EditorState => ({
  projectName: 'Untitled sequence',
  aspect: '16:9',
  background: '#000000',
  media: [],
  tracks: [mainTrack],
  clips: [],
  selectedId: null,
  pps: 60,
  snap: true,
  guides: false,
  leftTab: 'media',
  exportOpen: false,
  toasts: [],
  past: [],
  future: [],
  lastCommit: null,
});

export const useEditor = create<EditorState>(initialState);

const get = useEditor.getState;
const set = useEditor.setState;

const snapshot = (s: EditorState): Snapshot => ({
  tracks: s.tracks,
  clips: s.clips,
  aspect: s.aspect,
  background: s.background,
});

/* ───────────────────────── history ───────────────────────── */

/** Push an undo checkpoint. Calls sharing a `key` within 800ms are merged (slider drags etc). */
export function commit(key?: string) {
  const s = get();
  const now = performance.now();
  if (key && s.lastCommit?.key === key && now - s.lastCommit.at < 800) {
    set({ lastCommit: { key, at: now } });
    return;
  }
  set({ past: [...s.past.slice(-99), snapshot(s)], future: [], lastCommit: key ? { key, at: now } : null });
}

export function undo() {
  const s = get();
  const prev = s.past[s.past.length - 1];
  if (!prev) return;
  set({
    ...prev,
    past: s.past.slice(0, -1),
    future: [snapshot(s), ...s.future].slice(0, 100),
    lastCommit: null,
    selectedId: prev.clips.some((c) => c.id === s.selectedId) ? s.selectedId : null,
  });
}

export function redo() {
  const s = get();
  const next = s.future[0];
  if (!next) return;
  set({
    ...next,
    future: s.future.slice(1),
    past: [...s.past, snapshot(s)],
    lastCommit: null,
    selectedId: next.clips.some((c) => c.id === s.selectedId) ? s.selectedId : null,
  });
}

/* ───────────────────────── toasts ───────────────────────── */

export function toast(message: string, kind: Toast['kind'] = 'info') {
  const id = uid('toast');
  set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3800);
}

/* ───────────────────────── media ───────────────────────── */

export function addMedia(item: MediaItem) {
  set((s) => ({ media: [item, ...s.media] }));
}

export function updateMedia(id: string, patch: Partial<MediaItem>) {
  set((s) => ({ media: s.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
}

export function removeMedia(id: string) {
  const s = get();
  const m = s.media.find((x) => x.id === id);
  if (!m) return;
  const used = s.clips.some((c) => c.mediaId === id);
  if (used) commit();
  set({
    media: s.media.filter((x) => x.id !== id),
    clips: s.clips.filter((c) => c.mediaId !== id),
    selectedId: s.clips.find((c) => c.id === s.selectedId)?.mediaId === id ? null : s.selectedId,
  });
  cleanupTracks();
  // keep URL alive if undo could restore clips referencing it
  if (!used) URL.revokeObjectURL(m.url);
}

/* ───────────────────────── tracks ───────────────────────── */

/** Insert a track. Visual tracks live above audio tracks; `position` is relative to its group. */
export function insertTrack(kind: TrackKind, position: 'top' | 'bottom'): string {
  const t: Track = { id: uid('track'), kind, hidden: false, muted: false };
  set((s) => {
    const visual = s.tracks.filter((x) => x.kind === 'visual');
    const audio = s.tracks.filter((x) => x.kind === 'audio');
    if (kind === 'visual') {
      if (position === 'top') visual.unshift(t);
      else visual.push(t);
    } else if (position === 'top') audio.unshift(t);
    else audio.push(t);
    return { tracks: [...visual, ...audio] };
  });
  return t.id;
}

export function updateTrack(id: string, patch: Partial<Track>) {
  commit();
  set((s) => ({ tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
}

export function cleanupTracks() {
  set((s) => {
    const used = new Set(s.clips.map((c) => c.trackId));
    const tracks = s.tracks.filter((t) => t.main || used.has(t.id));
    return tracks.length === s.tracks.length ? {} : { tracks };
  });
}

/* ───────────────────────── clips ───────────────────────── */

function baseClip(partial: Partial<Clip> & Pick<Clip, 'type' | 'trackId' | 'name' | 'duration'>): Clip {
  return {
    id: uid('clip'),
    start: 0,
    trimStart: 0,
    speed: 1,
    x: 0.5,
    y: 0.5,
    scale: 1,
    rotation: 0,
    opacity: 1,
    fit: 'contain',
    filters: { ...DEFAULT_FILTERS },
    filterPreset: 'none',
    fadeIn: 0,
    fadeOut: 0,
    volume: 1,
    muted: false,
    ...partial,
  };
}

export interface PlaceOpts {
  trackId?: string;
  newTrack?: 'top' | 'bottom';
  start?: number;
}

function resolveTrack(kind: TrackKind, opts: PlaceOpts, fallback: () => string): string {
  const s = get();
  if (opts.newTrack) return insertTrack(kind, opts.newTrack);
  if (opts.trackId) {
    const t = s.tracks.find((x) => x.id === opts.trackId);
    if (t && t.kind === kind) return t.id;
  }
  return fallback();
}

export function addClipFromMedia(mediaId: string, opts: PlaceOpts = {}, playhead = 0): string | null {
  const s = get();
  const m = s.media.find((x) => x.id === mediaId);
  if (!m) return null;
  if (m.status === 'error') {
    toast(`Can't use ${m.name}: ${m.error ?? 'unsupported file'}`, 'error');
    return null;
  }
  if (m.kind !== 'image' && !(m.duration > 0)) {
    toast('Still analysing that file — try again in a second');
    return null;
  }
  commit();
  const duration = m.kind === 'image' ? 5 : m.duration;
  let start = opts.start;
  let trackId: string;

  if (m.kind === 'audio') {
    const at = start ?? playhead;
    trackId = resolveTrack('audio', opts, () => {
      const audioTracks = get().tracks.filter((t) => t.kind === 'audio');
      const free = audioTracks.find((t) => isFree(clipsOnTrack(get().clips, t.id), at, duration));
      return free ? free.id : insertTrack('audio', 'bottom');
    });
    start = at;
  } else {
    trackId = resolveTrack('visual', opts, () => mainTrack.id);
    if (start === undefined) {
      // append to the end of the target track
      start = clipsOnTrack(get().clips, trackId).reduce((mx, c) => Math.max(mx, clipEnd(c)), 0);
    }
  }

  const track = get().tracks.find((t) => t.id === trackId)!;
  const overlay = track.kind === 'visual' && !track.main;
  const others = clipsOnTrack(get().clips, trackId);
  const clip = baseClip({
    type: m.kind,
    trackId,
    mediaId: m.id,
    name: m.name,
    duration,
    start: findFreeStart(others, start, duration),
    ...(overlay ? { scale: 0.42, x: 0.73, y: 0.28 } : {}),
  });
  set((st) => ({ clips: [...st.clips, clip], selectedId: clip.id }));
  return clip.id;
}

export function addTextClip(presetId: string, opts: PlaceOpts = {}, playhead = 0): string {
  const preset = TEXT_PRESETS.find((p) => p.id === presetId) ?? TEXT_PRESETS[0];
  commit();
  const start = Math.max(0, opts.start ?? playhead);
  const duration = preset.duration ?? 4;
  const trackId = resolveTrack('visual', opts, () => {
    const st = get();
    const free = st.tracks.find(
      (t) => t.kind === 'visual' && !t.main && isFree(clipsOnTrack(st.clips, t.id), start, duration),
    );
    return free ? free.id : insertTrack('visual', 'top');
  });
  const text: TextStyle = { ...BASE_TEXT, ...preset.style };
  const clip = baseClip({
    type: 'text',
    trackId,
    name: preset.label,
    duration,
    start: findFreeStart(clipsOnTrack(get().clips, trackId), start, duration),
    x: preset.x ?? 0.5,
    y: preset.y ?? 0.5,
    text,
  });
  set((st) => ({ clips: [...st.clips, clip], selectedId: clip.id }));
  return clip.id;
}

/** Patch a clip. Pass `history: false` for transient drag updates, or a key to coalesce. */
export function updateClip(id: string, patch: Partial<Clip>, history: boolean | string = true) {
  if (history) commit(typeof history === 'string' ? history : undefined);
  set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
}

export function updateText(id: string, patch: Partial<TextStyle>, key?: string) {
  commit(key ?? `text:${id}:${Object.keys(patch).join(',')}`);
  set((s) => ({
    clips: s.clips.map((c) => (c.id === id && c.text ? { ...c, text: { ...c.text, ...patch } } : c)),
  }));
}

export function selectClip(id: string | null) {
  if (get().selectedId !== id) set({ selectedId: id });
}

export function deleteClip(id: string, ripple = false) {
  const s = get();
  const c = s.clips.find((x) => x.id === id);
  if (!c) return;
  commit();
  let clips = s.clips.filter((x) => x.id !== id);
  if (ripple) {
    clips = clips.map((x) =>
      x.trackId === c.trackId && x.start >= clipEnd(c) - 1e-4 ? { ...x, start: x.start - c.duration } : x,
    );
  }
  set({ clips, selectedId: s.selectedId === id ? null : s.selectedId });
  cleanupTracks();
}

export function duplicateClip(id: string) {
  const s = get();
  const c = s.clips.find((x) => x.id === id);
  if (!c) return;
  commit();
  const others = clipsOnTrack(s.clips, c.trackId);
  const copy: Clip = {
    ...c,
    id: uid('clip'),
    text: c.text ? { ...c.text } : undefined,
    filters: { ...c.filters },
    start: findFreeStart(others, clipEnd(c), c.duration),
  };
  set({ clips: [...s.clips, copy], selectedId: copy.id });
}

function splitOne(clips: Clip[], c: Clip, t: number): { clips: Clip[]; right?: Clip } {
  if (t <= c.start + MIN_CLIP || t >= clipEnd(c) - MIN_CLIP) return { clips };
  const leftDur = t - c.start;
  const left: Clip = { ...c, duration: leftDur, fadeOut: 0 };
  const right: Clip = {
    ...c,
    id: uid('clip'),
    start: t,
    duration: c.duration - leftDur,
    trimStart: c.trimStart + leftDur * c.speed,
    fadeIn: 0,
    filters: { ...c.filters },
    text: c.text ? { ...c.text } : undefined,
  };
  return { clips: clips.map((x) => (x.id === c.id ? left : x)).concat(right), right };
}

/** Split the selected clip at `t`, or every clip under the playhead when nothing selected is there. */
export function splitAt(t: number): number {
  const s = get();
  const sel = s.clips.find((c) => c.id === s.selectedId);
  const targets =
    sel && t > sel.start && t < clipEnd(sel) ? [sel] : s.clips.filter((c) => t > c.start && t < clipEnd(c));
  const valid = targets.filter((c) => t > c.start + MIN_CLIP && t < clipEnd(c) - MIN_CLIP);
  if (!valid.length) return 0;
  commit();
  let clips = s.clips;
  let lastRight: Clip | undefined;
  for (const c of valid) {
    const r = splitOne(clips, c, t);
    clips = r.clips;
    if (r.right && c.id === s.selectedId) lastRight = r.right;
  }
  set({ clips, selectedId: lastRight ? lastRight.id : s.selectedId });
  return valid.length;
}

/** Move a clip to another track/time (transient — caller commits once at drag start). */
export function placeClip(id: string, start: number, trackId: string) {
  set((s) => ({ clips: s.clips.map((c) => (c.id === id ? { ...c, start, trackId } : c)) }));
}

export function moveClipToNewTrack(id: string, position: 'top' | 'bottom', start: number) {
  const s = get();
  const c = s.clips.find((x) => x.id === id);
  if (!c) return;
  const kind: TrackKind = c.type === 'audio' ? 'audio' : 'visual';
  const trackId = insertTrack(kind, position);
  placeClip(id, Math.max(0, start), trackId);
}

/* ───────────────────────── project ───────────────────────── */

export function setAspect(aspect: AspectKey) {
  if (get().aspect === aspect) return;
  commit();
  set({ aspect });
}

export function setBackground(background: string) {
  commit('background');
  set({ background });
}

/** Wipe the timeline and library back to a blank project (keeps UI tab + toasts). */
export function resetProject() {
  const s = get();
  for (const m of s.media) URL.revokeObjectURL(m.url);
  set({ ...initialState(), leftTab: s.leftTab, toasts: s.toasts });
}

export const MAIN_TRACK_ID = mainTrack.id;

export function getDuration() {
  return projectDuration(get().clips);
}

export { trackAccepts };

if (import.meta.hot) import.meta.hot.dispose(() => window.location.reload());
