// Lumen (the whole component system is Lumen: published as
// `@columenlabs/lumen-ui` for every app): the frame, page, status bar, sidebar building
// blocks, preferences, filter, views, widgets, charts and drawers. Shadcn components it is built from
// are under `@columenlabs/lumen-ui/ui/*`; an app's sidebar content must use these (not its own
// copies) so it shares the shell's sidebar state. What one product adds (the product's assistant panel,
// Tasks) lives in that product and plugs into the shell's slots. Every app and the shell use the same major
// of TanStack Table (v9): vite's dev pre-bundling serves one copy to all of them.
export {
  type CustomViewConfig,
  LumenTable,
  type LumenTableProps,
  LumenView,
  type LumenViewProps,
  type ServerGroup,
  type ServerGroups,
  type ServerPaging,
  type ViewCellValue,
  type ViewChipTone,
  type ViewDomain,
  type ViewField,
  type RollLevel,
  type ViewFieldGroup,
  type ViewSource,
  CHIP_TONE,
  RUN_STATE_TONE,
  FORMULAS_GROUP,
  ViewValueCell,
  rollUp,
} from './lumen-view';
export {
  LumenLayout,
  type LumenLayoutCard,
  type LumenLayoutProps,
  type LumenLayoutViewProps,
  domainKeys,
  followRows,
} from './lumen-layout';
export { LumenViewCard, type LumenViewCardProps } from './lumen-view-card';
export {
  LumenSelector,
  LumenSelectorList,
  type LumenSelectorListHandle,
  type LumenSelectorProps,
  type LumenOption,
  type LumenOptionGroup,
  SelectorRowContent,
} from './lumen-selector';
export { ColorChip, ColorDot, colorIcon } from './color-dot';
export { EditCell, EditInputCell } from './view-edit-cell';
export {
  type CardOnScreen,
  cardsOnScreen,
  kindName,
  onScreen,
  pointAt,
  pointAtCard,
  type PointedAt,
  type SectionOnScreen,
  sectionsOnScreen,
  spotlight,
  targetEl,
  textOf,
} from './spotlight';
export { LinkDot, LinkPicker, type LinkColor, linkVar } from './lumen-links';
export { CardSegments, CardSwitch } from './card-switch';
export { PageInput, PageInputs } from './page-inputs';
export { LumenBulkBar } from './lumen-bulk-bar';
export { type LumenTab, LumenTabs } from './lumen-tabs';
export { LumenTabDrawer, TAB_NAME_MAX } from './lumen-tab-drawer';
export { IconPicker } from './icon-picker';
export {
  LumenEChart,
  type EChartOption,
  type ChartTokens,
  axisStyle,
  baseOption,
  useChartTokens,
} from './lumen-echart';
export { LumenGeoMap } from './lumen-geo-map';
export { LumenWidget, type CardControls, type CardLink, LumenSavedWidget } from './lumen-widget';
export { LumenConfirm, type LumenConfirmProps } from './confirm';
export { InfoLabel, InfoTip } from './info-tip';
export {
  type LumenAuthPoint,
  LumenAuthHeading,
  LumenAuthNote,
  LumenAuthProblem,
  LumenAuthStage,
  type LumenAuthStageProps,
  LumenCodeField,
  LumenEmailField,
  LumenPasswordField,
  LumenStepBar,
  type LumenAuthError,
  authErrorText,
} from './lumen-auth';
export { LumenBotCheck } from './lumen-bot-check';
export {
  LumenBackupCodes,
  type LumenCodeMethod,
  type LumenPasskey,
  type LumenResult,
  LumenSecondStep,
  type LumenSecondStepProps,
  LumenSignInMethods,
  type LumenSignInMethodsProps,
} from './lumen-security';
export {
  LumenDateInput,
  type LumenDateInputProps,
  stepDate,
} from './lumen-date-input';
export { LumenChoice, type LumenChoiceOption } from './lumen-choice';
export { LumenFileField, type LumenFileFieldProps } from './lumen-file-field';
export { LumenSecret } from './lumen-secret';
export { RankedBars, StackedBars, StackedColumns, TimeLines } from './lumen-widget-charts';
export { type ShareSegment, ShareMeter } from './share-meter';
export { type Pool, poolShare } from './pool-share';
export { METER_LEVEL_COLOR, METER_LEVEL_TEXT, meterLevel, meterValueTone } from './meter-level';
export { contrast, readableInk } from './ink';
export { UnitValue } from './unit-value';
export {
  type BurnRate,
  burnRate,
  durationText,
  PACE_WINDOWS,
  type Pace,
  type PaceWindow,
  paceHours,
  setDefaultPaceWindow,
  timeToCap,
  usePaceWindow,
} from './pace';
export { PaceWindowPicker, paceText, TimeToCap } from './time-to-cap';
export { type TrendChange, TrendValue, trendChange } from './trend-value';
export {
  COVERAGE_LEVELS,
  CoverageCell,
  type CoverageJobState,
  type CoverageLevel,
  CoverageLegend,
  coverageClass,
  coverageLabel,
  coverageLevel,
} from './coverage-cells';
export {
  type CoverageBlock,
  type CoverageData,
  type CoverageFact,
  type CoveragePick,
  type CoverageRow,
  type CoverageSummary,
  LumenCoverageMap,
  type LumenCoverageMapProps,
  blockName,
  blockOf,
} from './coverage-map';
export {
  type CalendarFact,
  LumenCoverageCalendarMap,
  type LumenCoverageCalendarMapProps,
} from './coverage-calendar-map';
export { DetailsTable, type DetailsTableProps, FactsTable } from './details-table';
export { DrawerSection, type DrawerSectionProps } from './drawer-section';
export { type DrawerAction, LumenDrawer, type LumenDrawerProps } from './lumen-drawer';
export { LumenCode, type LumenCodeProps, langOfPath } from './lumen-code';
export {
  LumenCodeEditor,
  type LumenCodeEditorProps,
  type LumenCodeLang,
} from './lumen-code-editor';
export { RenameField, type RenameFieldProps } from './rename-field';
export {
  LumenStackedList,
  type LumenStackedListProps,
  LumenStackedRow,
  type LumenStackedRowProps,
  type StackedColumn,
} from './lumen-stacked-list';
export { ResetButton, type ResetButtonProps } from './reset-button';
export {
  type ChartBand,
  type ChartMarker,
  GrowthChart,
  KEY_DATE_KINDS,
  KeyDateChips,
  type KeyDateKind,
  type KeyDateMarker,
  PALETTE,
  type Scale,
  type Series,
  benchColour,
  keyDateMarkers,
  paletteAt,
} from './growth-chart';
export {
  FoldGroup,
  NavGroup,
  type NavItem,
  type SectionItem,
  type SectionSubItem,
  SidebarSection,
} from './nav';
export {
  type OverviewPageProps,
  type OverviewStage,
  type OverviewTone,
  type OverviewWidget,
  OverviewList,
  OverviewPage,
  ToneDot,
} from './overview';
export {
  type Crumb,
  IconButton,
  type IconButtonProps,
  Page,
  PageBody,
  PageHeader,
  type PageHeaderProps,
} from './page';
export {
  DEFAULT_PREFS,
  deviceTimeZone,
  type Prefs,
  TIME_ZONES,
  type Theme,
  type TimeZoneId,
  getPrefs,
  resolvedTheme,
  setPref,
  timeZoneLabel,
  usePrefs,
  zoneAbbr,
  ASSISTANT_WIDTH,
} from './prefs';
export { KIT, type KitConfig, configureLumen } from './kit-config';
export {
  ConnectionBlock,
  ErrorLine,
  IntegrationRow,
  KeyTestLine,
  type KeyTestResult,
  TestBadge,
  errorText,
  useClock,
} from './integrations';
export {
  ConnectionBadge,
  type ConnectionField,
  type ConnectionLine,
  ConnectionLogo,
  type ConnectionSignin,
  type ConnectionStatus,
  type ConnectionTest,
  type ConnectionWay,
  LumenConnection,
  type LumenConnectionProps,
  activeWay,
  connectionStatus,
} from './connection';
export { LumenChatgptSignin, type LumenChatgptSigninProps } from './chatgpt-signin';
export { LumenExpandList, LumenExpandRow } from './expand-list';
export { type Fact, FactList, type FactListProps } from './fact-list';
export { LumenPageFooter, LumenPager, pageList } from './pager';
export { clearPersistedQueries, createDeskQueryClient, type PersistOptions } from './query-client';
export {
  type ClientPoint,
  type ClientPointKind,
  type LumenTelemetryOptions,
  apiRoute,
  reportClient,
  reportClientError,
  reportFailedFetch,
  stackFingerprint,
  useLumenTelemetry,
} from './telemetry';
export { refreshHeaders, withRefreshToken } from './refresh';
export {
  type LumenLoad,
  LumenError,
  LumenLazy,
  LumenLoadFooter,
  LumenLoadTime,
  LumenProgress,
  LumenRefresh,
  LumenSkeleton,
  LumenStates,
  marketTrades,
  useLumenLoad,
  useLumenSource,
  useLiveLoad,
} from './lumen-source';
export { LumenBoundary } from './lumen-boundary';
export {
  type CalendarCategory,
  type CalendarEvent,
  type CalendarRange,
  type CalendarView,
  LumenCalendar,
  type LumenCalendarProps,
} from './lumen-calendar';
export { type BoardColumn, type BoardItem, LumenBoard, type LumenBoardProps } from './lumen-board';
export {
  LumenPlayer,
  type LumenPlayerProps,
  type PlayerChapter,
  type PlayerLine,
  type PlayerSlide,
  type PlayerSource,
  type PlayerTrack,
  playerClock,
} from './lumen-player';
export { LumenPageState } from './lumen-page-state';
export { type FormIssue, goToIssue, SaveButton } from './form-issues';
export {
  LumenForm,
  type LumenFormField,
  lumenFormIssues,
  type LumenFormValue,
  type LumenFormValues,
} from './lumen-form';
export {
  RouteError,
  isStaleBuildError,
  reloadForNewBuild,
  reportError,
  watchNewBuilds,
} from './route-error';
export {
  LumenSettings,
  SettingRow,
  SettingsActions,
  SettingsFooter,
  type SettingsGroupDef,
  type SettingsSectionDef,
} from './settings';
export { LumenCard } from './summary-cards';
export { WhatsNew } from './whats-new';
export {
  type LumenApp,
  LumenAppSwitcher,
  LumenSuiteSwitcher,
  type SuiteApp,
  type SuiteList,
  suiteApps,
} from './app-switcher';
export {
  type BriefActions,
  type BriefChange,
  type ScheduleChange,
  type ScheduleItem,
  type ScheduleRun,
  SchedulesSection,
} from './schedules';
export { NotificationsSettings } from './notifications';
export { type TasksConfig, TasksButton, TasksProvider, useTaskFor, useTasks } from './tasks';
export { type McpServer, McpSettings } from './mcp-settings';
export { lumenToast } from './lumen-toast';
export {
  LumenShell,
  type LumenShellProps,
  type ShellUser,
  StatusItem,
  firstName,
  initials,
  maskAmount,
  useAmountsHidden,
  useApp,
  useShell,
} from './shell';
export { API_TIMEOUT_MS, apiJson } from './api-fetch';
export { FETCH_MS, fetchWithin } from './fetch-within';
export {
  savedAnswers,
  type SavedAnswersOptions,
  type SavedAnswersPersister,
} from './saved-answers';
export { cn } from './lib/utils';
export { type HealthProbe, StatusHealth } from './status-health';
export {
  type StatusMessage,
  type StatusMessageTone,
  StatusMessages,
  groupStatusMessages,
} from './status-messages';
export { TimeZoneSelect } from './status';
export {
  LumenStatusBar,
  type StatusBarModel,
  StatusBarProvider,
  type StatusFact,
  type StatusPart,
  type StatusSync,
  type StatusSyncState,
  querySync,
  statusWhen,
  useStatus,
} from './status-bar';
export {
  type AccountFacts,
  type JoinReaders,
  JoinsProvider,
  SourceStatusItems,
  YOURS_COLOR,
  editedCells,
  editedKey,
  frameColor,
  useFrameEdits,
  useJoins,
  usedJoinKeys,
} from './joins';
export { OriginLegend, originsOf } from './origin-legend';
export { type ConnectedDomain, ConnectOffer, connectionFields, linkGroupId } from './connections';
export {
  FRESHNESS,
  type Freshness,
  FreshnessIcon,
  FreshnessMark,
  freshnessLine,
  freshnessOf,
} from './freshness';
export { SourcesLine, useSourceHealth } from './source-health';
export {
  TILE_WIDTH,
  Tile,
  TileChip,
  type TileOption,
  TileRow,
  TileSpark,
  TileToggleGroup,
} from './tile';
export {
  type FacetCounts,
  type FilterField,
  type FilterToken,
  LumenTokenizedFilter,
  type LumenFilterState,
  countsShown,
  useFacetCounts,
  useLumenFilter,
} from './lumen-filter';
export {
  LumenFilterPanel,
  LumenFilterPanelButton,
  type LumenFilterPanelProps,
  useFilterPanel,
} from './lumen-filter-panel';
export { useIsMobile } from './hooks/use-mobile';
export { useTell } from './hooks/use-tell';
export { useBackClose } from './hooks/use-back-close';
export { VIEW_ICONS, iconOf, viewIcon } from './view-icons';
export { type AppViewState, useAppView } from './app-views';
export {
  type ScreenMap,
  type ScreenOutcome,
  type ScreenStatus,
  type WorkspaceOnScreen,
  type AssistantMove,
  type AssistantMoveHandlers,
  type AssistantPage,
  type AssistantPageType,
  AssistantScreenProvider,
  useAssistantMoves,
  useAssistantPages,
  useAssistantScreen,
  useAssistantWorkspace,
} from './assistant-screen';
export {
  type AssistantActions,
  AssistantContext,
  type AssistantNote,
  type AssistantRef,
  type AssistantSlot,
  useAssistant,
  AssistantPendingContext,
  useAssistantName,
  useAssistantNote,
  useAssistantPending,
} from './assistant-context';
export { WORKSPACES_KEY, frameKey, workspacesListQuery } from './workspace-keys';
export {
  type WorkspaceApp,
  type WorkspaceDraftProps,
  WorkspacePage,
  type WorkspacesConfig,
  WorkspacesProvider,
  WorkspacesSection,
} from './workspaces';
export {
  CHART_INDICATORS,
  type ChartIndicator,
  type IndicatorValues,
  LINE_COLOR,
  computeIndicators,
  formulaIndicator,
  lineColor,
  resolveIndicator,
  runFormula,
} from './market/indicators';
export { IndicatorPicker } from './market/indicator-picker';
export {
  type OptionChainField,
  type OptionChainRow,
  OptionChainTable,
} from './market/option-chain';
export {
  MarketProvider,
  type MarketStatus,
  useHasMarket,
  useMarket,
  useMarketDaily,
  useMarketFeed,
} from './market/live';
export {
  MarketBadge,
  MarketLines,
  MarketTiles,
  MarketToday,
  MarketWidget,
} from './market/market-widget';
export {
  CHART_TYPES,
  type ChartBar,
  type ChartType,
  PriceChart,
  heikinAshi,
} from './market/price-chart';
export {
  LumenChart,
  type LumenChartOptions,
  type MineIndicators,
  SymbolChartProvider,
  useLumenChart,
  useSymbolChart,
} from './market/lumen-chart';
export { SymbolSheetProvider } from './symbol-sheet';
export { useSymbolSheet } from './symbol-sheet-context';
export { NoteLine, type NoteLineProps } from './note-line';
export {
  type LumenFinderConfig,
  type LumenFinderPageType,
  type LumenFinderRow,
  type LumenFinderScope,
  LumenFinderButton,
  useLumenFinder,
  useLumenFinderRows,
  useOpenLumenFinder,
} from './lumen-finder';
export {
  type AssistantChat,
  LumenAssistantButton,
  LumenAssistantChats,
  LumenAssistantPanel,
  assistantOpen,
  tabState,
  useAssistantHotkey,
} from './assistant-panel';
export {
  LumenTree,
  LumenTreeItem,
  type LumenTreeItemProps,
  type LumenTreeProps,
  useLumenTree,
} from './lumen-tree';
