// Picture styles for the scene images. The same text is used in two places:
//  1. the app's own free AI picture maker (kept short, because it travels inside a web address), and
//  2. the "Copy image prompt" button, which builds a longer prompt for any image generator the user prefers.

export type StyleId = "photo" | "comic" | "custom";

export const PHOTO_STYLE = "ultra realistic professional photograph, natural lighting, sharp focus, high detail";

export const COMIC_STYLE =
  "hand-inked historical comic illustration, bold confident black outlines, fine pen-and-ink detail, watercolour-style colouring in warm saturated reds, greens, creams and blues, soft painted shading, large expressive slightly exaggerated faces, detailed period-accurate costumes and props, bright daylight with a pale sky, recognisable architecture painted softly behind the characters, not photorealistic, not 3D";

export const STYLE_NAMES: Record<StyleId, string> = {
  photo: "Realistic photographs (default)",
  comic: "Hand-inked historical comic",
  custom: "My own style (edit below)",
};

export const isStyleId = (x: unknown): x is StyleId => x === "photo" || x === "comic" || x === "custom";

// The words used for the pictures. A custom style that was left empty falls back to the comic wording.
export const styleText = (id: StyleId, custom: string): string =>
  id === "photo" ? PHOTO_STYLE : id === "comic" ? COMIC_STYLE : custom.trim() || COMIC_STYLE;

const RULES = [
  "No text, letters, numbers, captions, underlines or watermarks anywhere in the image.",
  "Modest clothing. Nothing suggestive or graphic.",
  "Clothing, buildings and props must fit the time and place of the story. If unsure about an object, choose a simpler one.",
  "Show only what the scene describes: one clear moment, with 1 to 4 characters when people appear.",
  "Leave the bottom fifth of the frame free of important detail, because subtitles cover it.",
];

const clip = (t: string, max: number) => {
  const s = t.replace(/\s+/g, " ").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return (end > max * 0.5 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "")).trim();
};

export type ScenePromptInput = { topic: string; title: string; narration: string; visual: string; long: boolean };

// A complete, paste-ready prompt for one scene picture.
export function scenePrompt(style: string, o: ScenePromptInput): string {
  const ideas = o.visual.split("|").map((x) => x.trim()).filter(Boolean).join("; ");
  return [
    `Create a ${o.long ? "16:9 landscape" : "9:16 vertical"} illustration for a storytelling video. If a reference image is attached, match its visual style, line quality, colour treatment and level of detail exactly.`,
    "",
    "VISUAL STYLE:",
    style,
    "",
    "RULES:",
    ...RULES.map((r) => `- ${r}`),
    "",
    "SCENE:",
    ...[
      o.topic.trim() ? `Video topic: ${o.topic.trim()}` : "",
      o.title.trim() ? `Scene name: ${o.title.trim()}` : "",
      o.narration.trim() ? `What is happening (from the narration): ${clip(o.narration, 600)}` : "",
      ideas ? `Visual ideas: ${ideas}` : "",
    ].filter(Boolean),
    "",
    "The result must look like it belongs to the same series as every other picture in this video.",
  ].join("\n");
}
