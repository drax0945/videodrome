/** Custom drag-and-drop MIME types (the `kind-*` types exist so dragover can see the kind). */
export const DND = {
  media: 'application/x-vd-media',
  text: 'application/x-vd-text',
  visual: 'application/x-vd-kind-visual',
  audio: 'application/x-vd-kind-audio',
};

export function dragKind(dt: DataTransfer): 'visual' | 'audio' | null {
  if (dt.types.includes(DND.audio)) return 'audio';
  if (dt.types.includes(DND.visual)) return 'visual';
  return null;
}

/** The library item currently being dragged (dataTransfer contents are unreadable during dragover). */
export let libDrag: { media?: string; text?: string; kind: 'visual' | 'audio' } | null = null;

export function startLibraryDrag(e: React.DragEvent, data: { media?: string; text?: string }, kind: 'visual' | 'audio') {
  libDrag = { ...data, kind };
  if (data.media) e.dataTransfer.setData(DND.media, data.media);
  if (data.text) e.dataTransfer.setData(DND.text, data.text);
  e.dataTransfer.setData(kind === 'audio' ? DND.audio : DND.visual, '1');
  e.dataTransfer.effectAllowed = 'copy';
  document.body.classList.add('dragging-any');
  // deferred so drop handlers further down the tree still see `libDrag`
  const end = () =>
    setTimeout(() => {
      libDrag = null;
      document.body.classList.remove('dragging-any');
      window.removeEventListener('dragend', end, true);
      window.removeEventListener('drop', end, true);
    }, 0);
  window.addEventListener('dragend', end, true);
  window.addEventListener('drop', end, true);
}
