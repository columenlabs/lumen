import { LumenPlayer, type PlayerSlide } from '@columenlabs/lumen-ui';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useMemo, useState } from 'react';
import { width } from '../util';

const meta = {
  title: 'Components/Pickers and panels/LumenPlayer',
  component: LumenPlayer,
  decorators: [width(720)],
  parameters: {
    docs: {
      description: {
        component:
          'A recording on the browser’s own video or audio element with the kit’s controls: play, back and forward 15 seconds, seek, speed, captions and full screen. Chapters jump, a timed transcript follows and plays from a line, and `onProgress` reports the place about every 10 seconds, on pause and at the end. A slides source shows pictures in step with audio. Keys (space, j, l, arrows) work while it has focus.',
      },
    },
  },
} satisfies Meta<typeof LumenPlayer>;

export default meta;
type Story = StoryObj<typeof meta>;

const transcript = [
  { start: 0, text: 'Here is the page before anything changes.', who: 'Host' },
  { start: 3, text: 'Edit layout opens the grid: every card can move and resize.', who: 'Host' },
  { start: 7, text: 'A card dragged to a new spot pushes the others down.', who: 'Host' },
  { start: 11, text: 'Done saves the layout for this person only.', who: 'Host' },
  { start: 15, text: 'Reset to default puts the shared layout back.', who: 'Host' },
];

export const Video: Story = {
  args: {
    src: './clips/edit-layout.mp4',
    title: 'Edit layout',
    chapters: [
      { at: 0, title: 'The page' },
      { at: 3, title: 'Edit layout' },
      { at: 11, title: 'Save or reset' },
    ],
    transcript,
  },
  render: function Render(args) {
    const [saved, setSaved] = useState<number | null>(null);
    return (
      <div className="flex flex-col gap-2">
        <LumenPlayer {...args} onProgress={(s) => setSaved(s)} />
        <p className="num text-xs text-muted-foreground">Saved place: {saved ?? '–'}</p>
      </div>
    );
  },
};

/** A silent WAV of `seconds`, made in the browser, so the slides story needs no file. */
function silence(seconds: number): string {
  const rate = 8000;
  const n = rate * seconds;
  const buf = new DataView(new ArrayBuffer(44 + n));
  const text = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) buf.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  buf.setUint32(4, 36 + n, true);
  text(8, 'WAVEfmt ');
  buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true);
  buf.setUint16(22, 1, true);
  buf.setUint32(24, rate, true);
  buf.setUint32(28, rate, true);
  buf.setUint16(32, 1, true);
  buf.setUint16(34, 8, true);
  text(36, 'data');
  buf.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf.setUint8(44 + i, 128);
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

const slide = (n: number, title: string, hue: string): PlayerSlide => ({
  at: (n - 1) * 10,
  alt: title,
  image: `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><rect width="1600" height="900" fill="${hue}"/><text x="120" y="420" font-family="sans-serif" font-size="96" fill="#fff">${n}. ${title}</text></svg>`,
  )}`,
});

export const Slides: Story = {
  render: function Render(args) {
    const audio = useMemo(() => silence(40), []);
    return (
      <LumenPlayer
        {...args}
        title="Lesson one"
        source={{
          kind: 'slides',
          audio,
          slides: [
            slide(1, 'Why plans slip', '#3b5bdb'),
            slide(2, 'Three kinds of risk', '#0e9f6e'),
            slide(3, 'Writing the first checkpoint', '#d97706'),
            slide(4, 'Review', '#db2777'),
          ],
        }}
        chapters={[
          { at: 0, title: 'Why plans slip' },
          { at: 10, title: 'Three kinds of risk' },
          { at: 20, title: 'Writing the first checkpoint' },
          { at: 30, title: 'Review' },
        ]}
      />
    );
  },
};
