# VIDEODROME

A browser-based, non-linear video editor built from scratch — React + TypeScript + Canvas 2D + Web Audio.
Dark, minimal, techno UI with a Clipchamp-style layout. Everything runs locally; nothing is uploaded.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build into dist/
```

Best in Chrome or Edge (canvas filters, `letterSpacing`, WebCodecs H.264/AAC encoding).

## Features

- **Media library** — import video, audio and images (button, drag-and-drop anywhere, or drop straight onto the timeline). Generates filmstrip thumbnails and waveforms locally.
- **Program monitor** — live canvas compositor with aspect presets (16:9, 9:16, 1:1, 4:5, 21:9), safe-area/thirds guides, fullscreen, and on-canvas move / scale / rotate handles with center & edge snapping.
- **Multi-track timeline** — unlimited overlay and audio tracks (top track renders on top), drag to move between tracks, drop on the dashed zones to create new tracks, trim with edge handles, split at playhead, ripple delete, duplicate, snapping, zoom (slider, ⌘/ctrl+scroll, fit), per-track hide/mute.
- **Text** — 10 styled presets (headline, lower third, neon, glitch, terminal typewriter, poster, outline…) and 37 fonts in a searchable picker (sans, display, tech, mono/pixel, serif, script), with weight, size, tracking, leading, fill, background, outline, glow and animations (typewriter, slide, pop, glitch).
- **Per-clip properties** — transform, opacity, fit/fill, colour looks + brightness/contrast/saturation/hue/blur/mono/sepia/invert, volume (up to +6 dB), mute, speed (0.1×–4×, pitch follows speed), fade in/out.
- **Undo / redo** for every edit.
- **Export** — frame-by-frame render with WebCodecs to MP4 (H.264 + AAC) or WebM (VP9 + Opus) at 480p / 720p / 1080p, 24/30/60 fps and three quality levels. Usually several times faster than real time, every frame exact, keeps going in a background tab. Browsers without WebCodecs fall back to a real-time `MediaRecorder` capture.

## Shortcuts

| Action | Keys |
| --- | --- |
| Play / pause | Space |
| Split | S |
| Delete / ripple delete | ⌫ / ⇧⌫ |
| Duplicate | ⌘D |
| Undo / redo | ⌘Z / ⇧⌘Z |
| Frame step / 1s jump | ← → / ⇧← ⇧→ |
| Start / end | Home / End |
| Zoom / fit | + − / ⇧Z |
| Nudge element | ⌥ + arrows |

## Architecture

```
src/
  state/      zustand store (tracks, clips, media, history), timeline maths, text presets,
              persist.ts – IndexedDB autosave / restore
  engine/     engine.ts  – clock, <video>/<audio> pool synced to the timeline, Web Audio mix, render loop
              render.ts  – canvas compositor (layout, filters, text + animations, hit-testing)
              media.ts   – import pipeline (metadata, thumbnails, waveform peaks)
              export.ts  – WebCodecs export: decodes source frames at exact timestamps, renders each
                           output frame, mixes audio offline, muxes with Mediabunny
              export-realtime.ts – MediaRecorder fallback for browsers without WebCodecs
  components/ TopBar, SideRail, panels/, Preview (monitor + transform overlay + transport),
              Inspector, timeline/ (Timeline, ClipItem), ExportDialog
```

## Fonts

Title fonts come from `@fontsource` packages and load on demand (only the picker or a title that uses them
downloads anything). To add one:

```bash
npm install @fontsource/<name>
```

Add it to the list in `scripts/gen-fonts.mjs`, then regenerate the catalog:

```bash
npm run fonts
```

## Autosave

Every change is saved to this browser's IndexedDB — the timeline, settings, playhead, and the imported files
themselves — so reloading or closing the tab picks up where you left off. The indicator next to the project name
shows the save state. **New project** (top right) clears storage and starts fresh. Undo history is not kept across
reloads, and projects don't sync between browsers or devices.
