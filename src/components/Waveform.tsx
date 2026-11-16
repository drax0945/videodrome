import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { PEAKS_PER_SEC } from '../lib/util';

/** Draws a slice [from, to] (source seconds) of a peaks array, sized to its CSS box. */
export function Waveform(props: {
  peaks?: Float32Array;
  from: number;
  to: number;
  color: string;
  align?: 'center' | 'bottom';
  className?: string;
  bar?: number;
}) {
  const { peaks, from, to, color, align = 'center', className, bar = 3 } = props;
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      setSize((s) => (Math.abs(s.w - width) > 0.5 || Math.abs(s.h - height) > 0.5 ? { w: width, h: height } : s));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c || !peaks || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    const scale = Math.min(dpr, 8192 / size.w);
    c.width = Math.max(1, Math.round(size.w * scale));
    c.height = Math.max(1, Math.round(size.h * dpr));
    const ctx = c.getContext('2d')!;
    ctx.setTransform(scale, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = color;
    const n = Math.max(1, Math.floor(size.w / bar));
    const span = Math.max(0.001, to - from);
    for (let i = 0; i < n; i++) {
      const a = Math.floor((from + (i / n) * span) * PEAKS_PER_SEC);
      const b = Math.max(a + 1, Math.floor((from + ((i + 1) / n) * span) * PEAKS_PER_SEC));
      let m = 0;
      for (let j = a; j < b && j < peaks.length; j++) if (peaks[j] > m) m = peaks[j];
      const bh = Math.max(1, m * (align === 'center' ? size.h * 0.86 : size.h * 0.95));
      const x = i * bar;
      const y = align === 'center' ? (size.h - bh) / 2 : size.h - bh;
      ctx.fillRect(x, y, Math.max(1, bar - 1), bh);
    }
  }, [peaks, from, to, color, align, size, bar]);

  return <canvas ref={ref} className={className} style={{ width: '100%', height: '100%', display: 'block' }} />;
}
