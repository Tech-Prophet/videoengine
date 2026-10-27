// Burned-in captions. Rules used (common practice for readable video captions):
//  - Bold type, about 5% of the frame height, white on a dark rounded box, so they stay readable on any picture.
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
  const tw = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const bw = tw + size * 1.1, bh = lines.length * lh + size * 0.5, r = size * 0.38;
  const x = w / 2 - bw / 2, y = cy - bh / 2;
  ctx.fillStyle = "rgba(0,0,0,0.72)";
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + bw, y, x + bw, y + bh, r); ctx.arcTo(x + bw, y + bh, x, y + bh, r);
  ctx.arcTo(x, y + bh, x, y, r); ctx.arcTo(x, y, x + bw, y, r); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 4 * u;
  lines.forEach((l, k) => ctx.fillText(l, w / 2, cy + (k - (lines.length - 1) / 2) * lh));
  ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
}
