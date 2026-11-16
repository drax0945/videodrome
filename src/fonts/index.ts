import { FONT_CATALOG, type FontCategory, type FontDef } from './catalog';

export { FONT_CATALOG };
export type { FontCategory, FontDef };

export const FONT_CATEGORIES: FontCategory[] = ['Sans', 'Display', 'Tech', 'Mono', 'Serif', 'Script'];

const byFamily = new Map(FONT_CATALOG.map((f) => [f.family, f]));
const loading = new Map<string, Promise<void>>();

export const fontDef = (family: string): FontDef | undefined => byFamily.get(family);

/** Register a family's @font-face rules (once). Font files still only download when text uses them. */
export function loadFontFamily(family: string): Promise<void> {
  let p = loading.get(family);
  if (!p) {
    const def = byFamily.get(family);
    p = def ? def.load().then(
        () => undefined,
        () => undefined,
      )
      : Promise.resolve();
    loading.set(family, p);
  }
  return p;
}

export function loadAllFonts() {
  return Promise.all(FONT_CATALOG.map((f) => loadFontFamily(f.family))).then(() => undefined);
}

/** Register the family, then wait until the exact face (weight/style/size) is usable on a canvas. */
export async function ensureFontFace(family: string, cssFont: string) {
  await loadFontFamily(family);
  await document.fonts.load(cssFont).catch(() => undefined);
}

/** Closest weight the family actually ships, so we don't fall back to faux bold. */
export function nearestWeight(family: string, weight: number) {
  const ws = byFamily.get(family)?.weights ?? [400, 700];
  return ws.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), ws[0]);
}
