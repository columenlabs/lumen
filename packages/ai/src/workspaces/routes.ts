/**
 * The HTTP routes the kit's workspace pages call (`WorkspacesSection`, `WorkspacePage` in
 * `@columenlabs/lumen-ui`), as one fetch handler on Web `Request`/`Response`, mounted at the
 * assistant's api (`/api/assistant`):
 *
 *   GET    /workspaces                    the caller's workspaces
 *   POST   /workspaces {name, app?}       a new one
 *   GET    /workspaces/:id                one, with its frames' heads
 *   PATCH  /workspaces/:id {name?, app?}
 *   DELETE /workspaces/:id
 *   POST   /workspaces/:id/tabs {name, recipe}   a new tab from a recipe (runs it once)
 *   POST   /workspaces/:id/refresh        runs every tab's recipe again, one after another
 *   PUT    /workspaces/:id/tabs/:tab {name?, config?}
 *   DELETE /workspaces/:id/tabs/:tab
 *   GET    /frames                        every frame (for + Data)
 *   GET    /frames/:id                    rows, meta and hand edits
 *   POST   /frames/:id/refresh            runs its recipe again
 *   GET|PUT /frames/:id/script            its recipe
 *   PATCH  /frames/:id/cells {edits}      hand edits
 *
 * Every call needs a caller; writes must be same-origin JSON, since a signed-in browser session is
 * a cookie and a foreign page must not reach a person's data.
 */
import { frameEditSchema, frameName, frameScriptSchema } from '@columenlabs/lumen-ui-types/frames';
import { type CustomViewConfig, customViewConfigSchema } from '@columenlabs/lumen-ui-types/views';
import { z } from 'zod';
import { FrameError } from './frame';
import type { Workspaces } from './store';

type Awaitable<T> = T | Promise<T>;

export interface WorkspaceRoutesOptions {
  /** Where the routes are mounted (`/api/assistant`). */
  base: string;
  /** The store for this request (the caller's own). */
  store: (req: Request) => Awaitable<Workspaces>;
  /** The verified caller's owner id, or null (403). */
  owner: (req: Request) => Awaitable<string | null>;
  /** Which recipes this product runs; a recipe it refuses answers 422 with the reason. */
  allow?: (recipe: z.infer<typeof frameScriptSchema>, req: Request) => Awaitable<string | null>;
}

const HEADERS = { 'content-type': 'application/json', 'cache-control': 'no-store' };
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: HEADERS });
const fail = (error: string, status: number) => json({ error }, status);

const createSchema = z.object({ name: frameName, app: z.string().max(40).optional() });
const patchSchema = z.object({ name: frameName.optional(), app: z.string().max(40).optional() });
const addTabSchema = z.object({ name: frameName, recipe: frameScriptSchema });
const putTabSchema = z.object({
  name: frameName.optional(),
  config: customViewConfigSchema.nullable().optional(),
});
const cellsSchema = z.object({ edits: z.array(frameEditSchema).min(1).max(200) });
const scriptSchema = z.object({ script: frameScriptSchema });

export function workspaceRoutes(opts: WorkspaceRoutesOptions): (req: Request) => Promise<Response> {
  const base = opts.base.replace(/\/$/, '');
  return async (req) => {
    const url = new URL(req.url);
    if (!url.pathname.startsWith(base)) return fail('not_found', 404);
    const parts = url.pathname
      .slice(base.length)
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    const owner = await opts.owner(req);
    if (!owner) return fail('forbidden', 403);
    const write = req.method !== 'GET';
    if (write) {
      if (req.headers.get('origin') !== url.origin) return fail('forbidden_origin', 403);
      if (
        req.method !== 'DELETE' &&
        !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')
      )
        return fail('json_only', 415);
    }
    const body = async <T>(schema: z.ZodType<T>): Promise<T> => {
      const parsed = schema.safeParse(await req.json().catch(() => null));
      if (!parsed.success)
        throw new FrameError(
          parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
          400,
        );
      return parsed.data;
    };
    const allowed = async (recipe: z.infer<typeof frameScriptSchema>) => {
      if (recipe.kind !== 'call')
        throw new FrameError('Recipes here are one call to an app tool.', 422);
      const why = opts.allow ? await opts.allow(recipe, req) : null;
      if (why) throw new FrameError(why, 422);
    };

    try {
      const s = await opts.store(req);
      const [root, id, sub, tab] = parts;
      const m = req.method;
      if (root === 'workspaces') {
        if (!id) {
          if (m === 'GET') return json(await s.list(owner));
          if (m === 'POST') return json(await s.create(owner, await body(createSchema)));
        } else if (!sub) {
          if (m === 'GET') return json(await s.read(owner, id));
          if (m === 'PATCH') {
            const p = await body(patchSchema);
            return json(await s.patch(owner, id, p));
          }
          if (m === 'DELETE') {
            await s.remove(owner, id);
            return json({ ok: true });
          }
        } else if (sub === 'refresh' && !tab && m === 'POST') {
          return json(await s.refreshAll(owner, id));
        } else if (sub === 'tabs') {
          if (!tab && m === 'POST') {
            const p = await body(addTabSchema);
            await allowed(p.recipe);
            return json(await s.addTab(owner, id, { name: p.name, recipe: p.recipe }));
          }
          if (tab && m === 'PUT') {
            const p = await body(putTabSchema);
            return json(
              await s.putTab(owner, id, tab, {
                name: p.name,
                // The schema checks the layout; the tab's name rides beside it.
                config: p.config as CustomViewConfig | null | undefined,
              }),
            );
          }
          if (tab && m === 'DELETE') return json(await s.removeTab(owner, id, tab));
        }
      }
      if (root === 'frames') {
        if (!id) {
          if (m === 'GET') return json(await s.frames(owner));
          if (m === 'POST') return fail('Your own columns are not offered here yet.', 501);
        } else if (!sub && m === 'GET') {
          return json(await s.frame(owner, id));
        } else if (sub === 'refresh' && m === 'POST') {
          return json(await s.refresh(owner, id));
        } else if (sub === 'script') {
          if (m === 'GET') return json(await s.script(owner, id));
          if (m === 'PUT') {
            const p = await body(scriptSchema);
            await allowed(p.script);
            return json(await s.setScript(owner, id, p.script));
          }
        } else if (sub === 'cells' && m === 'PATCH') {
          return json(await s.editCells(owner, id, (await body(cellsSchema)).edits));
        }
      }
      return fail('not_found', 404);
    } catch (err) {
      if (err instanceof FrameError) return fail(err.message, err.status);
      console.error(JSON.stringify({ event: 'workspaces_error', error: String(err) }));
      return fail('Something went wrong.', 500);
    }
  };
}
