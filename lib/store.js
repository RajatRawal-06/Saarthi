// Tiny JSON-file persistence in ./data (kept local; nothing leaves your machine
// except what you send to TinyFish to do the errand).
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.ERRAND_DATA_DIR || (process.env.VERCEL ? '/tmp/data' : 'data'));
try {
  fs.mkdirSync(path.join(DATA_DIR, 'shots'), { recursive: true });
} catch {
  // Ignore filesystem errors in serverless environments
}

export function readJSON(name, fallback) {
  try {
    const p = path.join(DATA_DIR, name);
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    const def = path.resolve('defaults', name);
    if (fs.existsSync(def)) return JSON.parse(fs.readFileSync(def, 'utf8'));
    return fallback;
  } catch {
    return fallback;
  }
}

export function writeJSON(name, value) {
  try {
    const file = path.join(DATA_DIR, name);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  } catch (err) {
    console.warn(`[store] writeJSON failed for ${name}:`, err.message);
  }
}
