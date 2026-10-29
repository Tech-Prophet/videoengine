// Camera motion and framing rules for the preview and export.
//
// Rules used (common practice for slow "Ken Burns" moves on stills):
//  - Zoom at most about 2.5% per second and pan at most about 2.5% of the frame width per second.
//  - Short shots move less, so speed stays the same instead of whipping through a small distance.
//  - Motion never stops dead: it runs through the whole dissolve into and out of a shot, with only a gentle ease.
//  - Pictures that do not match the frame shape are shown whole over a blurred copy, never cropped hard.

export type Move = [number, number, number, number, number, number]; // zoom from, zoom to, pan x from, pan x to, pan y from, pan y to (pan as a share of the spare room)
export const MOVES: Move[] = [
  [1.0, 1.1, 0, 0, 0, 0],
  [1.1, 1.0, 0, 0, 0, 0],
  [1.1, 1.1, 0.9, -0.9, 0, 0],
  [1.1, 1.1, -0.9, 0.9, 0, 0],
  [1.1, 1.1, 0, 0, -0.8, 0.8],
  [1.1, 1.1, 0, 0, 0.8, -0.8],
  [1.02, 1.1, 0.6, -0.6, -0.4, 0.4],
  [1.1, 1.02, -0.6, 0.6, 0.4, -0.4],
];
export const SEQ = [0, 2, 1, 3, 6, 4, 7, 5];
export const OPEN: Move = [1.0, 1.12, 0, 0, 0, 0];
export const CLOSE: Move = [1.12, 1.0, 0, 0, 0, 0];
export const STILL: Move = [1, 1, 0, 0, 0, 0];
export const moveFor = (si: number, k: number, open: boolean, close: boolean): Move => (open ? OPEN : close ? CLOSE : MOVES[SEQ[(si * 3 + k) % SEQ.length]]);

export const XFD = 0.5; // dissolve length between shots and between scenes, in seconds
// Mostly steady speed with a gentle start and finish.
export const ease = (p: number) => { const q = Math.max(0, Math.min(1, p)); return 0.6 * q + 0.4 * q * q * (3 - 2 * q); };
// Progress of a shot's motion. It starts when the dissolve into the shot starts and ends when the dissolve out of it ends.
// sl = seconds since the shot started (negative while it is still fading in), len = the shot's length.
export const motionP = (k: number, sl: number, len: number) => {
  const lead = k > 0 ? XFD : 0;
  return Math.max(0, Math.min(1, (sl + lead) / (len + lead + XFD)));
};
// The camera position at progress p. Video clips already move, so they get less added motion.
export const pose = (mv: Move | null, p: number, len: number, video: boolean) => {
  const c = mv ?? STILL, e = ease(p), g = (video ? 0.6 : 1) * Math.min(1, len / 5);
  return { z: 1 + (c[0] + (c[1] - c[0]) * e - 1) * g, px: (c[2] + (c[3] - c[2]) * e) * g, py: (c[4] + (c[5] - c[4]) * e) * g };
};

// A picture fills the frame (a light crop) only when its shape is close to the frame's shape. Otherwise it is shown whole.
export const FILL_MIN = 0.7;
export const fillsFrame = (mw: number, mh: number, fw: number, fh: number) => {
  const a = mw / mh, b = fw / fh;
  return Math.min(a / b, b / a) >= FILL_MIN;
};
