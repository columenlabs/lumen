# Voice input: `VoiceButton`, `useVoiceInput`

## Use it for

Talking instead of typing into a box that people write prose in: a message to the assistant, a note, a comment. `LumenComposer` (and so `LumenAssistant`) draws one beside Send by default (`voice={false}` turns it off). A box of your own adds `VoiceButton` next to its Send.

It uses the browser's own speech to text (Web Speech API, `SpeechRecognition`): no server of ours, no cost, the browser's language. Where the browser has none (Firefox), nothing is drawn. Not for short fields (a name, a number, a search): typing is faster there.

## Anatomy

- Idle: a mic `IconButton`, tooltip "Talk to type".
- Listening: a pulsing red dot, tooltip "Stop listening". Words appear in the box as they are heard and settle as each phrase ends.
- Tap again (or disable the box) to stop. What was said joins the end of the box's text, never replacing it; text typed while listening is kept.
- A blocked microphone, no microphone or no connection shows one error toast that says what to do.

## Do / Don't

```tsx
// ✓ The box's own value and setter; the mic sits with the box's other icons, before Send.
<VoiceButton value={note} onChange={setNote} size="icon-sm" disabled={sending} />

// ✗ Its own recognition code, a text "Dictate" button, or a mic drawn disabled where the browser can't listen.
```

## Checked by

No `lumen-ship check` rule yet.
