import { useEffect, useRef, useState } from 'react';
import { CircleCheck, Download, Info, LoaderCircle, X, Zap } from 'lucide-react';
import { toast, useEditor } from '../state/store';
import {
  codecLabel,
  exportProject,
  getExportFormats,
  type ExportFormat,
  type ExportProgress,
  type QualityId,
} from '../engine/export';
import { ASPECTS, bytes, timecode } from '../lib/util';
import { projectDuration } from '../state/timeline';
import { Toggle } from './ui/controls';

const RESOLUTIONS = [
  { short: 480, label: '480p', sub: 'Draft' },
  { short: 720, label: '720p', sub: 'HD' },
  { short: 1080, label: '1080p', sub: 'Full HD' },
];

const QUALITY_OPTS: { id: QualityId; label: string; sub: string }[] = [
  { id: 'standard', label: 'Standard', sub: 'Smaller file' },
  { id: 'high', label: 'High', sub: 'Recommended' },
  { id: 'max', label: 'Max', sub: 'Largest file' },
];

type Phase =
  | { kind: 'setup' }
  | { kind: 'rendering'; p: number; t: number; speed: number }
  | { kind: 'done'; url: string; size: number; seconds: number };

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  if (!open) return null;
  return <ExportInner />;
}

function ExportInner() {
  const name = useEditor((s) => s.projectName);
  const aspect = useEditor((s) => s.aspect);
  const duration = useEditor((s) => projectDuration(s.clips));
  const [formats, setFormats] = useState<ExportFormat[] | null>(null);
  const [formatId, setFormatId] = useState<ExportFormat['id']>('mp4');
  const [short, setShort] = useState(1080);
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState<QualityId>('high');
  const [monitor, setMonitor] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const abort = useRef<AbortController | null>(null);
  const live = useRef<HTMLCanvasElement>(null);

  const { w, h } = ASPECTS[aspect];
  const k = short / Math.min(w, h);
  const outW = Math.round((w * k) / 2) * 2;
  const outH = Math.round((h * k) / 2) * 2;
  const format = formats?.find((f) => f.id === formatId) ?? formats?.[0];
  const fast = format?.engine === 'webcodecs';

  useEffect(() => {
    let alive = true;
    const s = 1080 / Math.min(w, h);
    getExportFormats(Math.round(w * s), Math.round(h * s))
      .then((f) => alive && setFormats(f))
      .catch(() => alive && setFormats([]));
    return () => {
      alive = false;
    };
  }, [w, h]);

  const close = () => {
    abort.current?.abort();
    if (phase.kind === 'done') URL.revokeObjectURL(phase.url);
    useEditor.setState({ exportOpen: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && phase.kind !== 'rendering') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const onProgress = (p: ExportProgress) => {
    setPhase({ kind: 'rendering', p: p.fraction, t: p.time, speed: p.speed });
    const c = live.current;
    if (c && p.canvas) {
      const ctx = c.getContext('2d');
      if (c.width !== c.clientWidth * 2) {
        c.width = c.clientWidth * 2;
        c.height = Math.round((c.width * p.canvas.height) / p.canvas.width);
      }
      ctx?.drawImage(p.canvas, 0, 0, c.width, c.height);
    }
  };

  const start = async () => {
    if (!format) return;
    const ctl = new AbortController();
    abort.current = ctl;
    const startedAt = performance.now();
    setPhase({ kind: 'rendering', p: 0, t: 0, speed: 0 });
    try {
      const blob = await exportProject({ format, shortSide: short, fps, quality, monitor, signal: ctl.signal, onProgress });
      const seconds = (performance.now() - startedAt) / 1000;
      setPhase({ kind: 'done', url: URL.createObjectURL(blob), size: blob.size, seconds });
      toast(`Rendered in ${seconds.toFixed(1)}s`, 'success');
    } catch (err) {
      setPhase({ kind: 'setup' });
      if ((err as DOMException).name === 'AbortError') toast('Export cancelled');
      else toast(`Export failed — ${(err as Error).message}`, 'error');
    } finally {
      abort.current = null;
    }
  };

  const fileName = `${(name || 'videodrome').replace(/[^\w\- ]+/g, '').trim() || 'videodrome'}.${format?.ext ?? 'mp4'}`;

  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && phase.kind !== 'rendering' && close()}>
      <div className="modal" role="dialog" aria-label="Export">
        <div className="modal-head">
          <div>
            <div className="label" style={{ marginBottom: 4 }}>
              {phase.kind === 'rendering' ? '● RENDERING' : phase.kind === 'done' ? 'OUTPUT READY' : 'RENDER QUEUE'}
            </div>
            <h3>{phase.kind === 'done' ? 'Your video is ready' : 'Export video'}</h3>
          </div>
          {phase.kind !== 'rendering' && (
            <button className="icon-btn" onClick={close} aria-label="Close">
              <X size={16} />
            </button>
          )}
        </div>

        {phase.kind === 'setup' && (
          <>
            <div className="modal-body">
              {formats === null ? (
                <div className="info-line">
                  <LoaderCircle size={14} className="spin" /> Checking which encoders this browser has…
                </div>
              ) : !formats.length ? (
                <div className="info-line" style={{ color: 'var(--red)' }}>
                  <Info size={14} /> This browser can’t encode video. Try a recent Chrome or Edge.
                </div>
              ) : null}
              <div>
                <div className="label" style={{ marginBottom: 8 }}>
                  Resolution
                </div>
                <div className="opt-grid">
                  {RESOLUTIONS.map((q) => (
                    <button key={q.short} className={`opt ${short === q.short ? 'on' : ''}`} onClick={() => setShort(q.short)}>
                      <b>{q.label}</b>
                      <span>{q.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
              {fast && (
                <div>
                  <div className="label" style={{ marginBottom: 8 }}>
                    Quality
                  </div>
                  <div className="opt-grid">
                    {QUALITY_OPTS.map((q) => (
                      <button key={q.id} className={`opt ${quality === q.id ? 'on' : ''}`} onClick={() => setQuality(q.id)}>
                        <b style={{ fontSize: 12 }}>{q.label}</b>
                        <span>{q.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <div className="label" style={{ marginBottom: 8 }}>
                    Frame rate
                  </div>
                  <div className="seg full">
                    {[24, 30, 60].map((f) => (
                      <button key={f} className={fps === f ? 'on' : ''} onClick={() => setFps(f)}>
                        {f}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <div className="label" style={{ marginBottom: 8 }}>
                    Container
                  </div>
                  <div className="seg full">
                    {(formats ?? []).map((f) => (
                      <button key={f.id} className={format?.id === f.id ? 'on' : ''} onClick={() => setFormatId(f.id)}>
                        {f.ext.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {format?.engine === 'realtime' && (
                <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                  <span className="info-line">Play audio while rendering</span>
                  <Toggle on={monitor} onChange={setMonitor} />
                </div>
              )}
              <div className="stat-grid" style={{ gridTemplateColumns: '1fr 1fr 1fr' }}>
                <div className="stat">
                  <div className="label">Output</div>
                  <div className="v" style={{ fontSize: 13 }}>
                    {outW}×{outH}
                  </div>
                </div>
                <div className="stat">
                  <div className="label">Runtime</div>
                  <div className="v" style={{ fontSize: 13 }}>
                    {timecode(duration).slice(3, 8)}
                  </div>
                </div>
                <div className="stat">
                  <div className="label">Codec</div>
                  <div className="v" style={{ fontSize: 13 }}>
                    {fast ? `${codecLabel(format?.videoCodec)}${format?.audioCodec ? '+' + codecLabel(format.audioCodec) : ''}` : format ? 'MediaRec' : '—'}
                  </div>
                </div>
              </div>
              {format && (
                <div className="info-line">
                  {fast ? (
                    <>
                      <Zap size={14} style={{ flexShrink: 0, color: 'var(--accent)' }} />
                      Frame-by-frame render with WebCodecs — usually faster than real time, every frame exact.
                    </>
                  ) : (
                    <>
                      <Info size={14} style={{ flexShrink: 0 }} />
                      This browser has no WebCodecs, so rendering runs in real time. Keep this tab open until it finishes.
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={close}>
                Cancel
              </button>
              <button className="btn primary" onClick={start} disabled={!format || duration <= 0}>
                Render {format?.ext.toUpperCase()}
              </button>
            </div>
          </>
        )}

        {phase.kind === 'rendering' && (
          <>
            <div className="modal-body">
              {fast && <canvas ref={live} className="export-preview" style={{ aspectRatio: `${outW} / ${outH}`, width: '100%' }} />}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span className="mono" style={{ fontSize: 28, fontWeight: 600 }}>
                  {Math.floor(phase.p * 100)}
                  <span style={{ color: 'var(--mute)', fontSize: 16 }}>%</span>
                </span>
                <span className="mono" style={{ color: 'var(--dim)', fontSize: 11 }}>
                  {timecode(phase.t)} / {timecode(duration)}
                </span>
              </div>
              <div className="meter">
                <div style={{ width: `${phase.p * 100}%` }} />
              </div>
              <div className="info-line" style={{ justifyContent: 'space-between' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="dot live" />
                  {outW}×{outH} @ {fps}fps → {format?.ext.toUpperCase()}
                </span>
                {phase.speed > 0 && (
                  <span className="mono" style={{ color: phase.speed >= 1 ? 'var(--accent)' : 'var(--dim)' }}>
                    {phase.speed.toFixed(1)}× real-time
                  </span>
                )}
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => abort.current?.abort()}>
                Cancel render
              </button>
            </div>
          </>
        )}

        {phase.kind === 'done' && (
          <>
            <div className="modal-body">
              <video className="export-preview" src={phase.url} controls />
              <div className="info-line">
                <CircleCheck size={15} color="var(--accent)" />
                <span>
                  {fileName} · {bytes(phase.size)} · rendered in {phase.seconds.toFixed(1)}s
                  {duration > 0 && ` (${(duration / phase.seconds).toFixed(1)}× real-time)`}
                </span>
              </div>
            </div>
            <div className="modal-foot">
              <button
                className="btn ghost"
                onClick={() => {
                  URL.revokeObjectURL(phase.url);
                  setPhase({ kind: 'setup' });
                }}
              >
                Render again
              </button>
              <a className="btn primary" href={phase.url} download={fileName} style={{ textDecoration: 'none' }}>
                <Download size={15} strokeWidth={2.2} />
                Download
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
