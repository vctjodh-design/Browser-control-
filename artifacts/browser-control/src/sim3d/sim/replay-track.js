// Reading an Open Football recording.
//
// The engine writes each entity's position as `[t, x, y, z]` with `t` in
// milliseconds of match time, `x`/`y` in centimetres on an 840 x 545 grid whose
// origin sits at a corner, and `z` in centimetres above the turf. This module
// turns that into the pitch's own metres — and does it arithmetically so it can
// be tested without a renderer.
import { PITCH } from '../config.js';

/** Engine centimetres to pitch metres, centred on the halfway line. */
export function toPitch(sample, out) {
  out.set(sample[1] / 100 - PITCH.halfLength, 0, sample[2] / 100 - PITCH.halfWidth);
  return out;
}

/**
 * Position at a moment in the recording, interpolated between samples.
 *
 * `cursor` is a per-track index the caller keeps, so walking forward through a
 * match costs O(1) per frame instead of scanning the track; seeking backwards
 * still works, it just walks back to find the window.
 */
export function sampleAt(track, milliseconds, cursor) {
  if (!track || track.length === 0) return null;
  let index = Math.min(cursor.index, track.length - 1);
  while (index > 0 && track[index][0] > milliseconds) index -= 1;
  while (index + 1 < track.length && track[index + 1][0] <= milliseconds) index += 1;
  cursor.index = index;

  const current = track[index];
  const next = track[index + 1];
  if (!next) return current;
  const span = next[0] - current[0];
  const t = span > 0 ? Math.min(1, Math.max(0, (milliseconds - current[0]) / span)) : 0;
  return [
    milliseconds,
    current[1] + (next[1] - current[1]) * t,
    current[2] + (next[2] - current[2]) * t,
    current[3] + (next[3] - current[3]) * t,
  ];
}
