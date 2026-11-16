import type { Clip, MediaItem } from '../state/types';
import { getDuration, useEditor } from '../state/store';
import { ASPECTS, clamp, fadeEnvelope } from '../lib/util';
import { renderFrame, type LayoutBox } from './render';

interface ElEntry {
  el: HTMLMediaElement;
  mediaId: string;
  gain?: GainNode;
  lastGain: number;
  seekTarget: number | null;
  pending: number | null;
}

interface AudioGraph {
  ctx: AudioContext;
  master: GainNode;
  monitor: GainNode;
  dest: MediaStreamAudioDestinationNode;
}

/** Preroll window: media elements are created a bit ahead of time and released when far away. */
const CREATE_AHEAD = 6;
const RELEASE_AFTER = 30;

class Engine {
  time = 0;
  playing = false;
  exporting = false;
  layout: LayoutBox[] = [];
  audio: AudioGraph | null = null;
  onEnded: (() => void) | null = null;
  /** canvas px per project px */
  renderScale = 0.5;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private listeners = new Set<() => void>();
  private renderListeners = new Set<() => void>();
  private els = new Map<string, ElEntry>();
  private imgs = new Map<string, HTMLImageElement>();
  private fonts = new Set<string>();
  private host: HTMLDivElement | null = null;
  private dirty = true;
  /** wall-clock anchor: time = anchorTime + (now - anchorPerf) while playing */
  private anchorPerf = 0;
  private anchorTime = 0;
  private previewScale = 0.5;
  private masterVolume = 1;

  constructor() {
    if (typeof window === 'undefined') return;
    this.host = document.createElement('div');
    this.host.setAttribute('aria-hidden', 'true');
    Object.assign(this.host.style, {
      position: 'fixed',
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      opacity: '0',
      pointerEvents: 'none',
      left: '-10px',
      top: '-10px',
    });
    document.body.appendChild(this.host);

    useEditor.subscribe((s, p) => {
      if (
        s.clips !== p.clips ||
        s.tracks !== p.tracks ||
        s.media !== p.media ||
        s.background !== p.background ||
        s.aspect !== p.aspect
      ) {
        if (s.aspect !== p.aspect) this.resizeCanvas();
        const d = getDuration();
        if (this.time > d) {
          this.time = d;
          this.emit();
        }
        this.invalidate();
      }
    });
    requestAnimationFrame(this.loop);
  }

  /* ───────── subscriptions ───────── */

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  subscribeRender = (fn: () => void) => {
    this.renderListeners.add(fn);
    return () => this.renderListeners.delete(fn);
  };
  getTime = () => this.time;
  isPlaying = () => this.playing;
  private emit() {
    this.listeners.forEach((f) => f());
  }

  invalidate = () => {
    this.dirty = true;
  };

  /* ───────── canvas ───────── */

  attachCanvas(canvas: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext('2d', { alpha: false }) : null;
    this.resizeCanvas();
  }

  get canvasEl() {
    return this.canvas;
  }

  /** Called by the preview with its on-screen width so we only render as many pixels as needed. */
  setPreviewWidth(cssWidth: number) {
    const { w } = ASPECTS[useEditor.getState().aspect];
    this.previewScale = clamp((cssWidth * (window.devicePixelRatio || 1)) / w, 0.2, 1);
    if (!this.exporting) {
      this.renderScale = this.previewScale;
      this.resizeCanvas();
    }
  }

  private resizeCanvas() {
    if (!this.canvas) return;
    const { w, h } = ASPECTS[useEditor.getState().aspect];
    const cw = Math.max(2, Math.round((w * this.renderScale) / 2) * 2);
    const ch = Math.max(2, Math.round((h * this.renderScale) / 2) * 2);
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    this.dirty = true;
  }

  /* ───────── transport ───────── */

  seek(t: number) {
    this.time = clamp(t, 0, Math.max(0, getDuration()));
    this.anchorPerf = performance.now();
    this.anchorTime = this.time;
    this.dirty = true;
    this.emit();
  }

  play() {
    const d = getDuration();
    if (d <= 0) return;
    this.ensureAudio();
    if (this.time >= d - 1 / 60) this.time = 0;
    this.playing = true;
    this.anchorPerf = performance.now();
    this.anchorTime = this.time;
    this.dirty = true;
    this.emit();
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    for (const e of this.els.values()) if (!e.el.paused) e.el.pause();
    this.dirty = true;
    this.emit();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  setMasterVolume(v: number) {
    this.masterVolume = v;
    if (this.audio && !this.exporting) this.audio.monitor.gain.value = v;
  }

  /* ───────── audio ───────── */

  ensureAudio() {
    if (!this.audio) {
      try {
        const ctx = new AudioContext({ latencyHint: 'interactive' });
        const master = ctx.createGain();
        const monitor = ctx.createGain();
        const dest = ctx.createMediaStreamDestination();
        master.connect(monitor);
        monitor.connect(ctx.destination);
        master.connect(dest);
        monitor.gain.value = this.masterVolume;
        this.audio = { ctx, master, monitor, dest };
        for (const e of this.els.values()) this.connect(e);
      } catch {
        return;
      }
    }
    if (this.audio.ctx.state === 'suspended') void this.audio.ctx.resume();
  }

  private connect(e: ElEntry) {
    if (!this.audio || e.gain) return;
    try {
      const src = this.audio.ctx.createMediaElementSource(e.el);
      const g = this.audio.ctx.createGain();
      g.gain.value = 0;
      src.connect(g);
      g.connect(this.audio.master);
      e.gain = g;
      e.el.volume = 1;
    } catch {
      /* element already routed */
    }
  }

  private setGain(e: ElEntry, v: number) {
    if (Math.abs(e.lastGain - v) < 0.001) return;
    e.lastGain = v;
    if (e.gain && this.audio) {
      e.gain.gain.setTargetAtTime(v, this.audio.ctx.currentTime, 0.012);
    } else {
      e.el.volume = clamp(v, 0, 1);
    }
  }

  /* ───────── media elements ───────── */

  private entryFor(clip: Clip, m: MediaItem): ElEntry {
    let e = this.els.get(clip.id);
    if (e && e.mediaId !== m.id) {
      this.release(clip.id);
      e = undefined;
    }
    if (!e) {
      const el = document.createElement(m.kind === 'audio' ? 'audio' : 'video') as HTMLMediaElement;
      el.preload = 'auto';
      el.crossOrigin = 'anonymous';
      if (el instanceof HTMLVideoElement) el.playsInline = true;
      el.src = m.url;
      el.currentTime = clip.trimStart;
      const entry: ElEntry = { el, mediaId: m.id, lastGain: -1, seekTarget: clip.trimStart, pending: null };
      el.addEventListener('seeked', () => {
        if (entry.pending !== null) {
          const p = entry.pending;
          entry.pending = null;
          entry.seekTarget = p;
          el.currentTime = p;
        }
        this.dirty = true;
      });
      el.addEventListener('loadeddata', this.invalidate);
      el.addEventListener('canplay', this.invalidate);
      this.host?.appendChild(el);
      e = entry;
      this.els.set(clip.id, e);
      this.connect(e);
    }
    return e;
  }

  private release(clipId: string) {
    const e = this.els.get(clipId);
    if (!e) return;
    e.el.pause();
    e.gain?.disconnect();
    e.el.removeAttribute('src');
    e.el.load();
    e.el.remove();
    this.els.delete(clipId);
  }

  private seekEl(e: ElEntry, t: number) {
    if (e.seekTarget !== null && Math.abs(e.seekTarget - t) < 0.001 && !e.el.seeking) return;
    if (e.el.seeking) {
      e.pending = t;
      return;
    }
    e.seekTarget = t;
    e.el.currentTime = t;
  }

  getVideo = (clip: Clip) => {
    const e = this.els.get(clip.id);
    return e?.el instanceof HTMLVideoElement ? e.el : undefined;
  };

  getImage = (m: MediaItem) => {
    let img = this.imgs.get(m.id);
    if (!img) {
      img = new Image();
      img.onload = this.invalidate;
      img.src = m.url;
      this.imgs.set(m.id, img);
    }
    return img;
  };

  ensureFont = (font: string) => {
    if (this.fonts.has(font)) return;
    this.fonts.add(font);
    if (!document.fonts.check(font)) {
      document.fonts.load(font).then(this.invalidate, () => undefined);
    }
  };

  /** Keep every <video>/<audio> element aligned with the timeline clock. */
  private sync() {
    const s = useEditor.getState();
    const media = new Map(s.media.map((m) => [m.id, m]));
    const tracks = new Map(s.tracks.map((t) => [t.id, t]));
    const t = this.time;
    const seen = new Set<string>();

    for (const clip of s.clips) {
      if (clip.type !== 'video' && clip.type !== 'audio') continue;
      const m = clip.mediaId ? media.get(clip.mediaId) : undefined;
      if (!m || m.status === 'error') continue;
      const local = t - clip.start;
      const near = local > -CREATE_AHEAD && local < clip.duration + 1;
      if (!near && !this.els.has(clip.id)) continue;
      if (!near && (local < -RELEASE_AFTER || local > clip.duration + RELEASE_AFTER)) continue; // released below
      seen.add(clip.id);
      const e = this.entryFor(clip, m);
      const el = e.el;
      const active = local >= 0 && local < clip.duration;
      const target = clip.trimStart + clamp(local, 0, clip.duration) * clip.speed;
      const track = tracks.get(clip.trackId);

      if (active) {
        if (el.playbackRate !== clip.speed) el.playbackRate = clip.speed;
        if (this.playing) {
          if (el.paused) {
            if (Math.abs(el.currentTime - target) > 0.08) this.seekEl(e, target);
            el.play().catch(() => undefined);
          } else if (!el.seeking && Math.abs(el.currentTime - target) > 0.3) {
            this.seekEl(e, target);
          }
        } else {
          if (!el.paused) el.pause();
          this.seekEl(e, target);
        }
      } else {
        if (!el.paused) el.pause();
        if (local < 0) this.seekEl(e, clip.trimStart);
      }

      const silent = clip.muted || track?.muted || (clip.type === 'video' && track?.hidden);
      const g = active && !silent ? clip.volume * fadeEnvelope(clip, local) : 0;
      this.setGain(e, g);
    }

    for (const id of [...this.els.keys()]) if (!seen.has(id)) this.release(id);
  }

  private draw() {
    if (!this.ctx || !this.canvas) return;
    const s = useEditor.getState();
    const { w, h } = ASPECTS[s.aspect];
    this.layout = renderFrame({
      ctx: this.ctx,
      W: w,
      H: h,
      rs: this.canvas.width / w,
      time: this.time,
      background: s.background,
      tracks: s.tracks,
      clips: s.clips,
      media: new Map(s.media.map((m) => [m.id, m])),
      getVideo: this.getVideo,
      getImage: this.getImage,
      ensureFont: this.ensureFont,
    });
    this.renderListeners.forEach((f) => f());
  }

  private loop = () => {
    requestAnimationFrame(this.loop);
    this.tick();
  };

  /**
   * Background tabs throttle rAF to ~1fps, which would starve an export. A worker-driven
   * interval keeps frames flowing while rendering even when the tab isn't visible.
   */
  private ticker: Worker | null = null;
  private startTicker(fps: number) {
    if (!this.ticker) {
      const src = 'let id;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';
      this.ticker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      this.ticker.onmessage = () => this.tick();
    }
    this.ticker.postMessage(1000 / fps);
  }
  private stopTicker() {
    this.ticker?.postMessage(0);
  }

  private tick() {
    if (this.playing) {
      const d = getDuration();
      this.time = this.anchorTime + Math.max(0, (performance.now() - this.anchorPerf) / 1000);
      if (this.time >= d) {
        this.time = d;
        this.sync();
        this.draw();
        this.pause();
        const cb = this.onEnded;
        this.onEnded = null;
        cb?.();
        return;
      }
      this.dirty = true;
      this.emit();
    }
    if (this.dirty) {
      this.dirty = false;
      this.sync();
      this.draw();
    }
  }

  /** Force a sync+draw now (used by export before recording starts). */
  flush() {
    this.sync();
    this.draw();
  }

  /** Resolve once all media under the playhead have a decoded frame (or after a timeout). */
  async waitReady(timeout = 4000) {
    const startAt = performance.now();
    while (performance.now() - startAt < timeout) {
      this.flush();
      const s = useEditor.getState();
      const t = this.time;
      const busy = s.clips.some((c) => {
        if (c.type !== 'video' && c.type !== 'audio') return false;
        if (t < c.start || t >= c.start + c.duration) return false;
        const e = this.els.get(c.id);
        return !e || e.el.seeking || e.el.readyState < 3;
      });
      if (!busy) return;
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  beginExport(shortSide: number, monitor: boolean, fps: number) {
    const { w, h } = ASPECTS[useEditor.getState().aspect];
    this.exporting = true;
    this.startTicker(fps);
    this.renderScale = shortSide / Math.min(w, h);
    this.resizeCanvas();
    if (this.audio) this.audio.monitor.gain.value = monitor ? this.masterVolume : 0;
  }

  endExport() {
    this.exporting = false;
    this.stopTicker();
    this.renderScale = this.previewScale;
    this.resizeCanvas();
    if (this.audio) this.audio.monitor.gain.value = this.masterVolume;
    this.dirty = true;
  }
}

export const engine = new Engine();

// The engine owns media elements, an AudioContext and a rAF loop — reload instead of hot-swapping it.
if (import.meta.hot) import.meta.hot.dispose(() => window.location.reload());
