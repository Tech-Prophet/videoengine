// Burned-in captions. Rules used (common practice for readable video captions):
//  - Bold type, about 5% of the frame height, white with a thin black outline and shadow (no box), so they stay readable on any picture.
//  - At most two or three short lines, centred, inside the safe area (for tall videos, above the app's buttons).
//  - Only the words being spoken now are shown.

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const t = cur ? `${cur} ${word}` : word;
    if (cur && ctx.measureText(t).width > maxW) { out.push(cur); cur = word; } else cur = t;
  }
  if (cur) out.push(cur);
  return out;
}

export function drawCaption(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  const wide = w > h, u = Math.min(w, h) / 1080, size = (wide ? 56 : 62) * u;
  ctx.font = `700 ${size}px Inter, system-ui, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const lines = wrapLines(ctx, text, w * 0.82);
  if (!lines.length) return;
  const lh = size * 1.28, cy = h * (wide ? 0.86 : 0.72);
  // No box: bold white letters with a thin black outline and a soft shadow, so they read on bright and dark pictures alike.
  ctx.lineJoin = "round"; ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(2, size * 0.06);
  ctx.strokeStyle = "rgba(0,0,0,0.92)";
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,.55)"; ctx.shadowBlur = 5 * u; ctx.shadowOffsetY = 2 * u;
  lines.forEach((l, k) => {
    const y = cy + (k - (lines.length - 1) / 2) * lh;
    ctx.strokeText(l, w / 2, y); ctx.fillText(l, w / 2, y);
  });
  ctx.shadowBlur = 0; ctx.shadowOffsetY = 0; ctx.shadowColor = "transparent";
}
