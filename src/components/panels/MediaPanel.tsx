import { memo, useRef, useState } from 'react';
import { Film, Image as ImageIcon, LoaderCircle, Music, Plus, Trash2, TriangleAlert, Upload } from 'lucide-react';
import type { MediaItem, MediaKind } from '../../state/types';
import { addClipFromMedia, removeMedia, useEditor } from '../../state/store';
import { ACCEPT, importFiles } from '../../engine/media';
import { engine } from '../../engine/engine';
import { bytes, shortTime } from '../../lib/util';
import { Waveform } from '../Waveform';
import { startLibraryDrag } from '../dnd';

const KIND_ICON = { video: Film, audio: Music, image: ImageIcon };
const KIND_COLOR = { video: 'var(--c-video)', audio: 'var(--c-audio)', image: 'var(--c-image)' };

export function MediaPanel() {
  const media = useEditor((s) => s.media);
  const [filter, setFilter] = useState<'all' | MediaKind>('all');
  const input = useRef<HTMLInputElement>(null);
  const shown = filter === 'all' ? media : media.filter((m) => m.kind === filter);
  const count = (k: MediaKind) => media.filter((m) => m.kind === k).length;

  const open = () => input.current?.click();

  return (
    <>
      <div className="panel-head">
        <div className="panel-title">
          <span className="idx">01</span>
          <h2>Media</h2>
        </div>
        <button className="btn" onClick={open}>
          <Upload size={14} />
          Import
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            if (e.target.files) importFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      <div className="panel-body">
        <div className={`dropzone ${media.length ? 'compact' : ''}`} onClick={open}>
          <div className="big">
            <Upload size={media.length ? 15 : 20} />
          </div>
          <div>
            <strong>{media.length ? 'Add more media' : 'Drop files to import'}</strong>
            <div className="label" style={{ marginTop: 5 }}>
              VIDEO · AUDIO · IMAGE
            </div>
          </div>
        </div>

        {media.length > 0 && (
          <div className="chips">
            {(['all', 'video', 'audio', 'image'] as const).map((k) => (
              <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                {k}
                <span className="n">{k === 'all' ? media.length : count(k)}</span>
              </button>
            ))}
          </div>
        )}

        <div className="media-grid">
          {shown.map((m) => (
            <MediaCard key={m.id} m={m} />
          ))}
        </div>

        {!media.length && (
          <div className="empty-note">
            {'// drag clips from here onto the timeline'}
            <br />
            {'// drop above the top track to overlay'}
            <br />
            {'// everything stays local — nothing uploads'}
          </div>
        )}
      </div>
    </>
  );
}

const MediaCard = memo(function MediaCard({ m }: { m: MediaItem }) {
  const Icon = KIND_ICON[m.kind];
  const busy = m.status === 'processing';
  const add = () => addClipFromMedia(m.id, {}, engine.time);

  return (
    <div
      className="media-card"
      draggable={m.status !== 'error'}
      onDragStart={(e) => startLibraryDrag(e, { media: m.id }, m.kind === 'audio' ? 'audio' : 'visual')}
      onDoubleClick={add}
      title={m.name}
    >
      <div className="media-thumb">
        {m.kind === 'audio' ? (
          <div style={{ position: 'absolute', inset: '22% 8% 22%' }}>
            <Waveform peaks={m.peaks} from={0} to={m.duration || 1} color="#c8ff2e" bar={2} />
          </div>
        ) : m.poster ? (
          <img src={m.poster} alt="" draggable={false} />
        ) : null}
        {m.status === 'error' && <TriangleAlert size={20} color="var(--red)" />}
        {busy && <div className="scan" />}
        <span className="kind" style={{ color: KIND_COLOR[m.kind] }}>
          {busy ? <LoaderCircle size={10} className="spin" /> : <Icon size={10} />}
          {m.kind.toUpperCase()}
        </span>
        {m.duration > 0 && <span className="dur">{shortTime(m.duration)}</span>}
        <div className="actions" onDoubleClick={(e) => e.stopPropagation()}>
          <button className="mini-btn" onClick={add} title="Add to timeline" disabled={m.status === 'error'}>
            <Plus size={13} />
          </button>
          <button className="mini-btn danger" onClick={() => removeMedia(m.id)} title="Remove from project">
            <Trash2 size={12} />
          </button>
        </div>
        {m.progress < 1 && m.status !== 'error' && (
          <div className="progress-line" style={{ width: `${Math.max(4, m.progress * 100)}%` }} />
        )}
      </div>
      <div className="media-meta">
        <div className="media-name">{m.name}</div>
        <div className="media-sub">
          {m.status === 'error'
            ? 'UNSUPPORTED'
            : m.width
              ? `${m.width}×${m.height} · ${bytes(m.size)}`
              : bytes(m.size)}
        </div>
      </div>
    </div>
  );
});
