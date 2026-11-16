import { setAspect, setBackground, useEditor } from '../../state/store';
import type { AspectKey } from '../../state/types';
import { ASPECTS } from '../../lib/util';
import { ColorField, Section } from '../ui/controls';

const SWATCHES = ['#000000', '#0b0d10', '#ffffff', '#c8ff2e', '#2ef2ff', '#ff2e88', '#9d7bff', '#ffb02e', '#14213d'];

export function CanvasPanel() {
  const aspect = useEditor((s) => s.aspect);
  const bg = useEditor((s) => s.background);

  return (
    <>
      <div className="panel-head">
        <div className="panel-title">
          <span className="idx">03</span>
          <h2>Canvas</h2>
        </div>
      </div>
      <div className="panel-body">
        <Section title="Aspect ratio">
          <div className="aspect-grid">
            {(Object.keys(ASPECTS) as AspectKey[]).map((k) => {
              const a = ASPECTS[k];
              const ratio = a.w / a.h;
              const h = ratio >= 1 ? 40 / Math.max(1, ratio / 1.6) : 40;
              const w = h * ratio;
              return (
                <button key={k} className={`aspect-card ${aspect === k ? 'on' : ''}`} onClick={() => setAspect(k)}>
                  <div className="shape-wrap">
                    <div className="shape" style={{ width: w, height: h }} />
                  </div>
                  <div>
                    <div className="r">{k}</div>
                    <div className="d">
                      {a.label} · {a.w}×{a.h}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </Section>
        <Section title="Background">
          <div className="swatches" style={{ marginBottom: 12 }}>
            {SWATCHES.map((c) => (
              <button
                key={c}
                className={`swatch ${bg.toLowerCase() === c ? 'on' : ''}`}
                style={{ background: c }}
                onClick={() => setBackground(c)}
                aria-label={`Background ${c}`}
              />
            ))}
          </div>
          <ColorField value={bg} onChange={setBackground} />
        </Section>
      </div>
    </>
  );
}

const KEYS: [string, string[]][] = [
  ['Play / pause', ['Space']],
  ['Split at playhead', ['S']],
  ['Delete clip', ['⌫']],
  ['Ripple delete', ['⇧', '⌫']],
  ['Duplicate', ['⌘', 'D']],
  ['Undo', ['⌘', 'Z']],
  ['Redo', ['⇧', '⌘', 'Z']],
  ['Step one frame', ['←', '→']],
  ['Jump 1 second', ['⇧', '←/→']],
  ['Go to start / end', ['Home', 'End']],
  ['Zoom timeline', ['+', '−']],
  ['Zoom to fit', ['⇧', 'Z']],
  ['Nudge element', ['⌥', 'Arrows']],
  ['Deselect', ['Esc']],
];

export function KeysPanel() {
  return (
    <>
      <div className="panel-head">
        <div className="panel-title">
          <span className="idx">04</span>
          <h2>Shortcuts</h2>
        </div>
      </div>
      <div className="panel-body">
        <div className="kbd-list">
          {KEYS.map(([label, keys]) => (
            <div className="kbd-row" key={label}>
              <span>{label}</span>
              <span className="kbd">
                {keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
        <div className="empty-note">
          {'// ctrl replaces ⌘ on windows/linux'}
          <br />
          {'// ⌘/ctrl + scroll zooms the timeline'}
        </div>
      </div>
    </>
  );
}
