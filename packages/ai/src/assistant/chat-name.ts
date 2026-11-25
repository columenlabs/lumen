/**
 * A new chat's name: a few words about what it is for, written by a small model from the person's
 * first real message while the answer runs (`createAssistant` `titles`, `Assistant.nameChat`).
 */

/** A first message with fewer words than this ("hi", "help") says too little to name a chat by. */
const MIN_WORDS = 3;
/** The longest name kept, characters. */
export const CHAT_NAME_MAX = 60;

/** Whether a message says enough to name a chat by. */
export const nameable = (message: string) =>
  message.trim().split(/\s+/).filter(Boolean).length >= MIN_WORDS;

/** The naming call's instructions, with the assistant's and the app's names. */
export const chatNameSystem = (name: string, app?: string) =>
  `You name chats in ${name}, the assistant${app ? ` inside ${app}` : ''}.
Answer with one line: a name for this chat in at most 6 words, about what the person's message asks for ("Trim the beach clip", "Recipe for lemon cake"), in the language of the message.
No quotes, no punctuation at the end, no markdown, nothing else.`;

/** The model's answer as a chat name, or null when it is not one (empty, several lines of talk). */
export function cleanName(text: string): string | null {
  const line =
    text
      .trim()
      .split('\n')[0]
      ?.replace(/^\W*(name|title)\s*:\s*/i, '')
      .replace(/[*_`#"“”«»]/g, '')
      .replace(/[.。!]+$/, '')
      .replace(/\s+/g, ' ')
      .trim() ?? '';
  if (!line || line.split(' ').length > 12) return null;
  if (line.length <= CHAT_NAME_MAX) return line;
  const cut = line.slice(0, CHAT_NAME_MAX);
  const space = cut.lastIndexOf(' ');
  return cut.slice(0, space > 20 ? space : CHAT_NAME_MAX).trim();
}
