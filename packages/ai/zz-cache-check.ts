import { aiModel } from './src/agent/models.ts';
import { refreshChatgpt, staleChatgpt } from './src/assistant/chatgpt.ts';
import { generateText } from 'ai';
import { readFileSync, writeFileSync } from 'node:fs';
const F = '/mnt/project-files/.secrets/chatgpt-plan-test.json';
let t = JSON.parse(readFileSync(F, 'utf8'));
if (staleChatgpt(t)) { t = await refreshChatgpt(t, fetch); writeFileSync(F, JSON.stringify(t), { mode: 0o600 }); }
const model = aiModel({ provider: 'openai', id: 'gpt-6.2-sol', label: 'Sol', group: 'OpenAI', in: 2, out: 10, read: 0.1 } as never, { apiKey: t.access_token, plan: true }, { name: 'Sage' });
const run = Date.now().toString(36);
const system = `Run ${run}. You are a terse CAD assistant.\n` + Array.from({ length: 400 }, (_, i) => `Rule ${i}: keep part ${i} at ${i * 3} mm and never round it.`).join('\n');
const msgs: any[] = [{ role: 'user', content: `Context ${run}: ` + Array.from({ length: 300 }, (_, i) => `feature F${i} sits at x=${i}.`).join(' ') + ' Say ok.' }];
const say = async (label: string, messages: any[]) => {
  const r = await generateText({ model, instructions: system, messages, providerOptions: { openai: { store: false } } });
  console.log(label, 'in', r.usage.inputTokens, 'read', r.usage.inputTokenDetails?.cacheReadTokens);
  return r;
};
const r1 = await say('call1', msgs);
msgs.push(...r1.response.messages, { role: 'user', content: 'Name feature F10 position only.' });
const r2 = await say('call2', msgs);
await say('compact-turnstart', [...msgs, { role: 'user', content: 'Summarize this conversation in one line.' }]);
