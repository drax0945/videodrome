import { useSyncExternalStore } from 'react';
import { engine } from './engine';

export function usePlayhead() {
  return useSyncExternalStore(engine.subscribe, engine.getTime);
}

export function usePlaying() {
  return useSyncExternalStore(engine.subscribe, engine.isPlaying);
}

let renderTick = 0;
engine.subscribeRender(() => {
  renderTick++;
});
const getRenderTick = () => renderTick;

/** Re-render on every drawn frame (used by the on-canvas transform overlay). */
export function useRenderTick() {
  return useSyncExternalStore(engine.subscribeRender, getRenderTick);
}
