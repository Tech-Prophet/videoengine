// The prompt for any AI that writes the script. Kept in one place so the voice rules are easy to read and change.

export type ScriptPromptIn = { short: boolean; topic: string; tone: string; minutes: number; totalWords: number; perScene: number; nScenes: number; channel: string };

export function scriptPrompt(i: ScriptPromptIn): string {
  const ch = i.channel.trim() || "my channel";
  const minWords = Math.round(i.perScene * 0.85);
  return `Write a YouTube ${i.short ? "Short" : "video"} script about: "${i.topic.trim() || "[your topic]"}".
Tone: ${i.tone}. The narration must run about ${i.minutes} minute${i.minutes > 1 ? "s" : ""} when read aloud: at least ${i.totalWords} spoken words in total, and at least ${minWords} words in every scene. Do not summarise or shorten.
${i.short ? "This is a vertical Short: hook the viewer in the first 3 seconds and keep every scene punchy." : "Hook the viewer in the first 10 seconds, state the promise of the video, give one idea per scene, and end with a short call to action."}
Use exactly ${i.nScenes} scenes. Give every scene a short, specific title of 2 to 6 words that a viewer would want to click as a YouTube chapter, for example "Why Bakers Start Before Sunrise" or "A City Under Strain". Never name a scene "Hook", "Intro", "Scene 2", "Part 3", "Conclusion" or "Call to action", and do not give away the ending in a title. Write the narration as plain spoken sentences only, with no stage directions and no emojis. The video opens on a wide establishing view and closes on a wide, calm view, so keep the searches of the first and last scenes wide.

VOICE
Write like a warm, knowledgeable documentary narrator speaking to one person.
Use short, plain sentences, and vary the rhythm with the occasional very short one.
Speak to the viewer as "you" and "we". Use small signposts to guide the ear, such as "Now we reach the hardest part" or "Here is the twist", but vary them from video to video.
Use the senses (smell, cold, heat, sound) and human detail, not lists of facts.
End most scenes with a line that leads into the next one.
Choose one central idea for the video. State it in the first scene and return to it in the last, in different words.
Use British spelling.

CAREFUL CLAIMS
Never invent a record, date, number, quote, name or place. If you are not sure, leave it out.
Where evidence varies, say so: "in some places", "in many towns", "often", "historians believe".
If you use a made-up example, say it is a composite or an example.

ORIGINAL WORDING
Never reuse openers, closers, catchphrases or signposts from other scripts you have written. Write every opening, ending and sign-off fresh.

ENDING
${i.short ? `Finish on one short question to the viewer and a one-line invitation to follow ${ch}.` : `Finish on a question to the viewer, a short invitation to like and subscribe to ${ch}, and a hint that another story is coming. Keep it warm and under 60 words.`}

VISUAL SEARCHES
Use simple, common phrases that stock sites return well, such as "village street", "old stone church" or "man carrying buckets". Avoid rare objects and avoid anything graphic.

Reply in exactly this format and nothing else:

TITLE: (under 70 characters)
INTRO TEXT: (a short line of 3 to 8 words for the opening seconds. It must match the video, but must not be the full title)
DESCRIPTION: (3 to 5 sentences. Open with two short, contrasting statements. State the big idea in one sentence. Preview what the story covers without giving away how it ends. Close on one reflective line.)
TAGS: (8 to 12 tags, separated by commas)
THUMBNAIL: (maximum 4 words)

## Scene 1: (scene title)
VISUAL: (3 different stock photo searches of 2 to 4 words each, separated by |, in the order the narration mentions them. Mix camera angles: one wide or aerial view, one close-up detail, one medium shot with people or action. Prefer real movement, such as 'person typing laptop' or 'woman walking park', over still objects)
DELIVERY: voiceover
(narration for this scene)

## Scene 2: (scene title)
VISUAL: ...
DELIVERY: voiceover
(narration for this scene)

(continue until Scene ${i.nScenes}. Use "DELIVERY: on-camera" only for a scene where a real person must speak straight to the viewer. Otherwise always use "DELIVERY: voiceover".)`;
}
