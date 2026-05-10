/**
 * Butterchurn Visualizer — full integration
 * Features:
 *   - Butterchurn MilkDrop WebGL visualizer
 *   - 3 preset switching modes:
 *       1. BPM Scheduled (web-audio-beat-detector)
 *       2. Volume-Reactive Beat (AnalyserNode)
 *       3. Fixed Interval (simple timer)
 *   - Shuffled deck of all presets, no immediate repeats
 *   - MediaRecorder canvas+audio → .webm video export
 *   - Adaptive RMS volume gate for reactive mode
 */

import butterchurn from 'butterchurn';
import butterchurnPresets from 'butterchurn-presets';
import { guess } from 'web-audio-beat-detector';

// ─── Elements ──────────────────────────────────────────────
const fileInput       = document.getElementById('audioFile');
const startBtn        = document.getElementById('startBtn');
const recordBtn       = document.getElementById('recordBtn');
const downloadLink    = document.getElementById('downloadLink');
const canvas          = document.getElementById('visCanvas');
const preview         = document.getElementById('preview');
const blendTimeInput  = document.getElementById('blendTime');
const blendTimeLabel  = document.getElementById('blendTimeLabel');
const beatsPerChange  = document.getElementById('beatsPerChange');
const switchModeEl    = document.getElementById('switchMode');
const intervalInput   = document.getElementById('intervalMs');
const intervalLabel   = document.getElementById('intervalLabel');
const statusEl        = document.getElementById('status');

blendTimeInput.addEventListener('input', () => {
  blendTimeLabel.textContent = blendTimeInput.value + 's';
});
intervalInput.addEventListener('input', () => {
  intervalLabel.textContent = intervalInput.value + 's';
});

// ─── State ─────────────────────────────────────────────────
let audioContext;
let visualizer;
let audioBufferSource;
let gainNode;
let visualizerAudioDest; // MediaStreamDestination for recording
let analyser;
let timeData;
let freqData;
let animationFrameId;
let mediaRecorder;
let recordedChunks = [];
let isRecording = false;

// Preset deck
const allPresets = butterchurnPresets.getPresets();
const allPresetNames = Object.keys(allPresets);
let presetDeck = [];
let currentPresetName = null;

// Timers / loops
let presetTimeouts = [];
let presetIntervalId = null;
let beatLoopId = null;
let lastSwitchTime = 0;
let energyHistory = [];
let rmsHistory = [];

// ─── Audio Setup ───────────────────────────────────────────
async function initAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') await audioContext.resume();
}

async function decodeFile(file) {
  await initAudioContext();
  const arrayBuffer = await file.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}

// ─── Visualizer Setup ──────────────────────────────────────
function createVisualizer() {
  if (visualizer) return;

  visualizer = butterchurn.createVisualizer(audioContext, canvas, {
    width: canvas.width,
    height: canvas.height,
    pixelRatio: window.devicePixelRatio || 1,
    textureRatio: 1,
  });

  // Shared gain node: feeds speakers + visualizer + recorder
  gainNode = audioContext.createGain();
  gainNode.connect(audioContext.destination);

  // MediaStreamDestination for recording audio
  visualizerAudioDest = audioContext.createMediaStreamDestination();
  gainNode.connect(visualizerAudioDest);

  // AnalyserNode for beat/volume detection
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;
  gainNode.connect(analyser);
  timeData = new Uint8Array(analyser.fftSize);
  freqData = new Uint8Array(analyser.frequencyBinCount);

  visualizer.connectAudio(gainNode);
}

// ─── Render Loop ───────────────────────────────────────────
function startRenderLoop() {
  function render() {
    visualizer.render();
    animationFrameId = requestAnimationFrame(render);
  }
  render();
}

function stopRenderLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
  }
}

// ─── Preset Deck ───────────────────────────────────────────
function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function refillDeck() {
  presetDeck = shuffleArray(allPresetNames);
  if (presetDeck.length > 1 && presetDeck[0] === currentPresetName) {
    [presetDeck[0], presetDeck[1]] = [presetDeck[1], presetDeck[0]];
  }
}

function loadNextPreset(blendSeconds = 2.5) {
  if (presetDeck.length === 0) refillDeck();
  currentPresetName = presetDeck.shift();
  const preset = allPresets[currentPresetName];
  visualizer.loadPreset(preset, blendSeconds);
  setStatus('Preset: ' + currentPresetName);
}

// ─── Preset Switching Modes ────────────────────────────────

// 1. BPM Scheduled
function scheduleBpmPresets({ bpm, offset = 0, duration, beatsPerSwitch, blend }) {
  clearAllPresetSchedules();
  const secPerBeat = 60 / bpm;
  const interval = secPerBeat * beatsPerSwitch;

  loadNextPreset(0.0);

  for (let t = offset + interval; t < duration; t += interval) {
    const id = setTimeout(() => loadNextPreset(blend), t * 1000);
    presetTimeouts.push(id);
  }
}

// 2. Fixed Interval
function startFixedInterval({ intervalMs, blend }) {
  clearAllPresetSchedules();
  loadNextPreset(0.0);
  presetIntervalId = setInterval(() => loadNextPreset(blend), intervalMs);
}

// 3. Volume-Reactive Beat Detection
function getRms() {
  analyser.getByteTimeDomainData(timeData);
  let sum = 0;
  for (let i = 0; i < timeData.length; i++) {
    const n = (timeData[i] - 128) / 128;
    sum += n * n;
  }
  return Math.sqrt(sum / timeData.length);
}

function getLowBandEnergy() {
  analyser.getByteFrequencyData(freqData);
  const bins = Math.min(24, freqData.length);
  let sum = 0;
  for (let i = 0; i < bins; i++) sum += freqData[i];
  return sum / bins;
}

function getAdaptiveRmsGate(rms, multiplier = 1.15, floor = 0.05) {
  rmsHistory.push(rms);
  if (rmsHistory.length > 60) rmsHistory.shift();
  const avg = rmsHistory.reduce((s, v) => s + v, 0) / rmsHistory.length;
  return Math.max(floor, avg * multiplier);
}

function startBeatReactiveMode({ cooldownMs = 10000, blend = 2.5, beatThreshold = 1.35 }) {
  clearAllPresetSchedules();
  energyHistory = [];
  rmsHistory = [];
  lastSwitchTime = 0;

  loadNextPreset(0.0);
  lastSwitchTime = performance.now();

  function tick() {
    const rms = getRms();
    const gate = getAdaptiveRmsGate(rms);
    const lowEnergy = getLowBandEnergy();

    energyHistory.push(lowEnergy);
    if (energyHistory.length > 43) energyHistory.shift();

    const avg = energyHistory.reduce((s, v) => s + v, 0) / energyHistory.length;
    const strongBeat = energyHistory.length > 10 && lowEnergy > avg * beatThreshold;
    const loudEnough = rms > gate;
    const cooled = performance.now() - lastSwitchTime > cooldownMs;

    if (strongBeat && loudEnough && cooled) {
      loadNextPreset(blend);
      lastSwitchTime = performance.now();
    }

    beatLoopId = requestAnimationFrame(tick);
  }

  tick();
}

function clearAllPresetSchedules() {
  presetTimeouts.forEach(id => clearTimeout(id));
  presetTimeouts = [];

  if (presetIntervalId) {
    clearInterval(presetIntervalId);
    presetIntervalId = null;
  }

  if (beatLoopId) {
    cancelAnimationFrame(beatLoopId);
    beatLoopId = null;
  }
}

// ─── Playback ──────────────────────────────────────────────
async function startPlayback() {
  const file = fileInput.files?.[0];
  if (!file) { alert('Select an audio file first'); return; }

  setStatus('Decoding audio...');

  const buffer = await decodeFile(file);

  if (audioBufferSource) {
    try { audioBufferSource.stop(); } catch (e) {}
  }

  createVisualizer();
  refillDeck();

  audioBufferSource = audioContext.createBufferSource();
  audioBufferSource.buffer = buffer;
  audioBufferSource.connect(gainNode);

  startRenderLoop();

  const blend = parseFloat(blendTimeInput.value);
  const mode = switchModeEl.value;

  if (mode === 'bpm') {
    setStatus('Analyzing BPM...');
    let bpm = 120, offset = 0;
    try {
      const result = await guess(buffer);
      bpm = result.bpm;
      offset = result.offset || 0;
      setStatus('BPM: ' + bpm.toFixed(1));
    } catch (e) {
      setStatus('BPM detection failed, using 120');
    }
    scheduleBpmPresets({
      bpm,
      offset,
      duration: buffer.duration,
      beatsPerSwitch: parseInt(beatsPerChange.value),
      blend,
    });
  } else if (mode === 'timed') {
    startFixedInterval({
      intervalMs: parseInt(intervalInput.value) * 1000,
      blend,
    });
  } else {
    startBeatReactiveMode({
      cooldownMs: 10000,
      blend,
      beatThreshold: 1.35,
    });
  }

  audioBufferSource.start(0);

  audioBufferSource.onended = () => {
    clearAllPresetSchedules();
    stopRenderLoop();
    stopRecording();
    setStatus('Done');
  };
}

// ─── Recording ─────────────────────────────────────────────
function startRecording() {
  if (!audioContext || !visualizerAudioDest) {
    alert('Start playback first');
    return;
  }
  if (isRecording) return;

  recordedChunks = [];
  downloadLink.style.display = 'none';

  const canvasStream = canvas.captureStream(60);
  const audioTrack = visualizerAudioDest.stream.getAudioTracks()[0];
  if (audioTrack) canvasStream.addTrack(audioTrack);

  let options = { mimeType: 'video/webm; codecs=vp9,opus' };
  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    options = { mimeType: 'video/webm' };
  }

  mediaRecorder = new MediaRecorder(canvasStream, options);

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: 'video/webm' });
    const url = URL.createObjectURL(blob);
    preview.src = url;
    downloadLink.href = url;
    downloadLink.style.display = 'inline-block';
    isRecording = false;
    recordBtn.textContent = '⏺ Start Recording';
    recordBtn.disabled = false;
    setStatus('Recording saved — click Download');
  };

  mediaRecorder.start();
  isRecording = true;
  recordBtn.textContent = '⏹ Recording...';
  recordBtn.disabled = true;
  setStatus('Recording...');
}

function stopRecording() {
  if (mediaRecorder && isRecording) {
    mediaRecorder.stop();
  }
}

// ─── Utility ───────────────────────────────────────────────
function setStatus(msg) {
  statusEl.textContent = msg;
  console.log('[butterchurn]', msg);
}

// ─── Events ────────────────────────────────────────────────
startBtn.addEventListener('click', () => startPlayback().catch(console.error));
recordBtn.addEventListener('click', startRecording);
