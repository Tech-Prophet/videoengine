// The prompt for any AI that writes the script. Kept in one place so the voice rules are easy to read and change.

export type ScriptPromptIn = { short: boolean; topic: string; tone: string; minutes: number; totalWords: number; perScene: number; nScenes: number };

export function scriptPrompt(i: ScriptPromptIn): string {
  const minWords = Math.round(i.perScene * 0.85);
  return `Write a YouTube ${i.short ? "Short" : "video"} script about: "${i.topic.trim() || "[your topic]"}".
Tone: ${i.tone}. The narration must run about ${i.minutes} minute${i.minutes > 1 ? "s" : ""} when read aloud: at least ${i.totalWords} spoken words in total, and at least ${minWords} words in every scene. Do not summarise or shorten.
${i.short ? "This is a vertical Short: hook the viewer in the first 3 seconds and keep every scene punchy." : "Hook the viewer in the first 10 seconds with Scene 1 as described under OPENING, state the promise of the video, give one idea per scene, and end as described under ENDING."}
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
Never reuse openers, closers, catchphrases or signposts from other scripts you have written. Write every opening, ending and sign-off fresh. The only exception is the ask in Scene 2 of OPENING.

OPENING
${i.short ? "Open on the single strangest moment of the story, with no greeting and no introduction." : `Scene 1 is the story's own opening. Two to four plain sentences that drop straight into this story, with no greeting and no ask. Use a different style each time: a scene, a surprising fact, a question, a date and place, or a contradiction. Never start with "Come with me", "Picture" or "Imagine". End Scene 1 on a line that makes the viewer want to know what happens next.
Scene 2 is a short scene that holds only the ask, about 20 to 30 words and nothing else. It is the one scene that may be shorter than the minimum. Its title is "Before We Go On". Say it in these words, naming the era or subject of the topic once and using "fascinates" or "fascinate" as the grammar needs: "If [era or subject] fascinates you, subscribe so you never miss one. And tell me in the comments where you're tuning in from." For example: "If the Middle Ages fascinate you, subscribe so you never miss one. And tell me in the comments where you're tuning in from." Do not name any channel. Give it a calm, wide visual search that fits the story.
Scene 3 carries on the story from the moment Scene 1 left it. Do not repeat Scene 1 and do not mention the ask.`}

ENDING
${i.short ? `Finish on one short question to the viewer and a one-line invitation to follow for more.` : `Finish on a question to the viewer, a short invitation to like and subscribe, and a hint that another story is coming. Keep it warm and under 60 words.`}

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
