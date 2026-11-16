import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui-fonts';
import './styles.css';
import { App } from './App';

if (import.meta.env.DEV) {
  // handy for poking at the editor from devtools
  void Promise.all([import('./engine/engine'), import('./engine/media'), import('./state/store')]).then(([e, m, s]) => {
    Object.assign(window, { __vd: { engine: e.engine, importFiles: m.importFiles, store: s } });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
