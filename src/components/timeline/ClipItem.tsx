import { memo } from 'react';
import { Film, Image as ImageIcon, Music, Type, VolumeX } from 'lucide-react';
import type { Clip, MediaItem } from '../../state/types';
import { shortTime } from '../../lib/util';
import { Waveform } from '../Waveform';

export type ClipDragMode = 'move' | 'trim-l' | 'trim-r';

const ICON = { video: Film, image: ImageIcon, audio: Music, text: Type };

function Filmstrip({ clip, media, width, height }: { clip: Clip; media: MediaItem; width: number; height: number }) {
  const ar = media.width && media.height ? media.width / media.height : 16 / 9;
  let tileW = Math.max(36, Math.min(160, height * ar));
  let count = Math.ceil(width / tileW);
  if (count > 160) {
    count = 160;
    tileW = width / count;
  }
  const tiles = [];
  for (let i = 0; i < count; i++) {
    let src = media.poster;
    if (clip.type === 'video' && media.thumbnails.length) {
      const t = clip.trimStart + (((i + 0.5) * tileW) / width) * clip.duration * clip.speed;
      let best = media.thumbnails[0];
      for (const th of media.thumbnails) if (Math.abs(th.time - t) < Math.abs(best.time - t)) best = th;
      src = best.url;
    }
    tiles.push(
      src ? (
        <img key={i} src={src} alt="" draggable={false} style={{ width: tileW }} />
      ) : (
        <div key={i} className="tile" style={{ width: tileW }} />
      ),
    );
  }
  return <div className="filmstrip">{tiles}</div>;
}

export const ClipItem = memo(function ClipItem(props: {
  clip: Clip;
  media?: MediaItem;
  pps: number;
  height: number;
  selected: boolean;
  dimmed: boolean;
  onPointerDown: (e: React.PointerEvent, clip: Clip, mode: ClipDragMode) => void;
}) {
  const { clip, media, pps, height, selected, dimmed, onPointerDown } = props;
  const width = Math.max(4, clip.duration * pps);
  const Icon = ICON[clip.type];
  const srcFrom = clip.trimStart;
  const srcTo = clip.trimStart + clip.duration * clip.speed;
  const inner = height - 10;

  return (
    <div
      className={`clip ${clip.type} ${selected ? 'sel' : ''} ${dimmed ? 'dim' : ''}`}
      style={{ left: clip.start * pps, width }}
      onPointerDown={(e) => onPointerDown(e, clip, 'move')}
      data-clip-id={clip.id}
    >
      {media && (clip.type === 'video' || clip.type === 'image') && (
        <Filmstrip clip={clip} media={media} width={width} height={inner} />
      )}
      {media?.peaks && (clip.type === 'audio' || clip.type === 'video') && width > 6 && (
        <div className="wave">
          <Waveform
            peaks={media.peaks}
            from={srcFrom}
            to={srcTo}
            color={clip.type === 'audio' ? 'rgba(200,255,46,0.75)' : 'rgba(46,242,255,0.8)'}
            align={clip.type === 'audio' ? 'center' : 'bottom'}
            bar={clip.type === 'audio' ? 3 : 2}
          />
        </div>
      )}
      {clip.type === 'text' && clip.text && width > 40 && (
        <div className="text-preview">{clip.text.content.replace(/\n/g, ' · ')}</div>
      )}

      {clip.fadeIn > 0 && <div className="fade-mark in" style={{ width: clip.fadeIn * pps }} />}
      {clip.fadeOut > 0 && <div className="fade-mark out" style={{ width: clip.fadeOut * pps }} />}

      {width > 28 && (
        <div className="clip-label">
          <span className="ico">
            <Icon size={11} />
          </span>
          <span className="nm">{clip.type === 'text' ? clip.text?.content.split('\n')[0] || clip.name : clip.name}</span>
          {clip.speed !== 1 && <span className="badge">{clip.speed}×</span>}
          {clip.muted && clip.type !== 'image' && clip.type !== 'text' && (
            <span className="badge">
              <VolumeX size={9} />
            </span>
          )}
        </div>
      )}
      {width > 90 && clip.type !== 'text' && <span className="clip-dur">{shortTime(clip.duration)}</span>}

      <div className="trim l" onPointerDown={(e) => onPointerDown(e, clip, 'trim-l')} />
      <div className="trim r" onPointerDown={(e) => onPointerDown(e, clip, 'trim-r')} />
    </div>
  );
});
