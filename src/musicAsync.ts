import { makeMusic } from "./music.ts";
import type { MusicStyle } from "./music.ts";

// Makes the background music in a Web Worker so the page does not freeze while it is built (about 2 s on a fast computer, longer on a phone).
// If a worker cannot start (very old browser, blocked script), it falls back to building the music on the page, which freezes it briefly, exactly as before.
export function makeMusicOffThread(style: MusicStyle, sr: number): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const onPage = () => { try { resolve(makeMusic(style, sr)); } catch (e) { reject(e); } };
    let worker: Worker;
    try { worker = new Worker(new URL("./music.worker.ts", import.meta.url), { type: "module" }); }
    catch { onPage(); return; }
    worker.onmessage = (e: MessageEvent<{ data?: Float32Array; error?: string }>) => {
      worker.terminate();
      if (e.data.data) resolve(e.data.data);
      else if (e.data.error) reject(new Error(e.data.error));
      else onPage();
    };
    worker.onerror = () => { worker.terminate(); onPage(); };
    worker.postMessage({ style, sr });
  });
}
