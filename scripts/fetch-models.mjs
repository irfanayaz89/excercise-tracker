#!/usr/bin/env node
// Downloads the MediaPipe Pose Landmarker models into the native module.
// Runs on postinstall; skips files that are already present and complete.
// Source: Google's official MediaPipe model bucket (Apache-2.0 models).
import { createWriteStream, existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'modules', 'pose-landmarker', 'models');
const BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
const MODELS = [
  { name: 'pose_landmarker_lite.task', url: `${BASE}/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`, bytes: 5777746 },
  { name: 'pose_landmarker_full.task', url: `${BASE}/pose_landmarker_full/float16/1/pose_landmarker_full.task`, bytes: 9398198 },
];

if (process.env.SKIP_MODEL_DOWNLOAD === '1') {
  console.log('[fetch-models] SKIP_MODEL_DOWNLOAD=1, skipping.');
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
let failed = false;
for (const m of MODELS) {
  const dest = join(outDir, m.name);
  if (existsSync(dest) && statSync(dest).size === m.bytes) {
    console.log(`[fetch-models] ${m.name} ok`);
    continue;
  }
  const tmp = `${dest}.part`;
  try {
    process.stdout.write(`[fetch-models] downloading ${m.name} (${(m.bytes / 1e6).toFixed(1)} MB)… `);
    const res = await fetch(m.url);
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
    const size = statSync(tmp).size;
    if (size !== m.bytes) throw new Error(`size ${size} != expected ${m.bytes}`);
    renameSync(tmp, dest);
    console.log('done');
  } catch (e) {
    failed = true;
    if (existsSync(tmp)) unlinkSync(tmp);
    console.log(`failed: ${e.message}`);
  }
}
if (failed) {
  // Do not break `npm install` offline; the app shows a clear error if a model is missing.
  console.warn('[fetch-models] Some models could not be downloaded. Run `npm run fetch-models` before building.');
}
