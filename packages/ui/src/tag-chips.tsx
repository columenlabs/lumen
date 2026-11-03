// Tags (a row's several free-form labels: `ai`, `cybersecurity`, `favorite`) as coloured chips,
// each with an icon where its words suggest one. The colour comes from the tag's name, so one tag
// reads the same colour on every row, page and app with nothing stored.
import {
  Baby,
  BookOpen,
  Bot,
  Briefcase,
  Bug,
  Building2,
  Car,
  Check,
  Clock,
  Cloud,
  Code,
  Cpu,
  Database,
  DollarSign,
  Dumbbell,
  Factory,
  FileText,
  Film,
  Flag,
  Flame,
  Gamepad2,
  Globe,
  GraduationCap,
  Handshake,
  Heart,
  HeartPulse,
  Hourglass,
  House,
  Landmark,
  LayoutTemplate,
  Leaf,
  Lightbulb,
  Link,
  Lock,
  MapPin,
  Megaphone,
  Music,
  Network,
  Palette,
  Plane,
  Rocket,
  Server,
  Shield,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Star,
  TriangleAlert,
  Truck,
  Users,
  Utensils,
  Wrench,
  Zap,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { ColorChip } from './color-dot';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

type Icon = ComponentType<{ className?: string }>;

// Chart colours that read as a hue in light and dark (not the grey `--chart-8`).
const TAG_COLORS = [1, 2, 3, 4, 5, 6, 7, 9, 10].map((n) => `var(--chart-${n})`);

/** A tag's colour, picked from its name: the same tag is the same colour everywhere. */
export function tagColor(tag: string): string {
  const key = tag.trim().toLowerCase();
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return TAG_COLORS[(h >>> 0) % TAG_COLORS.length] as string;
}

// Words to icons, most specific first: a tag takes the icon of the first entry any of its words
// matches (`data-security` is a shield, `ai-buildout` a server).
const TAG_ICONS: [RegExp, Icon][] = [
  [/^(fav|favou?rites?|starred|top|pick)$/, Star],
  [/^(cyber|cybersecurity|security|secure|infosec|appsec|privacy)$/, Shield],
  [/^(auth|identity|iam|zero|zerotrust|crypto|encryption)$/, Lock],
  [/^(buildout|datacenters?|dc|infra|infrastructure|servers?|hosting|compute)$/, Server],
  [/^(chips?|semis?|semiconductors?|hardware|gpus?|silicon)$/, Cpu],
  [/^(ai|ml|llm|genai|agents?|agentic)$/, Sparkles],
  [/^(bots?|robots?|robotics|automation)$/, Bot],
  [/^(data|database|db|analytics|warehouse|sql|etl)$/, Database],
  [/^(cloud|saas|serverless)$/, Cloud],
  [/^(network|networking|edge|cdn)$/, Network],
  [/^(bigtech|faang|enterprise|corp|corporate|company)$/, Building2],
  [/^(dev|devtools|developer|developers|code|coding|engineering|software|platform)$/, Code],
  [/^(startup|startups|growth|launch)$/, Rocket],
  [/^(fintech|finance|financial|bank|banking|money|pay|payments|budget)$/, DollarSign],
  [/^(gov|government|public|federal|civic)$/, Landmark],
  [/^(health|healthcare|medical|bio|biotech|pharma)$/, HeartPulse],
  [/^(fitness|gym|workout|sports?)$/, Dumbbell],
  [/^(energy|power|electric|ev|battery|utilities)$/, Zap],
  [/^(climate|green|sustainability|eco|garden|plants?)$/, Leaf],
  [/^(manufacturing|industrial|factory)$/, Factory],
  [/^(mobile|phone|ios|android|apps?)$/, Smartphone],
  [/^(remote|global|international|web|online)$/, Globe],
  [/^(local|onsite|hybrid|office|nearby)$/, MapPin],
  [/^(home|house|family)$/, House],
  [/^(kids?|baby|children)$/, Baby],
  [/^(team|people|social|community|hr)$/, Users],
  [/^(jobs?|work|career|hiring)$/, Briefcase],
  [/^(edu|education|learning|school|course|courses|training)$/, GraduationCap],
  [/^(docs?|documents?|guides?|pdf|files?)$/, FileText],
  [/^(templates?|layouts?)$/, LayoutTemplate],
  [/^(how|howto|tips?|ideas?)$/, Lightbulb],
  [/^(partners?|partnership|vendors?)$/, Handshake],
  [/^(links?|urls?|bookmarks?)$/, Link],
  [/^(books?|reading|research)$/, BookOpen],
  [/^(games?|gaming)$/, Gamepad2],
  [/^(music|audio)$/, Music],
  [/^(film|video|movies?|media|streaming)$/, Film],
  [/^(design|art|creative)$/, Palette],
  [/^(marketing|ads|sales|pr)$/, Megaphone],
  [/^(shop|shopping|retail|ecommerce|commerce)$/, ShoppingCart],
  [/^(food|recipes?|dinner|lunch|breakfast|dessert|cooking)$/, Utensils],
  [/^(travel|trip|flights?)$/, Plane],
  [/^(cars?|auto|automotive)$/, Car],
  [/^(logistics|shipping|delivery|supply)$/, Truck],
  [/^(tools?|repair|maintenance|fix)$/, Wrench],
  [/^(bugs?|issues?)$/, Bug],
  [/^(urgent|hot|asap)$/, Flame],
  [/^(risk|warning|alert|blocked)$/, TriangleAlert],
  [/^(done|ok|approved|verified)$/, Check],
  [/^(waiting|pending|later|someday)$/, Hourglass],
  [/^(daily|weekly|monthly|recurring|time)$/, Clock],
  [/^(goal|goals|milestone|priority)$/, Flag],
  [/^(love|loved|liked)$/, Heart],
];

const iconCache = new Map<string, Icon | null>();

/** A tag's icon from its words (`cybersecurity` a shield, `ai` sparkles), or none when no word fits. */
export function tagIcon(tag: string): Icon | undefined {
  const key = tag.trim().toLowerCase();
  let icon = iconCache.get(key);
  if (icon === undefined) {
    const words = key.split(/[^a-z0-9]+/).filter(Boolean);
    icon = TAG_ICONS.find(([re]) => words.some((w) => re.test(w)))?.[1] ?? null;
    iconCache.set(key, icon);
  }
  return icon ?? undefined;
}

/**
 * A row's tags as chips on one line: each in its colour with its icon. Past `max` the rest fold
 * into a `+N` chip whose hover names them all, so a table row never wraps. `colorOf` and `iconOf`
 * override the name-picked colour and icon (an app's own label colours).
 */
export function TagChips({
  tags,
  max = 3,
  colorOf,
  iconOf,
  empty,
}: {
  tags: readonly string[];
  max?: number;
  colorOf?: (tag: string) => string | undefined;
  iconOf?: (tag: string) => Icon | undefined;
  /** What no tags says; left out: a dash. */
  empty?: string;
}) {
  if (!tags.length) return <span className="text-muted-foreground">{empty ?? '—'}</span>;
  const shown = tags.slice(0, max);
  const rest = tags.length - shown.length;
  const chips = (
    <span className="inline-flex min-w-0 items-center gap-1 overflow-hidden">
      {shown.map((t) => (
        <ColorChip
          key={t}
          color={colorOf?.(t) ?? tagColor(t)}
          icon={iconOf?.(t) ?? tagIcon(t)}
          title={t}
          className="max-w-full min-w-9 shrink"
        >
          {t}
        </ColorChip>
      ))}
      {rest > 0 && <ColorChip>+{rest}</ColorChip>}
    </span>
  );
  if (!rest) return chips;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{chips}</TooltipTrigger>
      <TooltipContent className="max-w-md whitespace-normal">{tags.join(', ')}</TooltipContent>
    </Tooltip>
  );
}
