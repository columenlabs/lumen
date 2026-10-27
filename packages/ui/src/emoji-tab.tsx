// The icon picker's Emoji tab, loaded the first time it opens (the emoji set and its search).
import { EmojiPicker, EmojiPickerContent, EmojiPickerSearch } from './ui/emoji-picker';

export function EmojiTab({ onPick }: { onPick: (emoji: string) => void }) {
  return (
    <EmojiPicker className="h-80 w-full" columns={9} onEmojiSelect={({ emoji }) => onPick(emoji)}>
      <EmojiPickerSearch placeholder="Search emoji" />
      <EmojiPickerContent />
    </EmojiPicker>
  );
}
