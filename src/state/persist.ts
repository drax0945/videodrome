import { create } from 'zustand';
import type { AspectKey, Clip, MediaItem, Track } from './types';
import { MAIN_TRACK_ID, cleanupTracks, resetProject, toast, useEditor } from './store';
import { engine } from '../engine/engine';
import { reanalyse } from '../engine/media';

/*
 * Autosave to IndexedDB, three stores:
 *   project – one record ('current') with the timeline, settings and media order
 *   media   – per-item metadata (duration, thumbnails, waveform peaks…)
 *   blobs   – the original imported files, written once per item
 */

const DB_NAME = 'videodrome';
const DB_VERSION = 1;
const PROJECT_KEY = 'current';
const SAVE_DELAY = 500;

interface SavedProject {
  v: 1;
  projectName: string;
  aspect: AspectKey;
  background: string;
  tracks: Track[];
  clips: Clip[];
  mediaOrder: string[];
  pps: number;
  snap: boolean;
  playhead: number;
  savedAt: number;
}

type SavedMedia = Omit<MediaItem, 'url' | 'file'>;

export type SaveStatus = 'idle' | 'restoring' | 'saving' | 'saved' | 'error';

export const usePersist = create<{ status: SaveStatus; savedAt: number | null }>(() => ({
  status: 'idle',
  savedAt: null,
}));

/* ───────────── tiny IndexedDB wrapper ───────────── */

let dbPromise: Promise<IDBDatabase> | null = null;

function db() {
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      for (const name of ['project', 'media', 'blobs']) {
        if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run<T = undefined>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/* ───────────── write tracking ───────────── */

let pending = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let quotaWarned = false;

function refreshStatus() {
  if (pending > 0 || timer) usePersist.setState({ status: 'saving' });
  else if (usePersist.getState().status !== 'error') usePersist.setState({ status: 'saved', savedAt: Date.now() });
}

async function track(job: Promise<unknown>) {
  pending++;
  refreshStatus();
  try {
    await job;
  } catch (err) {
    const name = (err as DOMException | null)?.name;
    usePersist.setState({ status: 'error' });
    if (name === 'QuotaExceededError') {
      if (!quotaWarned) toast('Browser storage is full — some media won’t survive a reload', 'error');
      quotaWarned = true;
    } else {
      console.warn('[videodrome] autosave failed', err);
    }
  } finally {
    pending--;
    refreshStatus();
  }
}

/** True while something hasn't reached disk yet. */
export function hasUnsavedWork() {
  return pending > 0 || !!timer;
}

/* ───────────── project ───────────── */

function projectRecord(): SavedProject {
  const s = useEditor.getState();
  return {
    v: 1,
    projectName: s.projectName,
    aspect: s.aspect,
    background: s.background,
    tracks: s.tracks,
    clips: s.clips,
    mediaOrder: s.media.map((m) => m.id),
    pps: s.pps,
    snap: s.snap,
    playhead: engine.time,
    savedAt: Date.now(),
  };
}

function saveProjectNow() {
  clearTimeout(timer);
  timer = undefined;
  void track(run('project', 'readwrite', (s) => s.put(projectRecord(), PROJECT_KEY)));
}

function scheduleProjectSave() {
  clearTimeout(timer);
  timer = setTimeout(saveProjectNow, SAVE_DELAY);
  refreshStatus();
}

/* ───────────── media ───────────── */

const blobsSaved = new Set<string>();
const metaSig = new Map<string, string>();

function metaRecord(m: MediaItem): SavedMedia {
  // image posters are the object URL itself, which won't survive a reload
  const { url: _url, file: _file, ...rest } = m;
  return { ...rest, poster: m.kind === 'image' ? undefined : m.poster };
}

const signature = (m: MediaItem) =>
  `${m.status}|${m.progress}|${m.duration}|${m.width}x${m.height}|${m.thumbnails.length}|${m.peaks?.length ?? 0}`;

function syncMedia(media: MediaItem[]) {
  const live = new Set(media.map((m) => m.id));
  for (const m of media) {
    if (!blobsSaved.has(m.id)) {
      blobsSaved.add(m.id);
      void navigator.storage?.persist?.().catch(() => undefined);
      void track(run('blobs', 'readwrite', (s) => s.put(m.file, m.id)));
    }
    const sig = signature(m);
    if (metaSig.get(m.id) !== sig) {
      metaSig.set(m.id, sig);
      void track(run('media', 'readwrite', (s) => s.put(metaRecord(m), m.id)));
    }
  }
  for (const id of [...blobsSaved]) {
    if (live.has(id)) continue;
    blobsSaved.delete(id);
    metaSig.delete(id);
    void track(run('blobs', 'readwrite', (s) => s.delete(id)));
    void track(run('media', 'readwrite', (s) => s.delete(id)));
  }
}

/* ───────────── restore ───────────── */

async function restore(): Promise<boolean> {
  const project = await run<SavedProject>('project', 'readonly', (s) => s.get(PROJECT_KEY));
  const metas = (await run<SavedMedia[]>('media', 'readonly', (s) => s.getAll())) ?? [];
  if (!project && !metas.length) return false;

  const items: MediaItem[] = [];
  const needsWork: MediaItem[] = [];
  for (const meta of metas) {
    const blob = await run<Blob>('blobs', 'readonly', (s) => s.get(meta.id));
    if (!blob) continue;
    const file = blob instanceof File ? blob : new File([blob], meta.name, { type: blob.type });
    const url = URL.createObjectURL(file);
    const item: MediaItem = { ...meta, file, url, poster: meta.kind === 'image' ? url : meta.poster };
    if (item.status !== 'error' && (item.status !== 'ready' || item.progress < 1)) {
      Object.assign(item, { status: 'processing', progress: 0, thumbnails: [], peaks: undefined });
      needsWork.push(item);
    }
    items.push(item);
    blobsSaved.add(item.id);
    metaSig.set(item.id, signature(item));
  }

  const order = new Map((project?.mediaOrder ?? []).map((id, i) => [id, i]));
  items.sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  const ids = new Set(items.map((m) => m.id));

  const s = useEditor.getState();
  const tracks = project?.tracks?.length ? project.tracks : s.tracks;
  if (!tracks.some((t) => t.id === MAIN_TRACK_ID)) tracks.unshift(s.tracks[0]);
  useEditor.setState({
    projectName: project?.projectName ?? s.projectName,
    aspect: project?.aspect ?? s.aspect,
    background: project?.background ?? s.background,
    tracks,
    clips: (project?.clips ?? []).filter((c) => !c.mediaId || ids.has(c.mediaId)),
    media: items,
    pps: project?.pps ?? s.pps,
    snap: project?.snap ?? s.snap,
    selectedId: null,
    past: [],
    future: [],
  });
  cleanupTracks();
  engine.seek(project?.playhead ?? 0);
  needsWork.forEach(reanalyse);
  return true;
}

/* ───────────── lifecycle ───────────── */

let initPromise: Promise<void> | null = null;

/** Restore the last session, then autosave every change. Safe to call more than once. */
export function initPersistence() {
  initPromise ??= (async () => {
    if (typeof indexedDB === 'undefined') return;
    usePersist.setState({ status: 'restoring' });
    try {
      const restored = await restore();
      if (restored) {
        const { projectName, clips } = useEditor.getState();
        if (clips.length) toast(`Restored “${projectName}”`, 'success');
      }
    } catch (err) {
      console.warn('[videodrome] restore failed', err);
      toast('Couldn’t restore the last session', 'error');
    }
    usePersist.setState({ status: 'saved', savedAt: Date.now() });

    useEditor.subscribe((s, p) => {
      if (s.media !== p.media) syncMedia(s.media);
      if (
        s.clips !== p.clips ||
        s.tracks !== p.tracks ||
        s.media !== p.media ||
        s.projectName !== p.projectName ||
        s.aspect !== p.aspect ||
        s.background !== p.background ||
        s.pps !== p.pps ||
        s.snap !== p.snap
      ) {
        scheduleProjectSave();
      }
    });
    // persist the playhead when it stops moving
    let wasPlaying = false;
    engine.subscribe(() => {
      if (wasPlaying && !engine.playing) scheduleProjectSave();
      wasPlaying = engine.playing;
    });
    const flush = () => {
      if (timer) saveProjectNow();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && flush());
  })();
  return initPromise;
}

/** Clear storage and start from a blank project. */
export async function newProject() {
  engine.pause();
  clearTimeout(timer);
  timer = undefined;
  blobsSaved.clear();
  metaSig.clear();
  resetProject();
  engine.seek(0);
  await track(
    Promise.all([
      run('project', 'readwrite', (s) => s.clear()),
      run('media', 'readwrite', (s) => s.clear()),
      run('blobs', 'readwrite', (s) => s.clear()),
    ]),
  );
  usePersist.setState({ status: 'saved', savedAt: Date.now() });
}

if (import.meta.hot) import.meta.hot.dispose(() => window.location.reload());
