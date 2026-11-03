// The end screen of a Promo Short ("Big gold"): a darkened picture, a small white "WATCH THE", huge gold "FULL STORY",
// and two gold arrows that point down toward the related-video link YouTube shows under a Short.
// Plain canvas drawing only. All sizes scale with the width, and everything sits in the middle of the frame,
// clear of the buttons and caption YouTube puts over the bottom of a Short.

const ease = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

// p = seconds since the end screen began.
export function drawEndCard(ctx: CanvasRenderingContext2D, w: number, h: number, p: number, o: { accent: string; family: string }) {
  const u = w / 360;
  ctx.save();
  ctx.globalAlpha = Math.min(1, p / 0.3) * 0.62;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 1;
  ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round"; ctx.miterLimit = 2;

  const word = (text: string, cy: number, size: number, color: string, at: number, spacing: number) => {
    const k = ease((p - at) / 0.35);
    if (k <= 0) return;
    let s = size * u;
    ctx.font = `900 ${s}px ${o.family}`;
    ctx.letterSpacing = `${spacing * u}px`;
    const maxW = w * 0.88, mw = ctx.measureText(text).width;
    if (mw > maxW) { s *= maxW / mw; ctx.font = `900 ${s}px ${o.family}`; }
    const y = cy * h + (1 - k) * 14 * u;
    ctx.globalAlpha = k;
    ctx.lineWidth = s * 0.12; ctx.strokeStyle = "#000";
    ctx.strokeText(text, w / 2, y); ctx.fillStyle = color; ctx.fillText(text, w / 2, y);
    ctx.globalAlpha = 1;
  };
  word("WATCH THE", 0.30, 26, "#fff", 0.0, 4);
  word("FULL", 0.385, 76, o.accent, 0.2, 0);
  word("STORY", 0.495, 76, o.accent, 0.4, 0);
  ctx.letterSpacing = "0px";

  // Two arrows, lit one after the other, over and over.
  const kA = ease((p - 0.8) / 0.4);
  if (kA > 0) {
    const cx = w / 2, top = h * 0.625, step = 38 * u, hw = 35 * u, hh = 28 * u;
    for (let i = 0; i < 2; i++) {
      const lit = 0.45 + 0.55 * Math.max(0, Math.cos(((p * 1.6 - i * 0.28) % 1) * Math.PI * 2 - Math.PI)) ; // 0.45..1, a travelling pulse
      const y = top + i * step + Math.sin(p * 6) * 2 * u;
      ctx.beginPath(); ctx.moveTo(cx - hw, y); ctx.lineTo(cx, y + hh); ctx.lineTo(cx + hw, y);
      ctx.lineCap = "round";
      ctx.globalAlpha = kA; ctx.strokeStyle = "#000"; ctx.lineWidth = 18 * u; ctx.stroke();
      ctx.globalAlpha = kA * lit; ctx.strokeStyle = o.accent; ctx.lineWidth = 9 * u; ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
