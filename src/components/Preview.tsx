import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Grid3x3,
  Maximize,
  Pause,
  Play,
  RotateCw,
  SkipBack,
  SkipForward,
  StepBack,
  StepForward,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { commit, selectClip, setAspect, updateClip, useEditor } from '../state/store';
import type { AspectKey } from '../state/types';
import { engine } from '../engine/engine';
import { hitTest } from '../engine/render';
import { usePlayhead, usePlaying, useRenderTick } from '../engine/hooks';
import { ASPECTS, FPS, clamp, timecode } from '../lib/util';
import { projectDuration } from '../state/timeline';
import { IconButton, Select } from './ui/controls';

type Drag =
  | { mode: 'move'; id: string; px: number; py: number; x: number; y: number; moved: boolean }
  | { mode: 'scale'; id: string; d0: number; scale: number; cx: number; cy: number; moved: boolean }
  | { mode: 'rotate'; id: string; a0: number; rot: number; cx: number; cy: number; moved: boolean };

export function Preview() {
  const aspect = useEditor((s) => s.aspect);
  const guides = useEditor((s) => s.guides);
  const hasClips = useEditor((s) => s.clips.length > 0);
  const viewport = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [snapLines, setSnapLines] = useState<{ v: boolean; h: boolean }>({ v: false, h: false });
  const drag = useRef<Drag | null>(null);
  const { w: W, h: H } = ASPECTS[aspect];

  useLayoutEffect(() => {
    engine.attachCanvas(canvas.current);
    return () => engine.attachCanvas(null);
  }, []);

  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const measure = () => {
      const cs = getComputedStyle(el);
      const aw = el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ah = el.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      const ar = W / H;
      let w = aw;
      let h = w / ar;
      if (h > ah) {
        h = ah;
        w = h * ar;
      }
      setBox({ w: Math.max(0, Math.floor(w)), h: Math.max(0, Math.floor(h)) });
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    measure();
    return () => ro.disconnect();
  }, [W, H]);

  useEffect(() => {
    if (box.w) engine.setPreviewWidth(box.w);
  }, [box.w, aspect]);

  const toProject = (e: { clientX: number; clientY: number }) => {
    const r = screen.current!.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || document.fullscreenElement) return;
    const p = toProject(e);
    const handle = (e.target as HTMLElement).dataset.handle;
    const st = useEditor.getState();
    const sel = st.clips.find((c) => c.id === st.selectedId);
    const selBox = sel && engine.layout.find((b) => b.clipId === sel.id);

    if (handle && sel && selBox) {
      if (handle === 'rot') {
        drag.current = {
          mode: 'rotate',
          id: sel.id,
          a0: Math.atan2(p.y - selBox.cy, p.x - selBox.cx),
          rot: sel.rotation,
          cx: selBox.cx,
          cy: selBox.cy,
          moved: false,
        };
      } else {
        drag.current = {
          mode: 'scale',
          id: sel.id,
          d0: Math.max(1, Math.hypot(p.x - selBox.cx, p.y - selBox.cy)),
          scale: sel.scale,
          cx: selBox.cx,
          cy: selBox.cy,
          moved: false,
        };
      }
    } else {
      const hit = hitTest(engine.layout, p.x, p.y);
      selectClip(hit);
      if (!hit) return;
      const c = st.clips.find((x) => x.id === hit)!;
      drag.current = { mode: 'move', id: hit, px: p.x, py: p.y, x: c.x, y: c.y, moved: false };
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const p = toProject(e);
    if (!d.moved) {
      commit();
      d.moved = true;
    }
    if (d.mode === 'move') {
      let nx = d.x + (p.x - d.px) / W;
      let ny = d.y + (p.y - d.py) / H;
      const thr = 10 * (W / Math.max(1, box.w));
      const b = engine.layout.find((x) => x.clipId === d.id);
      let v = false;
      let h = false;
      if (!e.shiftKey) {
        if (Math.abs(nx * W - W / 2) < thr) {
          nx = 0.5;
          v = true;
        } else if (b && b.rotation === 0) {
          if (Math.abs(nx * W - b.w / 2) < thr) nx = b.w / 2 / W;
          else if (Math.abs(nx * W + b.w / 2 - W) < thr) nx = (W - b.w / 2) / W;
        }
        if (Math.abs(ny * H - H / 2) < thr) {
          ny = 0.5;
          h = true;
        } else if (b && b.rotation === 0) {
          if (Math.abs(ny * H - b.h / 2) < thr) ny = b.h / 2 / H;
          else if (Math.abs(ny * H + b.h / 2 - H) < thr) ny = (H - b.h / 2) / H;
        }
      }
      setSnapLines((s) => (s.v === v && s.h === h ? s : { v, h }));
      updateClip(d.id, { x: nx, y: ny }, false);
    } else if (d.mode === 'scale') {
      const dist = Math.hypot(p.x - d.cx, p.y - d.cy);
      updateClip(d.id, { scale: clamp((d.scale * dist) / d.d0, 0.05, 12) }, false);
    } else {
      const a = Math.atan2(p.y - d.cy, p.x - d.cx);
      let rot = d.rot + ((a - d.a0) * 180) / Math.PI;
      rot = ((((rot + 180) % 360) + 360) % 360) - 180;
      if (e.shiftKey) rot = Math.round(rot / 15) * 15;
      else {
        const near = Math.round(rot / 90) * 90;
        if (Math.abs(rot - near) < 4) rot = near;
      }
      updateClip(d.id, { rotation: Math.round(rot * 10) / 10 }, false);
    }
  };

  const onPointerUp = () => {
    drag.current = null;
    setSnapLines({ v: false, h: false });
  };

  const onDoubleClick = () => {
    const st = useEditor.getState();
    const sel = st.clips.find((c) => c.id === st.selectedId);
    if (sel?.type === 'text') window.dispatchEvent(new CustomEvent('vd:focus-text'));
  };

  return (
    <section className="stage">
      <div className="stage-head">
        <div className="hud-left">
          <span className="hud-tag">
            <span className="dot" />
            <b>PGM</b>
          </span>
          <span className="hud-sep" />
          <span className="hud-tag">PROGRAM MONITOR</span>
          <span className="hud-sep" />
          <span className="hud-tag">
            {W}×{H}
          </span>
        </div>
        <div className="hud-right">
          <Select<AspectKey>
            mono
            value={aspect}
            onChange={setAspect}
            options={(Object.keys(ASPECTS) as AspectKey[]).map((k) => ({ value: k, label: `${k}  ${ASPECTS[k].label}` }))}
          />
          <IconButton tip="Safe areas & thirds" on={guides} onClick={() => useEditor.setState({ guides: !guides })}>
            <Grid3x3 size={16} />
          </IconButton>
          <IconButton tip="Fullscreen" onClick={() => screen.current?.requestFullscreen?.()}>
            <Maximize size={15} />
          </IconButton>
        </div>
      </div>

      <div className="viewport" ref={viewport}>
        <div
          className="screen"
          ref={screen}
          style={{ width: box.w, height: box.h }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={onDoubleClick}
        >
          <canvas ref={canvas} />
          {guides && (
            <div className="guides">
              <div className="safe" style={{ inset: '5%' }} />
              <div className="safe" style={{ inset: '10%', borderColor: 'rgba(200,255,46,.3)' }} />
              <div className="third-v" style={{ left: '33.333%' }} />
              <div className="third-v" style={{ left: '66.666%' }} />
              <div className="third-h" style={{ top: '33.333%' }} />
              <div className="third-h" style={{ top: '66.666%' }} />
              <div className="cross" />
            </div>
          )}
          {snapLines.v && <div className="snap-guide" style={{ left: '50%', top: 0, bottom: 0, width: 1 }} />}
          {snapLines.h && <div className="snap-guide" style={{ top: '50%', left: 0, right: 0, height: 1 }} />}
          <TransformOverlay scale={box.w / W} />
          {!hasClips && (
            <div className="screen-empty">
              <div className="noise" />
              <div className="glyph">▚▚▚ ░░ ▞▞▞</div>
              <div className="title">NO SIGNAL</div>
              <div className="label">Import media or add text to begin</div>
            </div>
          )}
          <span className="bracket tl" />
          <span className="bracket tr" />
          <span className="bracket bl" />
          <span className="bracket br" />
        </div>
      </div>

      <Transport />
    </section>
  );
}

function TransformOverlay({ scale }: { scale: number }) {
  useRenderTick();
  const clip = useEditor((s) => s.clips.find((c) => c.id === s.selectedId));
  const box = clip ? engine.layout.find((b) => b.clipId === clip.id) : undefined;
  if (!clip || !box || clip.type === 'audio' || !scale) return null;
  const w = box.w * scale;
  const h = box.h * scale;
  return (
    <div
      className="xf"
      style={{
        left: box.cx * scale - w / 2,
        top: box.cy * scale - h / 2,
        width: w,
        height: h,
        transform: `rotate(${box.rotation}deg)`,
      }}
    >
      <span className="xf-label">
        {clip.type.toUpperCase()} · {Math.round(clip.scale * 100)}%{clip.rotation ? ` · ${clip.rotation}°` : ''}
      </span>
      <span className="h tl" data-handle="tl" />
      <span className="h tr" data-handle="tr" />
      <span className="h bl" data-handle="bl" />
      <span className="h br" data-handle="br" />
      <span className="rot" data-handle="rot">
        <RotateCw size={9} strokeWidth={2.5} style={{ pointerEvents: 'none' }} />
      </span>
    </div>
  );
}

function Transport() {
  const t = usePlayhead();
  const playing = usePlaying();
  const duration = useEditor((s) => projectDuration(s.clips));
  const [vol, setVol] = useState(1);
  const tc = timecode(t);

  const setVolume = (v: number) => {
    setVol(v);
    engine.setMasterVolume(v);
  };

  return (
    <div className="transport">
      <div className="tc">
        <span className="cur">{tc.slice(0, 8)}</span>
        <span className="ff" style={{ marginLeft: -8 }}>
          :{tc.slice(9)}
        </span>
        <span className="tot">/ {timecode(duration)}</span>
      </div>
      <div className="transport-mid">
        <IconButton tip="Start  Home" tipPos="up" onClick={() => engine.seek(0)}>
          <SkipBack size={16} />
        </IconButton>
        <IconButton tip="Back 1 frame  ←" tipPos="up" onClick={() => engine.seek(engine.time - 1 / FPS)}>
          <StepBack size={16} />
        </IconButton>
        <button
          className={`play-btn ${playing ? 'on' : ''}`}
          onClick={() => engine.toggle()}
          aria-label={playing ? 'Pause' : 'Play'}
          disabled={duration <= 0}
        >
          {playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" style={{ marginLeft: 2 }} />}
        </button>
        <IconButton tip="Forward 1 frame  →" tipPos="up" onClick={() => engine.seek(engine.time + 1 / FPS)}>
          <StepForward size={16} />
        </IconButton>
        <IconButton tip="End  End" tipPos="up" onClick={() => engine.seek(duration)}>
          <SkipForward size={16} />
        </IconButton>
      </div>
      <div className="transport-right">
        <div className="vol">
          <IconButton tip={vol ? 'Mute monitor' : 'Unmute monitor'} tipPos="up" onClick={() => setVolume(vol ? 0 : 1)}>
            {vol ? <Volume2 size={16} /> : <VolumeX size={16} />}
          </IconButton>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={vol}
            style={{ ['--p' as string]: `${vol * 100}%` }}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            aria-label="Monitor volume"
          />
        </div>
      </div>
    </div>
  );
}
