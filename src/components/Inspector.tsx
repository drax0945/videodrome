import { useEffect, useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Blend,
  Crosshair,
  Film,
  Gauge,
  Image as ImageIcon,
  Move,
  Music,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Type,
  Volume2,
} from 'lucide-react';
import type { Clip, MediaItem, TextAnim, TextStyle } from '../state/types';
import { deleteClip, toast, updateClip, updateText, useEditor } from '../state/store';
import { neighbourBounds, projectDuration } from '../state/timeline';
import { FONTS } from '../state/textPresets';
import { ASPECTS, DEFAULT_FILTERS, FILTER_PRESETS, filterString, shortTime, timecode } from '../lib/util';
import { ColorField, IconButton, Section, Seg, Select, Slider, Toggle } from './ui/controls';

type Tab = 'text' | 'style' | 'transform' | 'adjust' | 'audio' | 'speed' | 'fade';

const TABS: Record<Clip['type'], Tab[]> = {
  video: ['transform', 'adjust', 'audio', 'speed', 'fade'],
  image: ['transform', 'adjust', 'fade'],
  audio: ['audio', 'speed', 'fade'],
  text: ['text', 'style', 'transform', 'fade'],
};

const TAB_META: Record<Tab, { label: string; icon: typeof Move }> = {
  text: { label: 'Text', icon: Type },
  style: { label: 'Style', icon: Sparkles },
  transform: { label: 'Xform', icon: Move },
  adjust: { label: 'Color', icon: SlidersHorizontal },
  audio: { label: 'Audio', icon: Volume2 },
  speed: { label: 'Speed', icon: Gauge },
  fade: { label: 'Fade', icon: Blend },
};

const TYPE_META = {
  video: { icon: Film, color: 'var(--c-video)' },
  image: { icon: ImageIcon, color: 'var(--c-image)' },
  audio: { icon: Music, color: 'var(--c-audio)' },
  text: { icon: Type, color: 'var(--c-text)' },
};

export function Inspector() {
  const clip = useEditor((s) => s.clips.find((c) => c.id === s.selectedId));
  const media = useEditor((s) => (clip?.mediaId ? s.media.find((m) => m.id === clip.mediaId) : undefined));
  const [tab, setTab] = useState<Tab>('transform');
  const tabs = clip ? TABS[clip.type] : [];
  const active = tabs.includes(tab) ? tab : tabs[0];

  const type = clip?.type;
  useEffect(() => {
    if (type) setTab(TABS[type][0]);
  }, [type]);

  useEffect(() => {
    const onFocus = () => setTab('text');
    window.addEventListener('vd:focus-text', onFocus);
    return () => window.removeEventListener('vd:focus-text', onFocus);
  }, []);

  if (!clip) return <ProjectOverview />;
  const meta = TYPE_META[clip.type];
  const Icon = meta.icon;

  return (
    <aside className="inspector">
      <div className="insp-head">
        <div className="insp-icon" style={{ color: meta.color }}>
          <Icon size={15} />
        </div>
        <div className="insp-title">
          <div className="name">{clip.type === 'text' ? clip.text?.content.split('\n')[0] || 'Text' : clip.name}</div>
          <div className="label" style={{ marginTop: 3 }}>
            {clip.type} · {shortTime(clip.start)} → {shortTime(clip.start + clip.duration)}
          </div>
        </div>
        <IconButton tip="Delete clip" onClick={() => deleteClip(clip.id)}>
          <Trash2 size={15} />
        </IconButton>
      </div>
      <div className="insp-tabs">
        {tabs.map((t) => {
          const TIcon = TAB_META[t].icon;
          return (
            <button key={t} className={`insp-tab ${active === t ? 'on' : ''}`} onClick={() => setTab(t)}>
              <TIcon size={12} />
              {TAB_META[t].label}
            </button>
          );
        })}
      </div>
      <div className="insp-body">
        {active === 'text' && clip.text && <TextTab clip={clip} ts={clip.text} />}
        {active === 'style' && clip.text && <StyleTab clip={clip} ts={clip.text} />}
        {active === 'transform' && <TransformTab clip={clip} />}
        {active === 'adjust' && <AdjustTab clip={clip} media={media} />}
        {active === 'audio' && <AudioTab clip={clip} />}
        {active === 'speed' && <SpeedTab clip={clip} media={media} />}
        {active === 'fade' && <FadeTab clip={clip} />}
      </div>
    </aside>
  );
}

const pct = (v: number) => `${Math.round(v * 100)}%`;

/* ───────────── transform ───────────── */

function TransformTab({ clip }: { clip: Clip }) {
  const aspect = useEditor((s) => s.aspect);
  const { w: W, h: H } = ASPECTS[aspect];
  const set = (patch: Partial<Clip>, key: string) => updateClip(clip.id, patch, `${clip.id}:${key}`);
  const media = clip.type === 'video' || clip.type === 'image';
  return (
    <>
      <Section
        title="Position"
        right={
          <IconButton sm tip="Center" onClick={() => updateClip(clip.id, { x: 0.5, y: 0.5 })}>
            <Crosshair size={13} />
          </IconButton>
        }
      >
        <Slider label="X" value={clip.x} min={-0.5} max={1.5} step={0.001} def={0.5} format={(v) => `${Math.round(v * W)}px`} onChange={(x) => set({ x }, 'x')} />
        <Slider label="Y" value={clip.y} min={-0.5} max={1.5} step={0.001} def={0.5} format={(v) => `${Math.round(v * H)}px`} onChange={(y) => set({ y }, 'y')} />
      </Section>
      <Section title="Transform">
        <Slider label="Scale" value={clip.scale} min={0.05} max={4} step={0.01} def={1} format={pct} onChange={(scale) => set({ scale }, 'scale')} />
        <Slider label="Rotation" value={clip.rotation} min={-180} max={180} step={0.5} def={0} format={(v) => `${v.toFixed(1)}°`} onChange={(rotation) => set({ rotation }, 'rot')} />
        <Slider label="Opacity" value={clip.opacity} min={0} max={1} step={0.01} def={1} format={pct} onChange={(opacity) => set({ opacity }, 'op')} />
      </Section>
      {media && (
        <Section title="Frame fit">
          <div className="row">
            <Seg
              full
              value={clip.fit}
              onChange={(fit) => updateClip(clip.id, { fit })}
              options={[
                { value: 'contain', label: 'FIT' },
                { value: 'cover', label: 'FILL' },
              ]}
            />
          </div>
          <div className="row">
            <button className="btn block" onClick={() => updateClip(clip.id, { fit: 'cover', scale: 1, x: 0.5, y: 0.5, rotation: 0 })}>
              Fill frame
            </button>
            <button className="btn block" onClick={() => updateClip(clip.id, { fit: 'contain', scale: 1, x: 0.5, y: 0.5, rotation: 0, opacity: 1 })}>
              <RotateCcw size={13} />
              Reset
            </button>
          </div>
        </Section>
      )}
    </>
  );
}

/* ───────────── colour / filters ───────────── */

function AdjustTab({ clip, media }: { clip: Clip; media?: MediaItem }) {
  const f = clip.filters;
  const set = (k: keyof typeof f, v: number) =>
    updateClip(clip.id, { filters: { ...f, [k]: v }, filterPreset: 'custom' }, `${clip.id}:f:${k}`);
  return (
    <>
      <Section title="Looks">
        <div className="filter-grid">
          {FILTER_PRESETS.map((p) => {
            const filters = { ...DEFAULT_FILTERS, ...p.f };
            return (
              <button
                key={p.id}
                className={`filter-tile ${clip.filterPreset === p.id ? 'on' : ''}`}
                onClick={() => updateClip(clip.id, { filters, filterPreset: p.id })}
              >
                <div
                  className="fx"
                  style={{
                    backgroundImage: media?.poster ? `url(${media.poster})` : 'linear-gradient(135deg,#2ef2ff,#ff2e88 60%,#c8ff2e)',
                    filter: filterString(filters, 0.1),
                  }}
                />
                <span>{p.label}</span>
              </button>
            );
          })}
        </div>
      </Section>
      <Section
        title="Adjust"
        right={
          <IconButton sm tip="Reset adjustments" onClick={() => updateClip(clip.id, { filters: { ...DEFAULT_FILTERS }, filterPreset: 'none' })}>
            <RotateCcw size={13} />
          </IconButton>
        }
      >
        <Slider label="Brightness" value={f.brightness} min={0} max={200} def={100} format={(v) => `${v}%`} onChange={(v) => set('brightness', v)} />
        <Slider label="Contrast" value={f.contrast} min={0} max={200} def={100} format={(v) => `${v}%`} onChange={(v) => set('contrast', v)} />
        <Slider label="Saturation" value={f.saturate} min={0} max={300} def={100} format={(v) => `${v}%`} onChange={(v) => set('saturate', v)} />
        <Slider label="Hue shift" value={f.hue} min={-180} max={180} def={0} format={(v) => `${v}°`} onChange={(v) => set('hue', v)} />
        <Slider label="Blur" value={f.blur} min={0} max={40} step={0.5} def={0} format={(v) => `${v}px`} onChange={(v) => set('blur', v)} />
        <Slider label="Mono" value={f.grayscale} min={0} max={100} def={0} format={(v) => `${v}%`} onChange={(v) => set('grayscale', v)} />
        <Slider label="Sepia" value={f.sepia} min={0} max={100} def={0} format={(v) => `${v}%`} onChange={(v) => set('sepia', v)} />
        <Slider label="Invert" value={f.invert} min={0} max={100} def={0} format={(v) => `${v}%`} onChange={(v) => set('invert', v)} />
      </Section>
    </>
  );
}

/* ───────────── audio ───────────── */

function AudioTab({ clip }: { clip: Clip }) {
  return (
    <Section title="Level">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="label">Mute clip</span>
        <Toggle on={clip.muted} onChange={(muted) => updateClip(clip.id, { muted })} />
      </div>
      <Slider
        label="Volume"
        value={clip.volume}
        min={0}
        max={2}
        step={0.01}
        def={1}
        format={(v) => (v === 0 ? '-∞ dB' : `${(20 * Math.log10(v)).toFixed(1)} dB · ${Math.round(v * 100)}%`)}
        onChange={(volume) => updateClip(clip.id, { volume }, `${clip.id}:vol`)}
      />
    </Section>
  );
}

/* ───────────── speed ───────────── */

function SpeedTab({ clip, media }: { clip: Clip; media?: MediaItem }) {
  const setSpeed = (speed: number, key?: string) => {
    const s = useEditor.getState();
    const span = clip.duration * clip.speed;
    let duration = span / speed;
    const { nextStart } = neighbourBounds(s.clips, clip);
    const room = nextStart - clip.start;
    if (duration > room) {
      duration = room;
      if (!key) toast('Clip trimmed to fit before the next clip');
    }
    if (media) duration = Math.min(duration, (media.duration - clip.trimStart) / speed);
    updateClip(clip.id, { speed, duration: Math.max(0.1, duration) }, key ?? true);
  };
  return (
    <Section title="Playback rate">
      <div className="speed-chips">
        {[0.25, 0.5, 1, 1.5, 2, 4].map((v) => (
          <button key={v} className={`chip ${clip.speed === v ? 'on' : ''}`} style={{ textAlign: 'center' }} onClick={() => setSpeed(v)}>
            {v}×
          </button>
        ))}
      </div>
      <Slider label="Speed" value={clip.speed} min={0.1} max={4} step={0.05} def={1} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => setSpeed(Math.round(v * 100) / 100, `${clip.id}:speed`)} />
      <div className="info-line">
        <span className="label">Length</span>
        <span className="mono">{timecode(clip.duration)}</span>
      </div>
    </Section>
  );
}

/* ───────────── fade ───────────── */

function FadeTab({ clip }: { clip: Clip }) {
  const max = Math.max(0.1, Math.min(5, clip.duration / 2));
  return (
    <Section title="Fades">
      <Slider label="Fade in" value={Math.min(clip.fadeIn, max)} min={0} max={max} step={0.05} def={0} format={(v) => `${v.toFixed(2)}s`} onChange={(fadeIn) => updateClip(clip.id, { fadeIn }, `${clip.id}:fi`)} />
      <Slider label="Fade out" value={Math.min(clip.fadeOut, max)} min={0} max={max} step={0.05} def={0} format={(v) => `${v.toFixed(2)}s`} onChange={(fadeOut) => updateClip(clip.id, { fadeOut }, `${clip.id}:fo`)} />
      <div className="row">
        <button className="btn block" onClick={() => updateClip(clip.id, { fadeIn: Math.min(0.5, max), fadeOut: Math.min(0.5, max) })}>
          Quick 0.5s
        </button>
        <button className="btn block" onClick={() => updateClip(clip.id, { fadeIn: 0, fadeOut: 0 })}>
          Clear
        </button>
      </div>
      <div className="empty-note" style={{ marginTop: 6 }}>
        {'// fades affect opacity and volume'}
      </div>
    </Section>
  );
}

/* ───────────── text ───────────── */

function TextTab({ clip, ts }: { clip: Clip; ts: TextStyle }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const set = (patch: Partial<TextStyle>) => updateText(clip.id, patch);
  useEffect(() => {
    const onFocus = () => setTimeout(() => ref.current?.select(), 0);
    window.addEventListener('vd:focus-text', onFocus);
    return () => window.removeEventListener('vd:focus-text', onFocus);
  }, []);
  return (
    <>
      <Section title="Content">
        <textarea ref={ref} className="textarea" value={ts.content} spellCheck={false} onChange={(e) => set({ content: e.target.value })} />
      </Section>
      <Section title="Type">
        <div className="row">
          <Select
            style={{ flex: 1 }}
            value={ts.font}
            onChange={(font) => set({ font })}
            options={FONTS.map((f) => ({ value: f, label: f }))}
          />
        </div>
        <div className="row">
          <Seg
            full
            value={ts.weight}
            onChange={(weight) => set({ weight })}
            options={[400, 500, 600, 700, 800].map((w) => ({ value: w, label: String(w) }))}
          />
        </div>
        <Slider label="Size" value={ts.size} min={12} max={400} def={96} format={(v) => `${v}px`} onChange={(size) => set({ size })} />
        <Slider label="Tracking" value={ts.letterSpacing} min={-10} max={40} step={0.5} def={0} format={(v) => `${v}px`} onChange={(letterSpacing) => set({ letterSpacing })} />
        <Slider label="Leading" value={ts.lineHeight} min={0.7} max={2.2} step={0.05} def={1.15} format={(v) => v.toFixed(2)} onChange={(lineHeight) => set({ lineHeight })} />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Seg
            value={ts.align}
            onChange={(align) => set({ align })}
            options={[
              { value: 'left', label: <AlignLeft size={13} />, tip: 'Left' },
              { value: 'center', label: <AlignCenter size={13} />, tip: 'Center' },
              { value: 'right', label: <AlignRight size={13} />, tip: 'Right' },
            ]}
          />
          <div className="seg">
            <button className={ts.uppercase ? 'on' : ''} onClick={() => set({ uppercase: !ts.uppercase })} title="Uppercase">
              AA
            </button>
            <button className={ts.italic ? 'on' : ''} onClick={() => set({ italic: !ts.italic })} title="Italic">
              <i>I</i>
            </button>
          </div>
        </div>
      </Section>
      <Section title="Fill">
        <div className="row">
          <ColorField value={ts.color} onChange={(color) => set({ color })} />
        </div>
        <Slider label="Fill opacity" value={ts.fillOpacity} min={0} max={1} step={0.01} def={1} format={pct} onChange={(fillOpacity) => set({ fillOpacity })} />
      </Section>
    </>
  );
}

const ANIMS: { value: TextAnim; label: string }[] = [
  { value: 'none', label: 'NONE' },
  { value: 'typewriter', label: 'TYPE' },
  { value: 'slide', label: 'SLIDE' },
  { value: 'pop', label: 'POP' },
  { value: 'glitch', label: 'GLITCH' },
];

function StyleTab({ clip, ts }: { clip: Clip; ts: TextStyle }) {
  const set = (patch: Partial<TextStyle>) => updateText(clip.id, patch);
  return (
    <>
      <Section title="Animation">
        <div className="row">
          <Seg full value={ts.anim} onChange={(anim) => set({ anim })} options={ANIMS} />
        </div>
      </Section>
      <Section title="Background">
        <div className="row">
          <ColorField value={ts.bg} onChange={(bg) => set({ bg, bgOpacity: ts.bgOpacity || 1 })} />
        </div>
        <Slider label="Opacity" value={ts.bgOpacity} min={0} max={1} step={0.01} def={0} format={pct} onChange={(bgOpacity) => set({ bgOpacity })} />
        <Slider label="Padding" value={ts.bgPadding} min={0} max={120} def={24} format={(v) => `${v}px`} onChange={(bgPadding) => set({ bgPadding })} />
        <Slider label="Radius" value={ts.bgRadius} min={0} max={80} def={8} format={(v) => `${v}px`} onChange={(bgRadius) => set({ bgRadius })} />
      </Section>
      <Section title="Outline">
        <div className="row">
          <ColorField value={ts.stroke} onChange={(stroke) => set({ stroke, strokeWidth: ts.strokeWidth || 3 })} />
        </div>
        <Slider label="Width" value={ts.strokeWidth} min={0} max={24} step={0.5} def={0} format={(v) => `${v}px`} onChange={(strokeWidth) => set({ strokeWidth })} />
      </Section>
      <Section title="Glow">
        <div className="row">
          <ColorField value={ts.glowColor} onChange={(glowColor) => set({ glowColor, glow: ts.glow || 30 })} />
        </div>
        <Slider label="Intensity" value={ts.glow} min={0} max={120} def={0} format={(v) => `${v}`} onChange={(glow) => set({ glow })} />
      </Section>
    </>
  );
}

/* ───────────── nothing selected ───────────── */

function ProjectOverview() {
  const clips = useEditor((s) => s.clips);
  const tracks = useEditor((s) => s.tracks.length);
  const media = useEditor((s) => s.media.length);
  const aspect = useEditor((s) => s.aspect);
  const d = projectDuration(clips);
  return (
    <aside className="inspector">
      <div className="insp-head">
        <div className="insp-icon" style={{ color: 'var(--accent)' }}>
          <SlidersHorizontal size={15} />
        </div>
        <div className="insp-title">
          <div className="name">Properties</div>
          <div className="label" style={{ marginTop: 3 }}>
            Nothing selected
          </div>
        </div>
      </div>
      <div className="insp-body">
        <div className="insp-empty" style={{ padding: '18px 0' }}>
          <div className="stat-grid">
            <div className="stat">
              <div className="label">Runtime</div>
              <div className="v">{timecode(d).slice(3, 8)}</div>
            </div>
            <div className="stat">
              <div className="label">Format</div>
              <div className="v">{aspect}</div>
            </div>
            <div className="stat">
              <div className="label">Clips</div>
              <div className="v">{String(clips.length).padStart(2, '0')}</div>
            </div>
            <div className="stat">
              <div className="label">Assets</div>
              <div className="v">{String(media).padStart(2, '0')}</div>
            </div>
          </div>
          <div className="ascii">
            {[
              '┌─ SELECT A CLIP ─────────┐',
              `│ ${'timeline > click'.padEnd(23)} │`,
              `│ ${'monitor  > click/drag'.padEnd(23)} │`,
              `│ ${`${String(tracks).padStart(2, '0')} track(s) armed`.padEnd(23)} │`,
              '└─────────────────────────┘',
            ].join('\n')}
          </div>
          <div className="empty-note" style={{ marginTop: 0 }}>
            {'// drag corners on the monitor to scale'}
            <br />
            {'// drag the dot above an element to rotate'}
            <br />
            {'// double-click text to edit'}
          </div>
        </div>
      </div>
    </aside>
  );
}

