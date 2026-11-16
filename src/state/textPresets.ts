import type { TextStyle } from './types';

export const FONTS = [
  'Space Grotesk',
  'Inter',
  'JetBrains Mono',
  'Orbitron',
  'Bebas Neue',
  'Playfair Display',
  'Permanent Marker',
];

export const BASE_TEXT: TextStyle = {
  content: 'Your text',
  font: 'Space Grotesk',
  weight: 700,
  size: 96,
  color: '#ffffff',
  fillOpacity: 1,
  align: 'center',
  letterSpacing: 0,
  lineHeight: 1.15,
  italic: false,
  uppercase: false,
  bg: '#000000',
  bgOpacity: 0,
  bgPadding: 24,
  bgRadius: 8,
  stroke: '#000000',
  strokeWidth: 0,
  glow: 0,
  glowColor: '#c8ff2e',
  anim: 'none',
};

export interface TextPreset {
  id: string;
  label: string;
  tag: string;
  style: Partial<TextStyle>;
  x?: number;
  y?: number;
  duration?: number;
}

export const TEXT_PRESETS: TextPreset[] = [
  {
    id: 'headline',
    label: 'Headline',
    tag: 'H1',
    style: { content: 'HEADLINE', size: 150, weight: 700, letterSpacing: -2 },
  },
  {
    id: 'subtitle',
    label: 'Subtitle',
    tag: 'SUB',
    style: { content: 'Subtitle goes here', size: 54, weight: 500, bgOpacity: 0.6, bgPadding: 18, bgRadius: 6 },
    y: 0.86,
  },
  {
    id: 'lower',
    label: 'Lower third',
    tag: 'L3',
    style: {
      content: 'JANE DOE\nDirector of Photography',
      size: 52,
      weight: 600,
      align: 'left',
      bg: '#c8ff2e',
      bgOpacity: 1,
      color: '#050608',
      bgPadding: 26,
      bgRadius: 2,
      lineHeight: 1.25,
    },
    x: 0.24,
    y: 0.8,
  },
  {
    id: 'neon',
    label: 'Neon',
    tag: 'GLW',
    style: { content: 'NEON NIGHTS', font: 'Orbitron', size: 110, weight: 700, color: '#2ef2ff', glow: 40, glowColor: '#2ef2ff' },
  },
  {
    id: 'glitch',
    label: 'Glitch',
    tag: 'ERR',
    style: { content: 'SIGNAL_LOST', font: 'JetBrains Mono', size: 120, weight: 800, anim: 'glitch' },
  },
  {
    id: 'type',
    label: 'Terminal',
    tag: '>_',
    style: {
      content: '> booting sequence...',
      font: 'JetBrains Mono',
      size: 64,
      weight: 500,
      color: '#c8ff2e',
      anim: 'typewriter',
      bg: '#000000',
      bgOpacity: 0.75,
      bgPadding: 28,
      bgRadius: 4,
    },
  },
  {
    id: 'poster',
    label: 'Poster',
    tag: 'BBS',
    style: { content: 'BIG STATEMENT', font: 'Bebas Neue', size: 220, weight: 400, letterSpacing: 6, anim: 'pop' },
  },
  {
    id: 'outline',
    label: 'Outline',
    tag: 'OUT',
    style: { content: 'OUTLINE', size: 170, weight: 700, color: '#ffffff', fillOpacity: 0, stroke: '#ffffff', strokeWidth: 4 },
  },
  {
    id: 'serif',
    label: 'Editorial',
    tag: 'SRF',
    style: { content: 'A story in motion', font: 'Playfair Display', size: 110, weight: 600, italic: true, anim: 'slide' },
  },
  {
    id: 'marker',
    label: 'Marker',
    tag: 'MKR',
    style: { content: 'hand-made', font: 'Permanent Marker', size: 120, weight: 400, color: '#ff2e88', anim: 'pop' },
  },
];
