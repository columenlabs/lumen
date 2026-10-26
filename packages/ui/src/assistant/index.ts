// `@columenlabs/lumen-ui/assistant`: an assistant's chat panel and Settings sections, over the
// routes of `@columenlabs/lumen-ai/assistant`; the shapes both share are
// `@columenlabs/lumen-ui-types/assistant`.
export { type AssistantAdapter, assistantClient } from './client';
export {
  type AssistantCommand,
  type ComposerExtra,
  LumenAssistant,
  type LumenAssistantProps,
  LumenComposer,
  assistantStatusKey,
  useAssistantStatus,
  useLumenAssistantDock,
} from './lumen-assistant';
export { assistantSettingsSections } from './settings';
export {
  type AssistantSource,
  type AssistantSourceItem,
  type ComposeRequest,
  type PageSelection,
  composeAssistant,
  selectionRef,
  useAssistantSource,
  usePageSelection,
  useShownAssistantSources,
} from './sources';
export {
  type AssistantChatState,
  type LiveItem,
  applyEvent,
  useAssistantChat,
} from './use-assistant-chat';
