# @columenlabs/lumen-vault

Envelope encryption for per-person data, Web Crypto only (Workers, Durable Objects, browsers, Bun).
A master key wraps one random data key per person; values are sealed with that person's key.

Two codecs, each a fixed stored format. Their constants never change: a change would make every
stored value unreadable.

## Envelope (`@columenlabs/lumen-vault/envelope`)

One master key derives an owner key (email → `u_<40 hex>`) and a wrap key (HKDF-SHA256, empty salt).
Each person's data key is stored wrapped (`v1.` + base64, AAD `vaults:<owner>`) wherever the app keeps
keys, through a `WrappedKeyStore`. Values seal to `v1.` + base64(iv ‖ ciphertext ‖ tag) with an AAD
the app names (`table:row`), so a sealed value can't be moved to another row.

```ts
import { EnvelopeVault } from '@columenlabs/lumen-vault/envelope';

const vault = new EnvelopeVault({
  kek: env.VAULT_KEK,             // base64 of 32 bytes
  store: {
    get: async (owner) => (await db.prepare('SELECT data_key FROM vaults WHERE owner = ?').bind(owner).first())?.data_key ?? null,
    putIfAbsent: async (owner, wrapped) => { await db.prepare('INSERT OR IGNORE INTO vaults (owner, data_key) VALUES (?, ?)').bind(owner, wrapped).run(); },
  },
  onUnlock: (e) => env.VAULT_LOG.writeDataPoint({ indexes: [e.owner], blobs: [e.event, e.error ?? ''], doubles: [e.ms] }),
});
const v = await vault.for('someone@example.com');
const sealed = await v.seal(`trades:${id}`, trade);
const back = await v.open(`trades:${id}`, sealed);
const key = await v.index('AAPL');    // a lookup key: equal values match
```

No master key fails closed. An app that offers a readable mode (self-hosting without a key) passes
`allowPlain: true`, and values are stored as `plain.` + JSON.

## Regional (`@columenlabs/lumen-vault/regional`)

One master key per region (raw 32 bytes, base64). Each person's AES-GCM data key is wrapped with
AES-KW and kept beside their data; values are bytes, iv ‖ ciphertext ‖ tag, with no AAD.

```ts
import { MasterKeys, dataKey, seal, unseal } from '@columenlabs/lumen-vault/regional';

const masters = new MasterKeys<'na' | 'eu'>((r) => (r === 'na' ? env.SEAL_KEY_NA : env.SEAL_KEY_EU)?.get() ?? null);
const key = await dataKey({
  master: masters.get(region),
  owner: personId,
  slot: {
    get: () => sql.exec("SELECT value FROM meta WHERE key = 'data_key'").toArray()[0]?.value ?? null,
    putIfAbsent: (w) => sql.exec("INSERT OR IGNORE INTO meta (key, value) VALUES ('data_key', ?)", w),
  },
});
const blob = await seal(key, accessToken);
```

## Unlock events

`onUnlock` gets one event each time a data key is unwrapped (`unwrap`), made (`create`) or fails
(`fail`, with a short `error` kind), with the owner id and the time it took. Never a key or a value.
The app adds its own context when it writes the event to its log.
