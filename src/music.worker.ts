// Runs in a Web Worker: builds a background-music loop away from the page, so buttons and the preview keep responding.
import { makeMusic } from "./music.ts";
import type { MusicStyle } from "./music.ts";

type Request = { style: MusicStyle; sr: number };
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<Request>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  try {
    const data = makeMusic(e.data.style, e.data.sr);
    scope.postMessage({ data }, [data.buffer as ArrayBuffer]); // handed over, not copied
  } catch (err) {
    scope.postMessage({ error: err instanceof Error ? err.message : String(err) });
  }
};
