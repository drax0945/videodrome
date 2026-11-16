import { useEffect, type CSSProperties } from 'react';
import { Plus } from 'lucide-react';
import { TEXT_PRESETS, BASE_TEXT, type TextPreset } from '../../state/textPresets';
import { addTextClip } from '../../state/store';
import { engine } from '../../engine/engine';
import { hexToRgba } from '../../lib/util';
import { startLibraryDrag } from '../dnd';
import { loadFontFamily } from '../../fonts';

function sampleStyle(p: TextPreset): CSSProperties {
  const s = { ...BASE_TEXT, ...p.style };
  const longest = Math.max(...(s.content.split('\n')[0] ?? '').split(' ').map((w) => w.length), 4);
  const px = Math.max(11, Math.min(26, s.size / 5.5, 190 / longest));
  const css: CSSProperties = {
    fontFamily: `"${s.font}", sans-serif`,
    fontWeight: s.weight,
    fontStyle: s.italic ? 'italic' : 'normal',
    fontSize: px,
    letterSpacing: s.letterSpacing / 5,
    color: s.fillOpacity > 0 ? s.color : 'transparent',
    textTransform: s.uppercase ? 'uppercase' : 'none',
    textAlign: s.align,
    whiteSpace: 'pre-line',
  };
  if (s.strokeWidth > 0) css.WebkitTextStroke = `1px ${s.stroke}`;
  if (s.glow > 0) css.textShadow = `0 0 ${s.glow / 4}px ${s.glowColor}, 0 0 ${s.glow / 2}px ${s.glowColor}`;
  if (s.anim === 'glitch') css.textShadow = '-2px 0 rgba(0,240,255,.85), 2px 0 rgba(255,0,90,.85)';
  if (s.bgOpacity > 0) {
    css.background = hexToRgba(s.bg, s.bgOpacity);
    css.padding = '4px 8px';
    css.borderRadius = 3;
    css.fontSize = Math.min(px, 13);
  }
  return css;
}

export function TextPanel() {
  useEffect(() => {
    for (const p of TEXT_PRESETS) void loadFontFamily(p.style.font ?? BASE_TEXT.font);
  }, []);
  return (
    <>
      <div className="panel-head">
        <div className="panel-title">
          <span className="idx">02</span>
          <h2>Text</h2>
        </div>
        <span className="label">{TEXT_PRESETS.length} styles</span>
      </div>
      <div className="panel-body">
        <div className="preset-grid">
          {TEXT_PRESETS.map((p) => (
            <div
              key={p.id}
              className="preset"
              draggable
              onDragStart={(e) => startLibraryDrag(e, { text: p.id }, 'visual')}
              onClick={() => addTextClip(p.id, {}, engine.time)}
              title={`Add ${p.label} at playhead`}
            >
              <span className="tag">{p.tag}</span>
              <div className="sample" style={sampleStyle(p)}>
                {p.style.content?.split('\n')[0]}
              </div>
              <span className="name">{p.label}</span>
              <span className="add mini-btn">
                <Plus size={13} />
              </span>
            </div>
          ))}
        </div>
        <div className="empty-note">
          {'// click to drop at the playhead'}
          <br />
          {'// or drag onto any track'}
        </div>
      </div>
    </>
  );
}
