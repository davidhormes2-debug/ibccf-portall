---
name: Withdrawal tutorial video — two synchronized copies
description: The animated withdrawal tutorial exists in two near-identical copies that must be kept in lockstep.
---

The animated "withdrawal tutorial" (live React/Framer-Motion, NOT a pre-rendered MP4) exists as **two near-identical copies** that must stay in sync:

- `client/src/components/portal/withdrawal-video/` — what portal users actually see (mounted in a dialog from the dashboard).
- `video/` — a standalone Vite app used for headless recording/export (`window.startRecording`/`stopRecording` hooks).

**Why:** the two projects are separate Vite builds and cannot import across each other, so the scene components + any shared data (e.g. `captions.ts`) are duplicated by design.

**How to apply:** any change to a scene's structure or copy must be made in BOTH `scenes/` (portal) and `video_scenes/` (standalone). The scene files are intended to be byte-identical except their copy source; you can edit the portal copy then `cp` it over the standalone copy (import path `../captions` matches in both layouts).

**Localization:** on-screen copy is locale-driven via a `captions.ts` table (locales en/es/fr/de/pt/zh) consumed through `VideoCaptionsContext`. The portal resolves locale from the active i18n language (kept in sync with `cases.preferred_locale`); the standalone recorder resolves it from the `?lang=<code>` URL query param so each localized variant can be recorded headlessly.

**Voiceover/narration:** per-scene TTS clips live as static files `client/public/withdrawal-video/narration/<locale>/<sceneKey>.mp3` (sceneKey ∈ intro/phase1..4). The script is composed from the existing caption strings via `buildNarrationScript()` in `captions.ts` — that is the single source of truth, so regenerating audio must use the same composition. `SCENE_DURATIONS` were sized so the LONGEST localized clip per scene finishes before the next scene cuts (re-run ffprobe and add ~0.7s buffer if scripts change). The portal plays narration live (`NarrationTrack.tsx`, mute toggle in `VideoTemplate.tsx`); the exported MP4s mux the SAME clips at recording time (see below). Both consume the identical per-scene mp3s, and the recorder's `SCENE_DURATIONS` (defined independently in `record-videos.mjs` AND `video/src/components/video/VideoTemplate.tsx`) must match the portal copy. Generated with ElevenLabs `eleven_multilingual_v2`, voice "George" (JBFqnCBsd6RMkjVDRZzb), speed 1.1.

## Headless recording (six MP4s)

`video/scripts/record-videos.sh` is the canonical entrypoint; it builds once then records one locale per locale. `record-videos.mjs` is the per-locale recorder (builds → serves the static build → Playwright `recordVideo` → ffmpeg transcode to H.264 MP4 **with the locale's narration muxed in**). The ffmpeg pass delays each scene's mp3 to its cumulative `SCENE_DURATIONS` offset (`adelay`) and sums them (`amix normalize=0`, clips never overlap) into one mono AAC bed mapped alongside the video; locales with no narration assets fall back to `-an` (silent). Output: `video/public/recordings/withdrawal-tutorial-<locale>.mp4` (~60s, 1280x720, ~3.8–4.4 MB each with audio). `validate-recording.sh` greps for `narrationClipsForLocale` to keep the muxing from silently regressing.

**Staleness guard:** the recorder stamps a content fingerprint of the shared animation source (captions + scenes + lib, portal copy = source of truth) per locale into `video/public/recordings/recordings.manifest.json`. A vitest freshness test recomputes the fingerprint and names any locale whose MP4 predates the current source. Use **content hashing, not mtime/git timestamps** — CI checks out shallow and resets mtimes, so time-based signals are meaningless there. Fingerprint logic lives in `video/scripts/recordingFingerprint.mjs` (shared by recorder + test). Re-record via `bash video/scripts/record-videos.sh <locale...>` to refresh the manifest.

**Narration staleness guard (separate from the MP4 one):** the per-scene TTS MP3s have their own content-fingerprint manifest at `client/public/withdrawal-video/narration/narration.manifest.json`, keyed per locale×scene. The fingerprint hashes the **composed spoken script** (`buildNarrationScript()` output), NOT the whole captions table — so editing a caption field that doesn't feed the narration (e.g. a stage title or role label) does NOT flag staleness, only changes to what is actually spoken do. Helper: `client/src/components/portal/withdrawal-video/narrationFingerprint.ts` (shared by test + stamper). Test: `narrationFreshness.test.ts` (sibling of `narrationSync.test.ts`, which separately checks existence + ffprobe duration fit). After regenerating audio, re-stamp via `npx tsx scripts/update-narration-manifest.ts <locale...>`.

**Hard-won gotchas (cost several attempts):**
- **Playwright `recordVideo` only reliably captures the FIRST Chromium browser launched in a given Node process.** A second `chromium.launch()` in the same process comes up with a dead renderer (only ~1 chrome proc) and the capture freezes a few hundred KB in — regardless of whether the browser is shared or fresh. **Fix:** record ONE locale per Node process; the shell wrapper loops `node record-videos.mjs <locale>` once per locale. Do not loop locales inside one Node process.
- **`recordVideo` needs Playwright's bundled ffmpeg** (`npx playwright install ffmpeg`) even though system ffmpeg does the final transcode. The wrapper auto-installs it if missing.
- Headless pages get background-throttled; the launch args `--disable-background-timer-throttling --disable-backgrounding-occluded-windows --disable-renderer-backgrounding` keep rAF/timers at full speed (defense-in-depth; the per-process fix was the real cure).
- **When polling a backgrounded run, keep poll commands SHORT.** A long-running poll command that hits the bash harness timeout gets process-group-killed and takes the nohup'd batch down with it. Prefer recording locales one-per-call in the foreground (~60s each fits a 115s timeout) for reliability.
- zh (CJK) renders correctly — the Replit Chromium is the `-with-cjk` variant.
