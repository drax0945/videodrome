import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftToLine,
  Copy,
  Eye,
  EyeOff,
  Magnet,
  Maximize2,
  Redo2,
  Scissors,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { Clip, Track } from '../../state/types';
import {
  addClipFromMedia,
  addTextClip,
  cleanupTracks,
  commit,
  deleteClip,
  duplicateClip,
  moveClipToNewTrack,
  placeClip,
  redo,
  selectClip,
  splitAt,
  toast,
  undo,
  updateClip,
  updateTrack,
  useEditor,
} from '../../state/store';
import {
  clipsOnTrack,
  findFreeStart,
  neighbourBounds,
  projectDuration,
  snapDelta,
  snapTargets,
  sourceLength,
  trackAccepts,
  trackLabels,
} from '../../state/timeline';
import { engine } from '../../engine/engine';
import { usePlayhead, usePlaying } from '../../engine/hooks';
import { MIN_CLIP, clamp } from '../../lib/util';
import { IconButton } from '../ui/controls';
import { ClipItem, type ClipDragMode } from './ClipItem';
import { DND, libDrag } from '../dnd';

export const HDR_W = 136;
const ROW_H = { visual: 66, audio: 52 };
export const PPS_MIN = 4;
export const PPS_MAX = 480;

const ppsToSlider = (p: number) => Math.log(p / PPS_MIN) / Math.log(PPS_MAX / PPS_MIN);
const sliderToPps = (v: number) => PPS_MIN * Math.pow(PPS_MAX / PPS_MIN, v);

export function zoomBy(factor: number) {
  const s = useEditor.getState();
  useEditor.setState({ pps: clamp(s.pps * factor, PPS_MIN, PPS_MAX) });
}

export function Timeline() {
  const tracks = useEditor((s) => s.tracks);
  const clips = useEditor((s) => s.clips);
  const media = useEditor((s) => s.media);
  const pps = useEditor((s) => s.pps);
  const snap = useEditor((s) => s.snap);
  const selectedId = useEditor((s) => s.selectedId);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ left: 0, width: 900 });
  const [snapAt, setSnapAt] = useState<number | null>(null);
  const [hot, setHot] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ trackId: string; start: number; dur: number } | null>(null);

  const mediaMap = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);
  const labels = useMemo(() => trackLabels(tracks), [tracks]);
  const duration = projectDuration(clips);
  const seconds = Math.max(duration + 30, (view.width - HDR_W) / pps);
  const contentWidth = HDR_W + seconds * pps;

  /* keep the ruler in sync with scroll/size */
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setView({ left: el.scrollLeft, width: el.clientWidth });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
    };
  }, []);

  /* ⌘/ctrl + wheel zoom anchored at the cursor */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const cur = useEditor.getState().pps;
      const t = (el.scrollLeft + mx - HDR_W) / cur;
      const next = clamp(cur * Math.exp(-e.deltaY * 0.004), PPS_MIN, PPS_MAX);
      useEditor.setState({ pps: next });
      requestAnimationFrame(() => {
        el.scrollLeft = Math.max(0, t * next + HDR_W - mx);
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const timeAt = useCallback(
    (clientX: number) => {
      const el = scroller.current!;
      const rect = el.getBoundingClientRect();
      return Math.max(0, (clientX - rect.left + el.scrollLeft - HDR_W) / useEditor.getState().pps);
    },
    [],
  );

  /* scrubbing from ruler / empty lanes / playhead */
  const startScrub = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      engine.pause();
      engine.seek(timeAt(e.clientX));
      const move = (ev: PointerEvent) => engine.seek(timeAt(ev.clientX));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing');
      };
      document.body.classList.add('resizing');
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [timeAt],
  );

  /* clip move / trim */
  const onClipPointerDown = useCallback(
    (e: React.PointerEvent, clip: Clip, mode: ClipDragMode) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      selectClip(clip.id);
      const st = useEditor.getState();
      const m = clip.mediaId ? st.media.find((x) => x.id === clip.mediaId) : undefined;
      const origin = { ...clip };
      const x0 = e.clientX;
      const y0 = e.clientY;
      const targets = snapTargets(st.clips, clip.id, engine.time);
      const thr = 8 / st.pps;
      const { prevEnd, nextStart } = neighbourBounds(st.clips, clip);
      const srcLen = sourceLength(clip, m);
      let moved = false;
      let zone: 'top' | 'bottom' | null = null;

      const doSnap = (vals: number[], ev: PointerEvent) =>
        useEditor.getState().snap && !ev.altKey ? snapDelta(vals, targets, thr) : null;

      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - x0;
        if (!moved) {
          if (Math.abs(dx) < 3 && Math.abs(ev.clientY - y0) < 4) return;
          moved = true;
          commit();
          document.body.classList.add(mode === 'move' ? 'grabbing' : 'resizing');
          if (mode === 'move') document.body.classList.add('dragging-any');
        }
        const dt = dx / st.pps;

        if (mode === 'move') {
          let start = Math.max(0, origin.start + dt);
          let snapPt: number | null = null;
          const s = doSnap([start, start + origin.duration], ev);
          if (s) {
            start = Math.max(0, start + s.delta);
            snapPt = s.at;
          }
          const cur = useEditor.getState();
          const under = document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null;
          const z = under?.closest('[data-zone]')?.getAttribute('data-zone') as 'top' | 'bottom' | null;
          let trackId = cur.clips.find((c) => c.id === clip.id)?.trackId ?? origin.trackId;
          zone = z ?? null;
          if (!zone) {
            const tid = under?.closest('[data-track-id]')?.getAttribute('data-track-id');
            const t = tid ? cur.tracks.find((x) => x.id === tid) : undefined;
            if (t && trackAccepts(t, clip)) trackId = t.id;
          }
          setHot(zone ? `zone-${zone}` : trackId);
          const free = findFreeStart(clipsOnTrack(cur.clips, trackId, clip.id), start, origin.duration);
          if (Math.abs(free - start) > 1e-6) snapPt = null;
          placeClip(clip.id, free, trackId);
          setSnapAt(snapPt);
        } else if (mode === 'trim-l') {
          let ns = origin.start + dt;
          const s = doSnap([ns], ev);
          if (s) ns += s.delta;
          const minStart = Math.max(prevEnd, 0, Number.isFinite(srcLen) ? origin.start - origin.trimStart / origin.speed : 0);
          ns = clamp(ns, minStart, origin.start + origin.duration - MIN_CLIP);
          const delta = ns - origin.start;
          setSnapAt(s && Math.abs(ns - (origin.start + dt + s.delta)) < 1e-6 ? s.at : null);
          updateClip(
            clip.id,
            {
              start: ns,
              duration: origin.duration - delta,
              trimStart: Number.isFinite(srcLen) ? origin.trimStart + delta * origin.speed : origin.trimStart,
            },
            false,
          );
        } else {
          let ne = origin.start + origin.duration + dt;
          const s = doSnap([ne], ev);
          if (s) ne += s.delta;
          const srcMax = Number.isFinite(srcLen) ? origin.start + (srcLen - origin.trimStart) / origin.speed : Infinity;
          const clamped = clamp(ne, origin.start + MIN_CLIP, Math.min(nextStart, srcMax));
          setSnapAt(s && Math.abs(clamped - ne) < 1e-6 ? s.at : null);
          updateClip(clip.id, { duration: clamped - origin.start }, false);
        }
      };

      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        document.body.classList.remove('grabbing', 'resizing', 'dragging-any');
        if (moved && mode === 'move' && zone) {
          const c = useEditor.getState().clips.find((x) => x.id === clip.id);
          moveClipToNewTrack(clip.id, zone, c?.start ?? origin.start);
        }
        if (moved) cleanupTracks();
        setHot(null);
        setSnapAt(null);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [],
  );

  /* library → timeline drag & drop */
  const libDuration = () => {
    if (!libDrag) return 3;
    if (libDrag.text) return 4;
    const m = libDrag.media ? useEditor.getState().media.find((x) => x.id === libDrag!.media) : undefined;
    return m ? (m.kind === 'image' ? 5 : m.duration || 3) : 3;
  };

  const onLaneDragOver = (e: React.DragEvent, track: Track) => {
    if (!libDrag || libDrag.kind !== track.kind) {
      setGhost(null);
      return;
    }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const dur = libDuration();
    const desired = timeAt(e.clientX);
    const start = findFreeStart(clipsOnTrack(useEditor.getState().clips, track.id), desired, dur);
    setGhost((g) =>
      g && g.trackId === track.id && Math.abs(g.start - start) < 1e-3 ? g : { trackId: track.id, start, dur },
    );
    setHot(track.id);
  };

  const dropPayload = (e: React.DragEvent, opts: { trackId?: string; newTrack?: 'top' | 'bottom' }) => {
    e.preventDefault();
    const mediaId = e.dataTransfer.getData(DND.media);
    const textId = e.dataTransfer.getData(DND.text);
    const start = timeAt(e.clientX);
    if (mediaId) addClipFromMedia(mediaId, { ...opts, start }, engine.time);
    else if (textId) addTextClip(textId, { ...opts, start }, engine.time);
    setGhost(null);
    setHot(null);
  };

  const onZoneDragOver = (e: React.DragEvent, zone: 'top' | 'bottom') => {
    if (!libDrag) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setGhost(null);
    setHot(`zone-${zone}`);
  };

  const clearDrag = (e: React.DragEvent) => {
    const rel = e.relatedTarget as Node | null;
    if (!rel || !(e.currentTarget as Node).contains(rel)) {
      setGhost(null);
      setHot(null);
    }
  };

  /* toolbar actions */
  const sel = clips.find((c) => c.id === selectedId);
  const doSplit = () => {
    if (!splitAt(engine.time)) toast('Move the playhead over a clip to split it');
  };
  const fit = () => {
    const el = scroller.current;
    if (!el) return;
    // read the live clip list: this can run right after an edit, before this component re-renders
    const d = Math.max(projectDuration(useEditor.getState().clips), 5);
    useEditor.setState({ pps: clamp((el.clientWidth - HDR_W - 60) / d, PPS_MIN, PPS_MAX) });
    el.scrollLeft = 0;
  };

  useEffect(() => {
    window.addEventListener('vd:fit', fit);
    return () => window.removeEventListener('vd:fit', fit);
  });

  const zoneLabel = libDrag?.kind === 'audio' ? 'AUDIO' : 'OVERLAY';

  return (
    <section className="timeline" style={{ ['--hdr-w' as string]: `${HDR_W}px` }}>
      <div className="tl-toolbar">
        <IconButton tip="Split  S" onClick={doSplit} disabled={!clips.length}>
          <Scissors size={16} />
        </IconButton>
        <IconButton tip="Delete  ⌫" onClick={() => sel && deleteClip(sel.id)} disabled={!sel}>
          <Trash2 size={16} />
        </IconButton>
        <IconButton tip="Ripple delete  ⇧⌫" onClick={() => sel && deleteClip(sel.id, true)} disabled={!sel}>
          <ArrowLeftToLine size={16} />
        </IconButton>
        <IconButton tip="Duplicate  ⌘D" onClick={() => sel && duplicateClip(sel.id)} disabled={!sel}>
          <Copy size={15} />
        </IconButton>
        <span className="sep" />
        <IconButton tip="Undo  ⌘Z" onClick={undo} disabled={!canUndo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton tip="Redo  ⇧⌘Z" onClick={redo} disabled={!canRedo}>
          <Redo2 size={16} />
        </IconButton>
        <span className="sep" />
        <IconButton tip={snap ? 'Snapping on (hold ⌥ to bypass)' : 'Snapping off'} on={snap} onClick={() => useEditor.setState({ snap: !snap })}>
          <Magnet size={15} />
        </IconButton>
        <div className="grow" />
        <span className="label" style={{ marginRight: 8 }}>
          {clips.length} CLIPS · {tracks.length} TRACKS
        </span>
        <div className="zoom">
          <IconButton tip="Zoom out  −" onClick={() => zoomBy(1 / 1.4)}>
            <ZoomOut size={15} />
          </IconButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.001}
            value={ppsToSlider(pps)}
            style={{ ['--p' as string]: `${ppsToSlider(pps) * 100}%` }}
            onChange={(e) => useEditor.setState({ pps: sliderToPps(parseFloat(e.target.value)) })}
            aria-label="Timeline zoom"
          />
          <IconButton tip="Zoom in  +" onClick={() => zoomBy(1.4)}>
            <ZoomIn size={15} />
          </IconButton>
          <IconButton tip="Zoom to fit  ⇧Z" onClick={fit}>
            <Maximize2 size={14} />
          </IconButton>
        </div>
      </div>

      <div className="tl-scroll" ref={scroller}>
        <div className="tl-content" style={{ width: contentWidth }}>
          <div className="tl-ruler-row">
            <div className="tl-corner">
              <span className="label">TRACKS</span>
            </div>
            <div className="tl-ruler" onPointerDown={startScrub}>
              <Ruler pps={pps} left={view.left} width={Math.max(0, view.width - HDR_W)} duration={duration} />
            </div>
          </div>

          <div
            className={`tl-zone ${hot === 'zone-top' ? 'hot' : ''}`}
            data-zone="top"
            onDragOver={(e) => onZoneDragOver(e, 'top')}
            onDragLeave={clearDrag}
            onDrop={(e) => dropPayload(e, { newTrack: 'top' })}
          >
            <div className="tl-hdr" />
            <div className="lane">+ NEW {zoneLabel} TRACK</div>
          </div>

          {tracks.map((track) => {
            const h = ROW_H[track.kind];
            const trackClips = clips.filter((c) => c.trackId === track.id);
            return (
              <div
                key={track.id}
                className={`tl-row ${track.kind} ${track.main ? 'main' : ''} ${hot === track.id ? 'hot' : ''}`}
                style={{ height: h }}
                data-track-id={track.id}
              >
                <div className="tl-hdr">
                  <span className="tname" style={{ color: track.kind === 'audio' ? 'var(--c-audio)' : 'var(--c-video)' }}>
                    {labels.get(track.id)}
                  </span>
                  <span className="tkind">{track.kind === 'audio' ? 'AUDIO' : track.main ? 'MAIN' : 'OVERLAY'}</span>
                  {track.kind === 'visual' && (
                    <IconButton sm tip={track.hidden ? 'Show track' : 'Hide track'} onClick={() => updateTrack(track.id, { hidden: !track.hidden })}>
                      {track.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                    </IconButton>
                  )}
                  <IconButton sm tip={track.muted ? 'Unmute track' : 'Mute track'} onClick={() => updateTrack(track.id, { muted: !track.muted })}>
                    {track.muted ? <VolumeX size={13} color="var(--red)" /> : <Volume2 size={13} />}
                  </IconButton>
                </div>
                <div
                  className="lane"
                  onPointerDown={(e) => {
                    selectClip(null);
                    startScrub(e);
                  }}
                  onDragOver={(e) => onLaneDragOver(e, track)}
                  onDragLeave={clearDrag}
                  onDrop={(e) => {
                    if (libDrag && libDrag.kind === track.kind) dropPayload(e, { trackId: track.id });
                  }}
                >
                  {trackClips.map((c) => (
                    <ClipItem
                      key={c.id}
                      clip={c}
                      media={c.mediaId ? mediaMap.get(c.mediaId) : undefined}
                      pps={pps}
                      height={h}
                      selected={c.id === selectedId}
                      dimmed={track.hidden && track.kind === 'visual'}
                      onPointerDown={onClipPointerDown}
                    />
                  ))}
                  {ghost && ghost.trackId === track.id && (
                    <div className="drop-ghost" style={{ left: ghost.start * pps, width: ghost.dur * pps }} />
                  )}
                  {track.main && trackClips.length === 0 && (
                    <div className="lane-hint">{'DROP MEDIA HERE  //  OR HIT + IN THE LIBRARY'}</div>
                  )}
                </div>
              </div>
            );
          })}

          <div
            className={`tl-zone ${hot === 'zone-bottom' ? 'hot' : ''}`}
            data-zone="bottom"
            onDragOver={(e) => onZoneDragOver(e, 'bottom')}
            onDragLeave={clearDrag}
            onDrop={(e) => dropPayload(e, { newTrack: 'bottom' })}
          >
            <div className="tl-hdr" />
            <div className="lane">+ NEW {libDrag ? zoneLabel : 'AUDIO'} TRACK</div>
          </div>

          {snapAt !== null && snapAt * pps >= view.left && (
            <div className="snap-line" style={{ left: HDR_W + snapAt * pps }} />
          )}
          <Playhead pps={pps} scroller={scroller} scrollLeft={view.left} onScrub={startScrub} />
        </div>
      </div>
    </section>
  );
}

/* ───────────────────────── ruler ───────────────────────── */

const STEPS = [1 / 30, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

function fmtRuler(t: number, step: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  if (step < 1) return `${m}:${s.toFixed(step < 0.1 ? 2 : 1).padStart(step < 0.1 ? 5 : 4, '0')}`;
  return `${m}:${String(Math.round(s)).padStart(2, '0')}`;
}

function Ruler({ pps, left, width, duration }: { pps: number; left: number; width: number; duration: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c || width <= 0) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(width * dpr);
    c.height = Math.round(30 * dpr);
    c.style.width = `${width}px`;
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, 30);

    const t0 = left / pps;
    const t1 = (left + width) / pps;
    // project region shading
    const endX = duration * pps - left;
    if (endX > 0) {
      ctx.fillStyle = 'rgba(200,255,46,0.035)';
      ctx.fillRect(0, 0, Math.min(width, endX), 30);
      if (endX < width) {
        ctx.fillStyle = 'rgba(200,255,46,0.5)';
        ctx.fillRect(endX - 0.5, 18, 1, 12);
      }
    }

    const major = STEPS.find((s) => s * pps >= 76) ?? 600;
    const minorDiv = major >= 60 ? 6 : major === 15 || major === 0.25 ? 5 : major < 0.1 ? 1 : 5;
    const minor = major / minorDiv;
    ctx.font = '500 9.5px "JetBrains Mono", monospace';
    ctx.textBaseline = 'top';
    const first = Math.floor(t0 / minor) * minor;
    for (let t = first; t <= t1 + minor; t += minor) {
      const x = Math.round(t * pps - left) + 0.5;
      const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
      ctx.fillStyle = isMajor ? '#3a3f47' : '#24282e';
      ctx.fillRect(x, isMajor ? 17 : 23, 1, isMajor ? 13 : 7);
      if (isMajor && t >= -1e-6) {
        ctx.fillStyle = '#6b727d';
        ctx.fillText(fmtRuler(Math.max(0, t), major), x + 4, 6);
      }
    }
  }, [pps, left, width, duration]);
  return <canvas ref={ref} />;
}

/* ───────────────────────── playhead ───────────────────────── */

function Playhead({
  pps,
  scroller,
  scrollLeft,
  onScrub,
}: {
  pps: number;
  scroller: React.RefObject<HTMLDivElement | null>;
  scrollLeft: number;
  onScrub: (e: React.PointerEvent) => void;
}) {
  const t = usePlayhead();
  const playing = usePlaying();
  const x = HDR_W + t * pps;

  useEffect(() => {
    const el = scroller.current;
    if (!el || !playing) return;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + HDR_W) {
      el.scrollLeft = Math.max(0, x - HDR_W - 40);
    }
  }, [x, playing, scroller]);

  return (
    <div className="playhead" style={{ left: x, visibility: x < scrollLeft + HDR_W - 1 ? 'hidden' : 'visible' }}>
      <div className="head" onPointerDown={onScrub} />
      <div className="line" />
    </div>
  );
}

