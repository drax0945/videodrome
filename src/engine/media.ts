import type { MediaItem, MediaKind } from '../state/types';
import { addClipFromMedia, addMedia, toast, updateMedia, useEditor } from '../state/store';
import { PEAKS_PER_SEC, uid } from '../lib/util';

const EXT: Record<string, MediaKind> = {
  mp4: 'video', mov: 'video', webm: 'video', mkv: 'video', m4v: 'video', ogv: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', opus: 'audio',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', avif: 'image', bmp: 'image', svg: 'image',
};

function kindOf(file: File): MediaKind | null {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT[ext] ?? null;
}

export const ACCEPT = 'video/*,audio/*,image/*';

export interface ImportOpts {
  /** Drop the media onto the timeline once its metadata is known. */
  addToTimeline?: boolean;
  playhead?: () => number;
}

export function importFiles(files: FileList | File[], opts: ImportOpts = {}) {
  const list = Array.from(files);
  let skipped = 0;
  for (const file of list) {
    const kind = kindOf(file);
    if (!kind) {
      skipped++;
      continue;
    }
    const item: MediaItem = {
      id: uid('media'),
      kind,
      name: file.name,
      url: URL.createObjectURL(file),
      file,
      size: file.size,
      duration: 0,
      width: 0,
      height: 0,
      thumbnails: [],
      status: 'processing',
      progress: 0,
    };
    addMedia(item);
    analyse(item)
      .then(() => {
        if (opts.addToTimeline) addClipFromMedia(item.id, {}, opts.playhead?.() ?? 0);
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        updateMedia(item.id, { status: 'error', error: msg });
        toast(`Couldn't read ${file.name} — ${msg}`, 'error');
      });
  }
  if (skipped) toast(`${skipped} file${skipped > 1 ? 's' : ''} skipped — unsupported format`, 'error');
}

/** Re-run analysis for an item restored from storage mid-processing. */
export function reanalyse(item: MediaItem) {
  analyse(item).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    updateMedia(item.id, { status: 'error', error: msg });
  });
}

async function analyse(item: MediaItem) {
  if (item.kind === 'image') return analyseImage(item);
  if (item.kind === 'video') return analyseVideo(item);
  return analyseAudio(item);
}

/* ───────────── image ───────────── */

async function analyseImage(item: MediaItem) {
  const img = new Image();
  img.src = item.url;
  await img.decode().catch(() => {
    throw new Error('image could not be decoded');
  });
  updateMedia(item.id, {
    width: img.naturalWidth || 1920,
    height: img.naturalHeight || 1080,
    poster: item.url,
    status: 'ready',
    progress: 1,
  });
}

/* ───────────── video ───────────── */

function once(el: HTMLMediaElement, ok: string, timeout = 15000) {
  return new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => {
      cleanup();
      reject(new Error('timed out reading file'));
    }, timeout);
    const onOk = () => {
      cleanup();
      resolve();
    };
    const onErr = () => {
      cleanup();
      reject(new Error('format not supported by this browser'));
    };
    const cleanup = () => {
      clearTimeout(t);
      el.removeEventListener(ok, onOk);
      el.removeEventListener('error', onErr);
    };
    el.addEventListener(ok, onOk);
    el.addEventListener('error', onErr);
  });
}

/** MediaRecorder output (webm) often reports Infinity until you seek past the end. */
async function resolveDuration(el: HTMLMediaElement) {
  if (Number.isFinite(el.duration) && el.duration > 0) return el.duration;
  el.currentTime = 1e7;
  await once(el, 'seeked', 8000).catch(() => undefined);
  const d = el.duration;
  el.currentTime = 0;
  return Number.isFinite(d) ? d : 0;
}

async function analyseVideo(item: MediaItem) {
  const v = document.createElement('video');
  v.preload = 'auto';
  v.muted = true;
  v.playsInline = true;
  v.src = item.url;
  await once(v, 'loadedmetadata');
  const duration = await resolveDuration(v);
  if (!duration) throw new Error('could not determine duration');
  updateMedia(item.id, {
    duration,
    width: v.videoWidth || 1920,
    height: v.videoHeight || 1080,
    status: 'ready',
    progress: 0.05,
  });

  // waveform runs in parallel with frame extraction
  const peaksJob = item.size < 400 * 1024 * 1024 ? computePeaks(item.file).catch(() => undefined) : Promise.resolve(undefined);

  const count = Math.max(6, Math.min(32, Math.round(duration / 1.2)));
  const h = 90;
  const w = Math.round((h * (v.videoWidth || 16)) / (v.videoHeight || 9));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const thumbs: { time: number; url: string }[] = [];
  for (let i = 0; i < count; i++) {
    const time = Math.min(duration - 0.05, ((i + 0.5) / count) * duration);
    v.currentTime = Math.max(0, time);
    try {
      await once(v, 'seeked', 5000);
    } catch {
      break;
    }
    ctx.drawImage(v, 0, 0, w, h);
    thumbs.push({ time, url: canvas.toDataURL('image/jpeg', 0.7) });
    if (i === 0 || i === count - 1 || i % 4 === 0) {
      updateMedia(item.id, { thumbnails: [...thumbs], poster: thumbs[Math.min(1, thumbs.length - 1)]?.url, progress: 0.05 + 0.85 * ((i + 1) / count) });
    }
  }
  const peaks = await peaksJob;
  updateMedia(item.id, { thumbnails: thumbs, peaks, progress: 1 });
  v.removeAttribute('src');
  v.load();
}

/* ───────────── audio ───────────── */

async function analyseAudio(item: MediaItem) {
  const a = document.createElement('audio');
  a.preload = 'metadata';
  a.src = item.url;
  await once(a, 'loadedmetadata');
  const duration = await resolveDuration(a);
  updateMedia(item.id, { duration, status: duration ? 'ready' : 'processing', progress: 0.3 });
  const peaks = await computePeaks(item.file).catch(() => undefined);
  const patch: Partial<MediaItem> = { peaks, progress: 1, status: 'ready' };
  if (!duration && peaks) patch.duration = peaks.length / PEAKS_PER_SEC;
  updateMedia(item.id, patch);
  if (!duration && !peaks) throw new Error('could not decode audio');
}

/** Decode at a low sample rate (cheap on memory) and bucket into max-abs peaks. */
async function computePeaks(file: File): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 8000);
  const audio = await ctx.decodeAudioData(buf);
  const per = Math.max(1, Math.floor(audio.sampleRate / PEAKS_PER_SEC));
  const n = Math.ceil(audio.length / per);
  const peaks = new Float32Array(n);
  const chans = Array.from({ length: Math.min(2, audio.numberOfChannels) }, (_, i) => audio.getChannelData(i));
  let max = 0;
  for (let i = 0; i < n; i++) {
    let m = 0;
    const end = Math.min(audio.length, (i + 1) * per);
    for (const ch of chans) {
      for (let j = i * per; j < end; j++) {
        const v = Math.abs(ch[j]);
        if (v > m) m = v;
      }
    }
    peaks[i] = m;
    if (m > max) max = m;
  }
  const norm = max > 0.01 ? 1 / max : 1;
  for (let i = 0; i < n; i++) peaks[i] = Math.min(1, Math.pow(peaks[i] * norm, 0.8));
  return peaks;
}

export function mediaById(id?: string) {
  if (!id) return undefined;
  return useEditor.getState().media.find((m) => m.id === id);
}
