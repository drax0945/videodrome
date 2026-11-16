import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, Download, Info, X } from 'lucide-react';
import { toast, useEditor } from '../state/store';
import { exportProject, supportedFormats, type ExportFormat } from '../engine/export';
import { ASPECTS, bytes, timecode } from '../lib/util';
import { projectDuration } from '../state/timeline';
import { Toggle } from './ui/controls';

const QUALITIES = [
  { short: 480, label: '480p', sub: 'Draft' },
  { short: 720, label: '720p', sub: 'HD' },
  { short: 1080, label: '1080p', sub: 'Full HD' },
];

type Phase = { kind: 'setup' } | { kind: 'rendering'; p: number; t: number } | { kind: 'done'; url: string; size: number };

export function ExportDialog() {
  const open = useEditor((s) => s.exportOpen);
  if (!open) return null;
  return <ExportInner />;
}

function ExportInner() {
  const name = useEditor((s) => s.projectName);
  const aspect = useEditor((s) => s.aspect);
  const duration = useEditor((s) => projectDuration(s.clips));
  const formats = useMemo(supportedFormats, []);
  const [format, setFormat] = useState<ExportFormat | undefined>(formats[0]);
  const [short, setShort] = useState(1080);
  const [fps, setFps] = useState(30);
  const [monitor, setMonitor] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const abort = useRef<AbortController | null>(null);

  const { w, h } = ASPECTS[aspect];
  const k = short / Math.min(w, h);
  const outW = Math.round((w * k) / 2) * 2;
  const outH = Math.round((h * k) / 2) * 2;

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

  const start = async () => {
    if (!format) return;
    const ctl = new AbortController();
    abort.current = ctl;
    setPhase({ kind: 'rendering', p: 0, t: 0 });
    try {
      const blob = await exportProject({
        format,
        shortSide: short,
        fps,
        monitor,
        signal: ctl.signal,
        onProgress: (p, t) => setPhase({ kind: 'rendering', p, t }),
      });
      setPhase({ kind: 'done', url: URL.createObjectURL(blob), size: blob.size });
      toast('Render complete', 'success');
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') {
        setPhase({ kind: 'setup' });
        toast('Export cancelled');
      } else {
        setPhase({ kind: 'setup' });
        toast(`Export failed — ${(err as Error).message}`, 'error');
      }
    } finally {
      abort.current = null;
    }
  };

  const fileName = `${(name || 'videodrome').replace(/[^\w\- ]+/g, '').trim() || 'videodrome'}.${format?.ext ?? 'webm'}`;

  return (
    <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && phase.kind !== 'rendering' && close()}>
      <div className="modal" role="dialog" aria-label="Export">
        <div className="modal-head">
          <div>
            <div className="label" style={{ marginBottom: 4 }}>
              {phase.kind === 'rendering' ? '● REC' : phase.kind === 'done' ? 'OUTPUT READY' : 'RENDER QUEUE'}
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
              {!formats.length && (
                <div className="info-line" style={{ color: 'var(--red)' }}>
                  <Info size={14} /> This browser can’t record video (MediaRecorder unavailable). Try Chrome or Edge.
                </div>
              )}
              <div>
                <div className="label" style={{ marginBottom: 8 }}>
                  Resolution
                </div>
                <div className="opt-grid">
                  {QUALITIES.map((q) => (
                    <button key={q.short} className={`opt ${short === q.short ? 'on' : ''}`} onClick={() => setShort(q.short)}>
                      <b>{q.label}</b>
                      <span>{q.sub}</span>
                    </button>
                  ))}
                </div>
              </div>
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
                    {formats.map((f) => (
                      <button key={f.id} className={format?.id === f.id ? 'on' : ''} onClick={() => setFormat(f)}>
                        {f.ext.toUpperCase()}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'space-between', margin: 0 }}>
                <span className="info-line">Play audio while rendering</span>
                <Toggle on={monitor} onChange={setMonitor} />
              </div>
              <div className="stat-grid">
                <div className="stat">
                  <div className="label">Output</div>
                  <div className="v" style={{ fontSize: 14 }}>
                    {outW}×{outH}
                  </div>
                </div>
                <div className="stat">
                  <div className="label">Runtime</div>
                  <div className="v" style={{ fontSize: 14 }}>
                    {timecode(duration).slice(3)}
                  </div>
                </div>
              </div>
              <div className="info-line">
                <Info size={14} style={{ flexShrink: 0 }} />
                Rendering happens locally in real time (about as long as the video). Keep this tab open until it finishes.
              </div>
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
              <div className="info-line">
                <span className="dot live" />
                Encoding {outW}×{outH} @ {fps}fps → {format?.ext.toUpperCase()}
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
                  {fileName} · {bytes(phase.size)}
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
