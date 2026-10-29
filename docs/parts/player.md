# Player: `LumenPlayer`

## Use it for

A recording to watch or listen to in a drawer or a page: a video, an audio file, or slides in step with audio. The browser's own `<video>`/`<audio>` plays it (served with byte ranges); the kit draws the controls.

- A short clip that loops with no controls: a plain `<video>` in the app.
- A link out to another site's player: an `IconButton` with `href`.

## Anatomy

```
┌────────────────────────────────────┐
│          video / slide image       │   click or space plays; a spinner while it waits
└────────────────────────────────────┘
━━━━━━━━━━━●───────────────────────────   seek bar (Slider)
▶  ↺  ↻  1:02 / 45:10        ⏲ 1×  CC ⛶   play, back 15 s, forward 15 s, time · speed, captions, full screen
Chapters                                   one line each: time, title; the current one lit
 0:00  The page
Transcript                                 its own scroll box; the line being said lit and kept in view
 0:03  Host: Edit layout opens the grid…   a tap plays from that line
```

- `src` (a URL) and `kind` (`video` or `audio`, read from the extension by default), or `source: { kind: 'slides', slides: [{ at, image, alt? }], audio }`.
- `tracks` (WebVTT captions, video), `chapters: [{ at, title }]`, `transcript: [{ start, end?, text, who? }]`, `poster`, `title`.
- `start` (seconds) resumes where the person left off. `onProgress(seconds, { duration, ended })` fires about every 10 s while playing, on pause, at the end and when the player goes away; nothing fires for a recording opened and left unplayed. Save it there.
- `onEnded` (play the next one), `autoPlay` (start as soon as it can; the browser may refuse without a tap).
- Keys while the player has focus: space or k play and pause, j and l skip 15 s, ← and → 5 s, f full screen, c captions. A field or menu inside keeps its own keys.
- A failed load shows one line and a Try again icon; the controls never spin forever.

## Do / Don't

```tsx
// ✓ the saved place in, the place out
<LumenPlayer src={fileUrl(item.file)} title={item.title} start={item.position}
  chapters={item.chapters} transcript={item.lines}
  onProgress={(s, { ended }) => save.mutate({ position: s, watched: ended })}
  onEnded={openNext} />

// ✓ slides over audio
<LumenPlayer source={{ kind: 'slides', slides: lesson.slides, audio: lesson.audio }} />

// ✗ native controls plus the app's own buttons; saving on every timeupdate
<video controls src={src} onTimeUpdate={(e) => save(e.currentTarget.currentTime)} />
<Button onClick={() => (v.currentTime -= 15)}>Back 15s</Button>
```

- ✗ A transcript that scrolls the whole page as it follows. ✓ The player's transcript scrolls inside its own box, and stops following for a few seconds after the person scrolls it.
- ✗ Global key handlers for play and seek. ✓ The player takes its keys only while focused.

## Checked by

Review and the app's interaction smoke (AGENTS.md, UI gate 2 and 5: popups and access).
