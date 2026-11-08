// Drifting fire embers drawn over the picture for the whole video, so it looks as if it is smouldering a little.
//
// Rules used:
//  - Every ember's position depends only on the video time, so the preview, a scrub and the recorded file all match exactly.
//  - Embers are drawn with additive light ("lighter"), so they glow on dark and bright pictures alike and need no transparent video.
//  - They rise slowly, sway sideways, flicker, and fade in and out. Orange when new, deep red as they die.
//  - They thin out and fade across the bottom band, where the captions sit, so the words stay easy to read.
//  - They fade in gently over the first second and are left out over the end screen.

export type EmberLevel = "off" | "subtle" | "strong";
export const isEmberLevel = (v: unknown): v is EmberLevel => v === "off" || v === "subtle" || v === "strong";

const COUNT = 56; // embers alive at once at full strength (kept small so a phone can draw them 30 times a second)
const STRENGTH: Record<EmberLevel, { alpha: number; share: number }> = {
  off: { alpha: 0, share: 0 },
  subtle: { alpha: 0.55, share: 0.6 }, // how bright, and what share of the embers are shown
  strong: { alpha: 0.95, share: 1 },
};

type Ember = { x: number; phase: number; life: number; size: number; sway: number; swaySpeed: number; flicker: number };
// Fixed traits for each ember, made once from a fixed seed, so the same video always has the same embers.
const EMBERS: Ember[] = (() => {
  let seed = 20260;
  const r = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: COUNT }, () => ({
    x: r(), phase: r() * 40, life: 7 + r() * 7, size: 1.2 + r() * 2.6,
    sway: 0.015 + r() * 0.035, swaySpeed: 0.4 + r() * 1.2, flicker: 2 + r() * 5,
  }));
})();

const SAFE_BAND = 0.22; // share of the frame height, from the bottom, that is kept mostly clear for captions

// t = seconds since the video (or the promo passage) started. The end of the video fades to black in drawFrame, which also fades the embers.
export function drawEmbers(ctx: CanvasRenderingContext2D, w: number, h: number, t: number, level: EmberLevel) {
  const s = STRENGTH[level];
  if (!s.alpha || t < 0) return;
  const u = Math.min(w, h) / 1080;
  const intro = Math.min(1, t / 1.2);
  const shown = Math.round(COUNT * s.share);
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (let k = 0; k < shown; k++) {
    const e = EMBERS[k];
    const p = ((t + e.phase) % e.life) / e.life; // 0 when it appears, 1 when it is gone
    const x = (e.x + Math.sin(t * e.swaySpeed + e.phase) * e.sway) * w;
    const y = h * (1.04 - p * 1.1);
    let a = Math.sin(Math.PI * p) * (0.7 + 0.3 * Math.sin(t * e.flicker + e.phase));
    const fromBottom = 1 - y / h;
    if (fromBottom < SAFE_BAND) a *= Math.max(0, fromBottom) / SAFE_BAND * 0.6; // stays faint over the captions
    a *= s.alpha * intro;
    if (a < 0.02) continue;
    const r = e.size * u * (1 - p * 0.4) * 3.2;
    const g = Math.round(165 - p * 105);
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(255,${g},50,${a.toFixed(3)})`);
    grad.addColorStop(0.35, `rgba(255,${Math.round(g * 0.6)},20,${(a * 0.45).toFixed(3)})`);
    grad.addColorStop(1, "rgba(255,60,0,0)");
    ctx.fillStyle = grad;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.restore();
}
