import { Suspense, lazy, useEffect, useRef, useState } from 'react';
import { CircleCheck, Info, TriangleAlert } from 'lucide-react';
import { TopBar } from './components/TopBar';
import { SideRail } from './components/SideRail';
import { MediaPanel } from './components/panels/MediaPanel';
import { TextPanel } from './components/panels/TextPanel';
import { CanvasPanel, KeysPanel } from './components/panels/CanvasPanel';
import { Preview } from './components/Preview';
import { Inspector } from './components/Inspector';
import { Timeline, zoomBy } from './components/timeline/Timeline';
import { deleteClip, duplicateClip, getDuration, redo, selectClip, splitAt, toast, undo, updateClip, useEditor } from './state/store';
import { engine } from './engine/engine';
import { importFiles } from './engine/media';
import { ASPECTS, FPS, isEditableTarget } from './lib/util';
import { hasUnsavedWork, initPersistence } from './state/persist';

// the encoder toolkit is heavy — only load it when someone opens Export
const ExportDialog = lazy(() => import('./components/ExportDialog').then((m) => ({ default: m.ExportDialog })));

export function App() {
  const tab = useEditor((s) => s.leftTab);
  const exportOpen = useEditor((s) => s.exportOpen);
  const appRef = useRef<HTMLDivElement>(null);
  const [dropActive, setDropActive] = useState(false);
  const [tlHeight, setTlHeight] = useState(() => Math.round(Math.max(240, Math.min(360, window.innerHeight * 0.34))));
  const [resizing, setResizing] = useState(false);

  useKeyboard();

  useEffect(() => {
    void initPersistence();
  }, []);

  /* drop files anywhere to import; over the timeline also places them */
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDropActive(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) setDropActive(false);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDropActive(false);
      const onTimeline = !!(e.target as HTMLElement | null)?.closest?.('.timeline');
      importFiles(e.dataTransfer!.files, { addToTimeline: onTimeline, playhead: () => engine.time });
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  /* work is autosaved — only warn if a write is still in flight */
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedWork()) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, []);

  const startResize = (e: React.PointerEvent) => {
    const y0 = e.clientY;
    const h0 = tlHeight;
    setResizing(true);
    const move = (ev: PointerEvent) => {
      setTlHeight(Math.max(170, Math.min(window.innerHeight - 320, h0 - (ev.clientY - y0))));
    };
    const up = () => {
      setResizing(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      ref={appRef}
      className={`app ${dropActive ? 'drop-active' : ''} ${resizing ? 'resizing' : ''}`}
      style={{ ['--tl-h' as string]: `${tlHeight}px` }}
    >
      <TopBar />
      <SideRail />
      <aside className="panel">
        {tab === 'media' && <MediaPanel />}
        {tab === 'text' && <TextPanel />}
        {tab === 'canvas' && <CanvasPanel />}
        {tab === 'keys' && <KeysPanel />}
      </aside>
      <Preview />
      <Inspector />
      <div className={`splitter ${resizing ? 'on' : ''}`} onPointerDown={startResize} />
      <Timeline />
      {exportOpen && (
        <Suspense fallback={null}>
          <ExportDialog />
        </Suspense>
      )}
      <Toasts />
    </div>
  );
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.kind === 'error' ? (
            <TriangleAlert size={15} color="var(--red)" />
          ) : t.kind === 'success' ? (
            <CircleCheck size={15} color="var(--cyan)" />
          ) : (
            <Info size={15} color="var(--accent)" />
          )}
          {t.message}
        </div>
      ))}
    </div>
  );
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isEditableTarget(e.target)) return;
      const s = useEditor.getState();
      if (s.exportOpen) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      const sel = s.clips.find((c) => c.id === s.selectedId);

      if (e.code === 'Space') {
        e.preventDefault();
        engine.toggle();
      } else if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        if (sel) duplicateClip(sel.id);
      } else if (!mod && key === 's') {
        if (!splitAt(engine.time)) toast('Move the playhead over a clip to split it');
      } else if (key === 'delete' || key === 'backspace') {
        if (sel) {
          e.preventDefault();
          deleteClip(sel.id, e.shiftKey);
        }
      } else if (key === 'escape') {
        selectClip(null);
      } else if (e.altKey && sel && sel.type !== 'audio' && key.startsWith('arrow')) {
        e.preventDefault();
        const { w, h } = ASPECTS[s.aspect];
        const step = e.shiftKey ? 10 : 1;
        const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
        const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
        updateClip(sel.id, { x: sel.x + dx / w, y: sel.y + dy / h }, `${sel.id}:nudge`);
      } else if (key === 'arrowleft' || key === 'arrowright') {
        e.preventDefault();
        const dir = key === 'arrowleft' ? -1 : 1;
        engine.seek(engine.time + dir * (e.shiftKey ? 1 : 1 / FPS));
      } else if (key === 'home') {
        engine.seek(0);
      } else if (key === 'end') {
        engine.seek(getDuration());
      } else if (!mod && (key === '+' || key === '=')) {
        zoomBy(1.4);
      } else if (!mod && (key === '-' || key === '_')) {
        zoomBy(1 / 1.4);
      } else if (e.shiftKey && key === 'z') {
        window.dispatchEvent(new CustomEvent('vd:fit'));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
