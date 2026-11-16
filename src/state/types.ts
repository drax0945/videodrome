export type MediaKind = 'video' | 'audio' | 'image';

export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  url: string;
  file: File;
  size: number;
  /** Source duration in seconds (0 for images). */
  duration: number;
  width: number;
  height: number;
  /** Filmstrip frames for video, evenly spaced across the source. */
  thumbnails: { time: number; url: string }[];
  poster?: string;
  /** Normalised peak amplitudes, PEAKS_PER_SEC buckets per second of source. */
  peaks?: Float32Array;
  status: 'processing' | 'ready' | 'error';
  progress: number;
  error?: string;
}

export type ClipType = 'video' | 'image' | 'audio' | 'text';
export type TrackKind = 'visual' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  hidden: boolean;
  muted: boolean;
  main?: boolean;
}

export interface Filters {
  brightness: number; // %
  contrast: number; // %
  saturate: number; // %
  hue: number; // deg
  blur: number; // px (project space)
  grayscale: number; // %
  sepia: number; // %
  invert: number; // %
}

export type TextAnim = 'none' | 'typewriter' | 'slide' | 'pop' | 'glitch';

export interface TextStyle {
  content: string;
  font: string;
  weight: number;
  size: number;
  color: string;
  fillOpacity: number;
  align: 'left' | 'center' | 'right';
  letterSpacing: number;
  lineHeight: number;
  italic: boolean;
  uppercase: boolean;
  bg: string;
  bgOpacity: number;
  bgPadding: number;
  bgRadius: number;
  stroke: string;
  strokeWidth: number;
  glow: number;
  glowColor: string;
  anim: TextAnim;
}

export interface Clip {
  id: string;
  type: ClipType;
  trackId: string;
  mediaId?: string;
  name: string;
  /** Position on the timeline (seconds). */
  start: number;
  /** Length on the timeline (seconds), already divided by speed. */
  duration: number;
  /** Offset into the source media (seconds). */
  trimStart: number;
  speed: number;
  /** Centre of the element as a fraction of the canvas. */
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  fit: 'contain' | 'cover';
  filters: Filters;
  filterPreset: string;
  fadeIn: number;
  fadeOut: number;
  volume: number;
  muted: boolean;
  text?: TextStyle;
}

export type AspectKey = '16:9' | '9:16' | '1:1' | '4:5' | '21:9';

export interface Toast {
  id: string;
  kind: 'info' | 'error' | 'success';
  message: string;
}
