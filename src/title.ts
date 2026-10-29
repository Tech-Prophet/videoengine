// Big title text for the opening and the ending. Style follows the thumbnail: heavy letters, thick black outline,
// centred, capitals. Colours are mixed: wrap words in *stars* to use the accent colour (THE *BEE*); with no stars,
// the last word gets the accent colour. Plain canvas text only, so it costs almost nothing to draw.

type Tok = { t: string; a: boolean };

export function titleTokens(text: string): Tok[] {
  const raw = text.trim();
  const toks: Tok[] = [];
  if (raw.includes("*")) {
    raw.split("*").forEach((seg, i) => seg.split(/\s+/).filter(Boolean).forEach((t) => toks.push({ t: t.toUpperCase(), a: i % 2 === 1 })));
  } else {
    const ws = raw.split(/\s+/).filter(Boolean);
    ws.forEach((t, i) => toks.push({ t: t.toUpperCase(), a: ws.length > 1 && i === ws.length - 1 }));
  }
  return toks;
}

export function drawTitle(ctx: CanvasRenderingContext2D, w: number, text: string, o: { size: number; cy: number; color: string; accent: string; family: string; alpha: number }) {
  const toks = titleTokens(text);
  if (!toks.length) return;
  ctx.save();
  ctx.globalAlpha = o.alpha;
  ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
  const maxW = w * 0.86;
  let size = o.size, lines: Tok[][] = [];
  for (let pass = 0; pass < 8; pass++) { // shrink a long title a little so it stays within two lines
    ctx.font = `900 ${size}px ${o.family}`;
    const sp = ctx.measureText(" ").width;
    lines = []; let cur: Tok[] = [], cw = 0;
    for (const k of toks) {
      const kw = ctx.measureText(k.t).width;
      if (cur.length && cw + sp + kw > maxW) { lines.push(cur); cur = []; cw = 0; }
      cw += (cur.length ? sp : 0) + kw; cur.push(k);
    }
    if (cur.length) lines.push(cur);
    if (lines.length <= 2 || size < o.size * 0.55) break;
    size *= 0.9;
  }
  const sp = ctx.measureText(" ").width, lh = size * 1.12;
  ctx.lineWidth = size * 0.1; ctx.strokeStyle = "#000";
  lines.slice(0, 4).forEach((ln, i) => {
    const widths = ln.map((k) => ctx.measureText(k.t).width);
    let x = (w - (widths.reduce((a, b) => a + b, 0) + sp * (ln.length - 1))) / 2;
    const y = o.cy + (i - (Math.min(lines.length, 4) - 1) / 2) * lh;
    ln.forEach((k, j) => {
      ctx.fillStyle = k.a ? o.accent : o.color;
      ctx.strokeText(k.t, x, y); ctx.fillText(k.t, x, y);
      x += widths[j] + sp;
    });
  });
  ctx.restore();
}
