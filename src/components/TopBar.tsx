import { useState } from 'react';
import { Check, Download, FilePlus2, HardDrive, LoaderCircle, Redo2, TriangleAlert, Undo2, X } from 'lucide-react';
import { redo, undo, useEditor } from '../state/store';
import { newProject, usePersist } from '../state/persist';
import { ASPECTS, FPS, timecode } from '../lib/util';
import { projectDuration } from '../state/timeline';
import { IconButton } from './ui/controls';

export function TopBar() {
  const name = useEditor((s) => s.projectName);
  const aspect = useEditor((s) => s.aspect);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const duration = useEditor((s) => projectDuration(s.clips));
  const exportOpen = useEditor((s) => s.exportOpen);
  const { w, h } = ASPECTS[aspect];

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-name">VIDEODROME</span>
        <span className="brand-tag">NLE/0.1</span>
      </div>

      <div className="project-name">
        <IconButton tip="Undo  ⌘Z" onClick={undo} disabled={!canUndo}>
          <Undo2 size={16} />
        </IconButton>
        <input
          value={name}
          spellCheck={false}
          onChange={(e) => useEditor.setState({ projectName: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          aria-label="Project name"
        />
        <IconButton tip="Redo  ⇧⌘Z" onClick={redo} disabled={!canRedo}>
          <Redo2 size={16} />
        </IconButton>
        <SaveIndicator />
      </div>

      <div className="top-right">
        <div className="status-chip">
          <span className={`dot ${exportOpen ? 'live' : ''}`} />
          <span>
            {w}×{h}
          </span>
          <span style={{ color: 'var(--faint)' }}>/</span>
          <span>{FPS}FPS</span>
          <span style={{ color: 'var(--faint)' }}>/</span>
          <span>{timecode(duration).slice(3)}</span>
        </div>
        <NewProjectButton />
        <button
          className="btn primary"
          disabled={duration <= 0}
          onClick={() => useEditor.setState({ exportOpen: true })}
        >
          <Download size={15} strokeWidth={2.2} />
          Export
        </button>
      </div>
    </header>
  );
}

function SaveIndicator() {
  const status = usePersist((s) => s.status);
  const savedAt = usePersist((s) => s.savedAt);
  const time = savedAt ? new Date(savedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  const view =
    status === 'saving' || status === 'restoring'
      ? { icon: <LoaderCircle size={11} className="spin" />, text: status === 'saving' ? 'SAVING' : 'LOADING', cls: '' }
      : status === 'error'
        ? { icon: <TriangleAlert size={11} />, text: 'NOT SAVED', cls: 'err' }
        : status === 'saved'
          ? { icon: <Check size={11} strokeWidth={2.5} />, text: `SAVED ${time}`, cls: 'ok' }
          : { icon: <HardDrive size={11} />, text: 'LOCAL', cls: '' };
  return (
    <span className={`save-ind ${view.cls}`} data-tip="Autosaved to this browser" title="">
      {view.icon}
      {view.text}
    </span>
  );
}

function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const hasWork = useEditor((s) => s.clips.length > 0 || s.media.length > 0);
  const start = () => {
    if (!hasWork) return;
    setOpen(true);
  };
  return (
    <>
      <IconButton tip="New project" onClick={start} disabled={!hasWork}>
        <FilePlus2 size={16} />
      </IconButton>
      {open && (
        <div className="modal-bg" onPointerDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="modal" role="alertdialog" aria-label="Start a new project" style={{ width: 400 }}>
            <div className="modal-head">
              <div>
                <div className="label" style={{ marginBottom: 4 }}>
                  NEW SEQUENCE
                </div>
                <h3>Start a new project?</h3>
              </div>
              <button className="icon-btn" onClick={() => setOpen(false)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="info-line">
                This clears the current timeline and every imported file from this browser’s storage. It can’t be
                undone — export anything you want to keep first.
              </div>
            </div>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  setOpen(false);
                  void newProject();
                }}
              >
                Clear &amp; start new
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
