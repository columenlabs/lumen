/**
 * @columenlabs/lumen-person: one store per person, every app's tables in it. `PersonObject` runs
 * inside a Durable Object class; `personCall` reaches it from the Worker (or in place, from code
 * already running in that person's store).
 */
import { OBJECT_MODULE, PersonError, type PersonReply, insideStore } from './object';

export * from './move';
export * from './object';

/** What the Worker holds of the Durable Object namespace: the class's RPC `call` passes to `PersonObject.call`. */
export interface PersonNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): {
    call(owner: string, module: string, method: string, args?: unknown): Promise<PersonReply>;
  };
}

/** Calls `module.method(args)` in the person's store and returns its value, or throws its `PersonError`. */
export async function personCall<T>(
  ns: PersonNamespace,
  owner: string,
  module: string,
  method: string,
  args?: unknown,
): Promise<T> {
  const here = insideStore();
  if (here?.owner === owner) {
    // In place, copied as a stub call copies (structured clone, bytes included), so callers see the same values.
    try {
      const out = await here.call(module, method, structuredClone(args ?? null));
      return (out === undefined ? null : structuredClone(out)) as T;
    } catch (err) {
      if (err instanceof PersonError) throw err;
      throw new PersonError(502, `${module} failed`);
    }
  }
  const r = await ns.get(ns.idFromName(owner)).call(owner, module, method, args ?? null);
  if (!r.ok) throw new PersonError(r.status, r.error);
  return r.value as T;
}

/** One module of one person's store, so app code reads `career.call('stories')`. */
export function personModule(ns: PersonNamespace, owner: string, module: string) {
  return {
    call: <T>(method: string, args?: unknown) => personCall<T>(ns, owner, module, method, args),
    /** The store's own methods for this module: dumpModule, loadModule, wipeModule. */
    own: <T>(method: string, args?: Record<string, unknown>) =>
      personCall<T>(ns, owner, OBJECT_MODULE, method, { ...args, module }),
  };
}
