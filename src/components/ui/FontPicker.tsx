import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Search } from 'lucide-react';
import { FONT_CATALOG, FONT_CATEGORIES, loadAllFonts, loadFontFamily } from '../../fonts';

/** Searchable font dropdown; every option is drawn in its own typeface. */
export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadFontFamily(value);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const inside = (t: EventTarget | null) =>
      !!t && (pop.current?.contains(t as Node) || btn.current?.contains(t as Node));
    const onDown = (e: PointerEvent) => !inside(e.target) && setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onScroll = (e: Event) => !inside(e.target) && setOpen(false);
    const onResize = () => setOpen(false);
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    pop.current?.querySelector('.font-opt.on')?.scrollIntoView({ block: 'center' });
  }, [open]);

  const toggle = () => {
    if (!open) {
      setRect(btn.current!.getBoundingClientRect());
      setQuery('');
      void loadAllFonts();
    }
    setOpen(!open);
  };

  const pick = (family: string) => {
    onChange(family);
    setOpen(false);
  };

  const q = query.trim().toLowerCase();
  const groups = FONT_CATEGORIES.map((cat) => ({
    cat,
    fonts: FONT_CATALOG.filter(
      (f) => f.category === cat && (!q || f.family.toLowerCase().includes(q) || cat.toLowerCase().includes(q)),
    ),
  })).filter((g) => g.fonts.length);

  let style: React.CSSProperties = {};
  if (rect) {
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const up = below < 280 && above > below;
    style = {
      left: rect.left,
      width: Math.max(rect.width, 240),
      maxHeight: Math.min(440, up ? above : below),
      ...(up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
    };
  }

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`font-btn ${open ? 'open' : ''}`}
        onClick={toggle}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span style={{ fontFamily: `"${value}", var(--font-ui)` }}>{value}</span>
        <ChevronDown size={13} />
      </button>
      {open &&
        rect &&
        createPortal(
          <div ref={pop} className="font-pop" style={style} role="listbox" aria-label="Fonts">
            <div className="font-search">
              <Search size={13} />
              <input
                autoFocus
                value={query}
                spellCheck={false}
                placeholder={`Search ${FONT_CATALOG.length} fonts`}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && groups[0]) pick(groups[0].fonts[0].family);
                }}
              />
            </div>
            <div className="font-list">
              {groups.map((g) => (
                <div key={g.cat}>
                  <div className="font-cat">
                    <span>{g.cat}</span>
                    <span>{String(g.fonts.length).padStart(2, '0')}</span>
                  </div>
                  {g.fonts.map((f) => (
                    <button
                      key={f.family}
                      type="button"
                      role="option"
                      aria-selected={f.family === value}
                      className={`font-opt ${f.family === value ? 'on' : ''}`}
                      onClick={() => pick(f.family)}
                    >
                      <span style={{ fontFamily: `"${f.family}", var(--font-ui)` }}>{f.family}</span>
                      {f.family === value ? (
                        <Check size={13} />
                      ) : (
                        <span className="font-w">{f.weights.length > 1 ? `${f.weights.length}W` : '1W'}</span>
                      )}
                    </button>
                  ))}
                </div>
              ))}
              {!groups.length && <div className="font-empty">No fonts match “{query}”</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
