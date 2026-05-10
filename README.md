# Butterchurn Visualizer

A browser-based music visualizer using [Butterchurn](https://github.com/jberg/butterchurn) (WebGL MilkDrop) with three preset-switching modes, a shuffled preset deck, and video export via MediaRecorder.

## Features

- **MilkDrop-style WebGL visuals** via Butterchurn
- **3 preset switching modes:**
  - **BPM Scheduled** — analyzes the uploaded song with `web-audio-beat-detector`, then switches presets every N beats on a precise schedule
  - **Volume-Reactive Beat** — detects bass spikes in real time via `AnalyserNode`, switches only when a strong beat occurs and the volume is above an adaptive RMS threshold
  - **Fixed Interval** — switches presets every N seconds on a timer
- **Shuffled preset deck** — all ~100+ Butterchurn presets are shuffled so each plays once before any repeat
- **Smooth blending** — configurable blend time (0.5s–6s) between presets
- **MediaRecorder export** — records canvas + audio to `.webm` video, with a preview and download link

## Usage

### 1. Install dependencies

```bash
npm install
```

### 2. Start dev server

```bash
npm run dev
```

### 3. Open in browser

```
http://localhost:5173
```

### 4. Use the app

1. Upload an audio file (MP3, WAV, FLAC, etc.)
2. Choose a preset switching mode and adjust settings
3. Click **Play & Visualize**
4. Click **Start Recording** to capture a `.webm` video
5. When the track ends (or you stop manually), click **Download Video**

## Configuration

| Option | Description | Default |
|---|---|---|
| Beats per Preset Change | How many beats between preset switches (BPM mode) | 16 |
| Blend Time | Seconds to blend between presets | 2.5s |
| Switch Mode | BPM Scheduled / Volume-Reactive / Fixed Interval | BPM |
| Fixed Interval | Seconds between switches (Fixed mode) | 15s |

## Build

```bash
npm run build
```

Output goes to `dist/`.

## Dependencies

- [butterchurn](https://github.com/jberg/butterchurn) — WebGL MilkDrop visualizer
- [butterchurn-presets](https://github.com/jberg/butterchurn-presets) — preset pack
- [web-audio-beat-detector](https://github.com/chrisguttandin/web-audio-beat-detector) — BPM analysis
- [Vite](https://vitejs.dev) — build tool

## License

MIT
