// The thumbnail picture prompt. The wording is the user's own and is kept exactly as written (plus one lettering sentence they asked to add);
// only the four bracketed blanks at the bottom are replaced with the current video's details.

const BLANKS = {
  topic: "[Insert topic]",
  text: "[Insert title or headline]",
  scene: "[Describe the characters and what they should be doing]",
  setting: "[Insert historical period or location]",
} as const;

const TEMPLATE = `Create a high-quality YouTube thumbnail in the EXACT same visual style, illustration quality, colour treatment, and composition approach as the established reference thumbnail.

VISUAL STYLE:
Use a colourful, detailed, hand-drawn comic-book illustration style with clean, confident black outlines, expressive character faces, slightly exaggerated facial features, smooth shading, and rich, vibrant colours. The artwork should look like a professionally illustrated historical storytelling cartoon, not a photograph, 3D render, or generic AI painting.

CHARACTERS:
Create historically appropriate characters based on the specific topic. Characters can change completely between thumbnails. Give them distinctive facial expressions, realistic historical hairstyles, clothing, accessories, and personalities. Make their interactions visually interesting and expressive.

COLOUR AND LIGHTING:
Use bright, warm, saturated colours with excellent contrast. Maintain clean highlights, detailed textures, and polished cartoon shading. Avoid dark, gloomy, washed-out, or overly realistic appearances.

BACKGROUND:
Use a clean white or very light background. Include relevant historical architecture, landscapes, buildings, objects, symbols, and environmental details that help communicate the topic. Keep the background visually interesting but uncluttered.

TEXT AND TYPOGRAPHY:
Display the supplied thumbnail title in large, bold, black, traditional serif typography. Make the text highly readable, with strong visual presence. Position it on the left side or upper section, depending on the composition. Do not allow characters to obscure the text. Match the lettering of the reference thumbnail exactly: the same typeface style, weight, letter spacing, line spacing and thin white outline.

COMPOSITION:
Create a balanced, eye-catching layout. Characters should occupy a substantial portion of the thumbnail, with expressive faces and clear interactions. The text and illustrations must work together as one composition. Ensure the main characters are recognizable even at small mobile-screen sizes.

CONSISTENCY:
Maintain the same illustration style, line quality, character detailing, colour richness, typography treatment, brightness, and overall visual identity across every thumbnail. Only the characters, historical setting, background details, props, and story-specific elements should change according to the new topic.

STRICT REQUIREMENTS:

- 16:9 YouTube thumbnail format.
- No timestamp.
- No channel logo.
- No watermark.
- No unnecessary decorative icons.
- No fire lamp or oil lamp unless specifically requested.
- No photorealism or 3D graphics.
- No dark backgrounds.
- No cluttered composition.
- Correct spelling of all supplied text.

NEW VIDEO TOPIC: ${BLANKS.topic}

THUMBNAIL TEXT: ${BLANKS.text}

CHARACTERS AND SCENE: ${BLANKS.scene}

HISTORICAL PERIOD/SETTING: ${BLANKS.setting}

The final result must look like it belongs to the same YouTube channel and the same established thumbnail collection, even though the characters and story are completely different.`;

export type ThumbFields = { topic: string; text: string; scene: string; setting: string };

export const thumbReady = (f: ThumbFields) => !!(f.topic.trim() && f.text.trim() && f.scene.trim() && f.setting.trim());

// Each blank is swapped for the matching field. A function is used so characters like "$" in the text stay as typed.
export function thumbPrompt(f: ThumbFields): string {
  const one = (s: string) => s.replace(/\s+/g, " ").trim();
  let out = TEMPLATE;
  (Object.keys(BLANKS) as (keyof typeof BLANKS)[]).forEach((k) => { out = out.replace(BLANKS[k], () => one(f[k])); });
  return out;
}

// A request to paste into any AI, so it can fill the scene fields from the script.
export function thumbFillPrompt(o: { topic: string; script: string }): string {
  return [
    "I need details for a YouTube thumbnail picture for the video below. Read the script, then answer in exactly this format and nothing else:",
    "",
    "THUMBNAIL TEXT: (2 to 5 words in capital letters that make people curious. It may only promise something the video really shows. Not the full title.)",
    "CHARACTERS AND SCENE: (the single most curious or dramatic moment in the script. Name 2 to 3 characters, give each one clear facial expression, and say what they are doing and how they look at each other. Describe their clothing and 3 to 5 props. Modest clothing, nothing graphic or violent.)",
    "HISTORICAL PERIOD/SETTING: (the year or era and the place, with one simple recognisable background)",
    "",
    "RULES: use only people, places and objects that appear in the script. Clothing and props must fit the time and place; if unsure about an object, choose a simpler one. Do not invent facts.",
    "",
    o.topic.trim() ? `Video topic: ${o.topic.trim()}` : "",
    "",
    "Script:",
    o.script.trim(),
  ].filter((l, i, a) => l !== "" || a[i - 1] !== "").join("\n");
}

export type ThumbFill = { text?: string; scene?: string; setting?: string };

// Reads the AI's answer. Headings may carry bold marks or bullets.
export function parseThumbFill(reply: string): ThumbFill {
  const keys: Record<string, keyof ThumbFill> = { "THUMBNAIL TEXT": "text", "CHARACTERS AND SCENE": "scene", "HISTORICAL PERIOD/SETTING": "setting" };
  const HEAD = /^[\s#>*_•-]*(THUMBNAIL TEXT|CHARACTERS AND SCENE|HISTORICAL PERIOD\/SETTING)[\s*_]*:?[\s*_]*(.*)$/i;
  const out: ThumbFill = {};
  let key: keyof ThumbFill | null = null, buf: string[] = [];
  const flush = () => {
    if (key) { const v = buf.join(" ").replace(/\s+/g, " ").trim(); if (v && !out[key]) out[key] = v; }
    buf = [];
  };
  for (const raw of reply.replace(/\r/g, "").split("\n")) {
    const line = raw.replace(/\*\*|__/g, "");
    const m = line.match(HEAD);
    if (m) { flush(); key = keys[m[1].toUpperCase()]; if (m[2].trim()) buf.push(m[2].trim()); }
    else if (key) buf.push(line);
  }
  flush();
  if (out.text) out.text = out.text.replace(/^["'“”(\s]+|["'“”)\s]+$/g, "").toUpperCase();
  return out;
}
