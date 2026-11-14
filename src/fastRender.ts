// Faster-than-real-time export. Instead of recording the screen while it plays (which takes as long as the video), every
// frame is drawn one after another and handed to the browser's video encoder, and the sound is mixed in one go off-screen.
// Returns null when this browser cannot do it, and the caller then uses the normal recorder. Loaded only when a render starts.

export const fastRenderSupported = () =>
  typeof VideoEncoder !== "undefined" && typeof AudioEncoder !== "undefined" && typeof VideoFrame !== "undefined" && typeof OfflineAudioContext !== "undefined";

export type FastOpts = {
  canvas: HTMLCanvasElement;
  fps: number;
  from: number;
  total: number;
  bitrate: number;
  voiceUrl?: string;
  musicUrl?: string;
  /** Draw the picture for this moment (seeks any video clips first). */
  drawAt: (tt: number) => Promise<void>;
  /** Wanted loudness of the voice and the music at this moment (before smoothing). */
  targets: (tt: number) => [number, number];
  onProgress: (tt: number) => void;
  cancelled: () => boolean;
};

const SR = 48000;

async function mixAudio(o: FastOpts): Promise<AudioBuffer | null> {
  if (!o.voiceUrl && !o.musicUrl) return null;
  const dur = o.total - o.from;
  const oc = new OfflineAudioContext(2, Math.ceil(dur * SR), SR);
  const comp = oc.createDynamicsCompressor(); // same soft limiter as the live player
  comp.threshold.value = -3; comp.knee.value = 0; comp.ratio.value = 20; comp.attack.value = 0.003; comp.release.value = 0.15;
  comp.connect(oc.destination);
  // Gain curves, 100 per second, smoothed the way the live player does it (voice about 30 ms; music 80 ms down, 500 ms up).
  const n = Math.ceil(dur * 100) + 1;
  const vc = new Float32Array(n), mc = new Float32Array(n);
  let v = -1, m = -1;
  for (let k = 0; k < n; k++) {
    const [vt, mt] = o.targets(Math.min(o.total, o.from + k / 100));
    if (v < 0) { v = vt; m = mt; }
    v += (vt - v) * (1 - Math.exp(-0.01 / 0.03));
    m += (mt - m) * (1 - Math.exp(-0.01 / (mt < m ? 0.08 : 0.5)));
    vc[k] = v; mc[k] = m;
  }
  const add = async (url: string, curve: Float32Array, loop: boolean, offset: number) => {
    const buf = await oc.decodeAudioData(await (await fetch(url)).arrayBuffer());
    const src = oc.createBufferSource(), g = oc.createGain();
    src.buffer = buf; src.loop = loop;
    g.gain.setValueCurveAtTime(curve, 0, dur);
    src.connect(g); g.connect(comp);
    src.start(0, loop ? offset % Math.max(0.1, buf.duration) : Math.min(offset, buf.duration));
  };
  if (o.voiceUrl) await add(o.voiceUrl, vc, false, o.from); // the voice file lines up with the timeline
  if (o.musicUrl) await add(o.musicUrl, mc, true, 0); // the music starts from its beginning, as in the live player
  return oc.startRendering();
}

export async function fastRender(o: FastOpts): Promise<Blob | null> {
  if (!fastRenderSupported()) return null;
  const { canvas: c, fps } = o;
  const W = c.width, H = c.height;
  const codec = W * H > 1920 * 1088 ? "avc1.640033" : "avc1.64002A";
  const vcfg = { codec, width: W, height: H, bitrate: o.bitrate, framerate: fps };
  if (!(await VideoEncoder.isConfigSupported(vcfg)).supported) return null;
  const wantAudio = !!(o.voiceUrl || o.musicUrl);
  // AAC is the usual sound format for MP4; where the browser cannot encode it (some Linux builds) Opus is also valid in MP4.
  let acfg = { codec: "mp4a.40.2", sampleRate: SR, numberOfChannels: 2, bitrate: 128000 }, acodec: "aac" | "opus" = "aac";
  if (wantAudio && !(await AudioEncoder.isConfigSupported(acfg)).supported) {
    acfg = { ...acfg, codec: "opus" }; acodec = "opus";
    if (!(await AudioEncoder.isConfigSupported(acfg)).supported) return null;
  }

  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const target = new ArrayBufferTarget();
  const mux = new Muxer({
    target, fastStart: "in-memory",
    video: { codec: "avc", width: W, height: H },
    ...(wantAudio ? { audio: { codec: acodec, numberOfChannels: 2, sampleRate: SR } } : {}),
  });
  let encErr: unknown = null;
  const venc = new VideoEncoder({ output: (ch, meta) => mux.addVideoChunk(ch, meta), error: (e) => { encErr = e; } });
  venc.configure(vcfg);
  try {
    const frames = Math.max(1, Math.round((o.total - o.from) * fps));
    let lastUi = 0;
    for (let k = 0; k < frames; k++) {
      if (o.cancelled() || encErr) throw new Error("stopped");
      const tt = Math.min(o.total - 0.001, o.from + k / fps);
      await o.drawAt(tt);
      const vf = new VideoFrame(c, { timestamp: Math.round((k * 1e6) / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: k % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2)); // let the encoder catch up
      const now = performance.now();
      if (now - lastUi > 400) { lastUi = now; o.onProgress(tt); await new Promise((r) => setTimeout(r, 0)); }
    }
    await venc.flush();
    if (encErr) throw encErr;

    const mix = await mixAudio(o);
    if (mix && wantAudio) {
      const aenc = new AudioEncoder({ output: (ch, meta) => mux.addAudioChunk(ch, meta), error: (e) => { encErr = e; } });
      aenc.configure(acfg);
      const L = mix.getChannelData(0), R = mix.getChannelData(1), step = SR; // one second at a time
      for (let p = 0; p < mix.length; p += step) {
        const len = Math.min(step, mix.length - p), data = new Float32Array(len * 2);
        data.set(L.subarray(p, p + len), 0); data.set(R.subarray(p, p + len), len);
        const ad = new AudioData({ format: "f32-planar", sampleRate: SR, numberOfFrames: len, numberOfChannels: 2, timestamp: Math.round((p / SR) * 1e6), data });
        aenc.encode(ad); ad.close();
      }
      await aenc.flush(); aenc.close();
      if (encErr) throw encErr;
    }
    mux.finalize();
    return new Blob([target.buffer], { type: "video/mp4" });
  } finally {
    try { venc.close(); } catch { /* already closed */ }
  }
}
