# Vortex AI Studio

A browser-based video maker. Paste a script, and it splits it into scenes, finds or generates pictures and clips for each scene, adds captions and voiceover, and records the finished video.

## What it does today

- Turns a pasted script (Markdown or JSON) into editable scenes with a timeline and live preview.
- Finds visuals per scene: free AI photos (Pollinations), stock video and photos (Pexels and Pixabay, when the server has their keys), or your own uploads. Every scene can mix them. In the Scenes tab you can add more visuals, remove one or reorder them; uploads are never replaced by "Find and add more visuals" or by Generate video.
- Voiceover: built-in AI voice (free Cloudflare Workers AI voice, or OpenAI if you prefer), your own recording, or an uploaded file. Background music upload.
- Share: sends the finished video through the phone's share menu (nothing is uploaded by the app).
- Burned-in captions, intro text, slow zoom and pan, crossfades, and a camera and microphone recorder.
- Publish tab: title, description, tags, thumbnail (with download), and a checklist.
- Export: records the preview in your browser to a video file.
- Your script, scenes and settings are saved in the browser. Pictures, clips and audio are not saved and are fetched again after a refresh.

It does **not** generate AI video yet. See "Roadmap".

## How secret keys are handled

API keys never go in the browser. Three Netlify Functions hold them on the server:

| Function | Purpose | Needs |
| --- | --- | --- |
| `/api/tts` | AI voiceover | `CLOUDFLARE_ACCOUNT_ID` + `CLOUDFLARE_API_TOKEN` (free allowance), or `OPENAI_TTS_API_KEY` |
| `/api/stock` | Pexels and Pixabay search | `PEXELS_API_KEY`, `PIXABAY_API_KEY` |
| `/api/status` | Tells the app which keys exist (true or false only) | none |

If both voice services are set, Cloudflare is used (set `TTS_PROVIDER=openai` to prefer OpenAI). The Cloudflare voice is one English voice; OpenAI offers six.

The OpenAI key is named `OPENAI_TTS_API_KEY` on purpose. Netlify's AI Gateway automatically fills a variable called `OPENAI_API_KEY` with its own key, which OpenAI rejects when the app calls OpenAI directly, so the app ignores that name.

Every call must carry the `ACCESS_CODE` you choose. If `ACCESS_CODE` is not set on the server, the functions refuse everything, so a public site cannot spend your credit by accident.

## Set up on Netlify

1. Connect this repository to a Netlify site. Build settings come from `netlify.toml`.
2. In Netlify, open Site configuration, then Environment variables, and add the names from `.env.example`. Only `ACCESS_CODE` is required to start; add each provider key you have.
3. Redeploy so the functions see the new variables.
4. In the app, open the Create tab, open "Server access", and enter the same access code. It should say "Connected" and show which providers are on.

Never commit a real `.env` file. `.gitignore` already blocks it.

## Run locally

```
npm install
npm run dev
```

The functions only run on Netlify, so locally the app shows "Could not reach the server functions". AI photos, Wikimedia footage and uploads still work. To run the functions locally you can use the Netlify CLI (`npx netlify dev`) with a local `.env` file.

Other commands: `npm run build` (type-check and build) and `npm run lint`.

## Known limits

- Export records in real time, so the tab must stay open and in front for the full length of the video. The file is WebM on most browsers; MP4 only where the browser records it.
- Pollinations is used without a key. Its current free limits and commercial-use terms have not been verified.
- Live calls to Cloudflare voice, OpenAI, Pexels and Pixabay have not been tested end to end. The Cloudflare voice reply format was handled from its documentation (raw MP3 or base64 JSON) and not confirmed with a real call; whether the free daily allowance applies to API calls is also unconfirmed. The functions have local mock tests only.
- Pexels and Pixabay ask for a visible source. While their visuals are in the video, the app keeps a credit line in the description automatically (it names the sites, not individual photographers).

## Roadmap

1. Image-generation provider adapters (Cloudflare Workers AI FLUX first, with Pollinations as fallback).
2. Optional AI video through a user-supplied key (paid providers), with clear labels for AI, stock and uploaded media.
3. In-app script writing, with edit and regenerate per scene.
4. Job queue with retry, and saved media.
