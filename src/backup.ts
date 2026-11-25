// Saves the project (script, scenes and settings) to a small file and loads it back, so it survives a cleared browser or a new phone.
// Pictures, clips and audio are not in the file: they are fetched again after loading.
const KEY = "vortex-project";
const MAX_BYTES = 5_000_000;

export function downloadProject(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `vortex-project-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch { return false; }
}

/** Checks a project file and saves it as the current project. Returns an error message, or null when it worked. */
export async function restoreProject(file: File): Promise<string | null> {
  if (file.size > MAX_BYTES) return "That file is too large to be a project file.";
  let d: unknown;
  try { d = JSON.parse(await file.text()); } catch { return "That file is not a project file."; }
  const p = d as { v?: unknown; scenes?: unknown };
  if (!p || p.v !== 1 || !Array.isArray(p.scenes) || !p.scenes.length) return "That file is not a project saved by this app.";
  if (!p.scenes.every((s) => s && typeof (s as { text?: unknown }).text === "string")) return "That project file has scenes the app cannot read.";
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { return "This browser would not save the project (storage is full or blocked)."; }
  return null;
}
