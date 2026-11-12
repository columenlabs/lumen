// An image a tool made, as a card in the chat: the picture, and over it Zoom (a lightbox), Use as
// reference (into the composer), Download and Make another (sent at once with the image mode on);
// under it what it cost. While the tool runs its line is a "Making the image" box.
import type { AssistantImage, StepImage, StepItem } from '@columenlabs/lumen-ui-types/assistant';
import { DownloadIcon, ImageIcon, ImagePlusIcon, Maximize2Icon, RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { IconButton } from '../icon-button';
import { lumenToast } from '../lumen-toast';
import { ImageLightbox } from './chat-image';
import { composeAssistant } from './sources';

/** Whether a tool's name as the model called it (`group__tool`) is `tool`. */
export const toolIs = (called: string, tool: string) =>
  called === tool || called.endsWith(`__${tool}`);

/** The image as the composer sends it, or null when it cannot be read. */
async function asReference(url: string): Promise<AssistantImage | null> {
  try {
    const res = await fetch(url, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise<string>((ok, fail) => {
      const f = new FileReader();
      f.onload = () => ok(String(f.result));
      f.onerror = () => fail(f.error);
      f.readAsDataURL(blob);
    });
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,(.*)$/.exec(data);
    return m ? ({ media_type: m[1], data: m[2] } as AssistantImage) : null;
  } catch {
    return null;
  }
}

export function ImageCard({
  step,
  image,
  mode,
}: {
  step: StepItem;
  image: StepImage;
  /** The composer mode Make another turns on. */
  mode?: string;
}) {
  const [zoom, setZoom] = useState(false);
  const [busy, setBusy] = useState(false);
  const alt = image.alt || step.title;
  const withImage = async (then: (img: AssistantImage) => void) => {
    setBusy(true);
    const img = await asReference(image.url);
    setBusy(false);
    if (img) then(img);
    else lumenToast.error("That image couldn't be read. Try again.");
  };
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5" data-slot="chat-made-image">
      <div className="relative w-full max-w-sm overflow-hidden rounded-lg border bg-muted">
        <img src={image.url} alt={alt} className="block w-full" />
        <div className="absolute top-2 right-2 flex gap-1 rounded-lg border bg-popover/90 p-0.5 text-popover-foreground shadow-sm backdrop-blur-sm">
          <IconButton icon={Maximize2Icon} label="Zoom" onClick={() => setZoom(true)} />
          <IconButton
            icon={ImagePlusIcon}
            label="Use as reference"
            disabled={busy}
            onClick={() => void withImage((img) => composeAssistant({ images: [img] }))}
          />
          <IconButton
            icon={DownloadIcon}
            label="Download"
            onClick={() => {
              const a = document.createElement('a');
              a.href = image.url;
              a.download = 'image.png';
              a.click();
            }}
          />
          <IconButton
            icon={RefreshCwIcon}
            label="Make another"
            disabled={busy}
            onClick={() =>
              void withImage((img) =>
                composeAssistant({
                  text: 'Make another version of this image.',
                  images: [img],
                  ...(mode ? { use: mode } : {}),
                  send: true,
                }),
              )
            }
          />
        </div>
      </div>
      {image.cost && (
        <span className="text-muted-foreground text-xs">
          Image · {image.cost}
        </span>
      )}
      <ImageLightbox src={image.url} alt={alt} open={zoom} onOpenChange={setZoom} />
    </div>
  );
}

/** The image tool's line while it runs. */
export function ImagePending() {
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <output className="flex aspect-[400/260] w-full max-w-sm animate-pulse flex-col items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/50 text-muted-foreground">
        <ImageIcon className="size-7" aria-hidden />
        <span className="text-foreground text-sm">Making the image</span>
        <span className="text-xs">Usually 10 to 20 s</span>
      </output>
    </div>
  );
}
