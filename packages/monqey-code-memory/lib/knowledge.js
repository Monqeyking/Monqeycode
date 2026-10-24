const idPattern = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const textOf = blocks => (blocks ?? []).map(block => block.type === 'text' ? block.text : block.type === 'tool-result' ? textOf(block.content) : '').join('\n');
const json = text => { try { return JSON.parse(text); } catch { return null; } };

// Observe the dispatched request, not prompt previews or the available skill catalog.
export function usedKnowledge(messages, entries) {
  const found = new Map(), calls = new Map();
  const add = (id, revision, via) => {
    if (!Number.isSafeInteger(revision) || revision < 1 || !entries.some(entry => entry.id === id)) return;
    found.set(`${id}:${revision}:${via}`, {id,revision,via});
  };
  for (const message of messages) {
    const source = message.source;
    if (source?.kind === 'plugin' && source.plugin === '@deepseek-ai/dsh-system-prompt' && source.form === 'snapshot') {
      const section = source.sections?.find(section => section.name === 'monqey:local-memory');
      if (section && textOf(message.content).includes(section.text)) for (const match of section.text.matchAll(new RegExp(`^(?:preference|fact): [^\\n]*\\[(${idPattern}) r(\\d+)\\]:`, 'gmi'))) add(match[1],Number(match[2]),'context');
    }
    if (message.source?.kind === 'model') for (const block of message.content ?? []) {
      if (block.type === 'tool-call') calls.set(block.id,{name:block.name,args:json(block.arguments)});
    }
    if (message.source?.kind !== 'tool') continue;
    for (const block of message.content ?? []) {
      if (block.type !== 'tool-result' || block.isError) continue;
      const call = calls.get(block.toolCallId ?? message.source.callId), text = textOf(block.content);
      if (call?.name === 'memory_read') {
        const entry = json(text);
        if (entry?.id === call.args?.id) add(entry.id,entry.revision,'memory-read');
      } else if (call?.name === 'skill' && typeof call.args?.name === 'string' && call.args.name.startsWith('learned-')) {
        const id = call.args.name.slice(8), match = text.match(/Learned project workflow; revision (\d+)\. Memory reference: ([0-9a-f-]+)\./i);
        if (match?.[2] === id) add(id,Number(match[1]),'skill');
      }
    }
  }
  return [...found.values()];
}

export function knowledgeSummary(records, events, entries) {
  const closing = new Map();
  for (const event of events) if (event.type === 'assistant/message') closing.set(event.data.turn,event.data.message.id);
  const describe = references => [...new Map(references.map(ref => [ref.id,ref])).values()].flatMap(ref => {
    const entry = entries.find(entry => entry.id === ref.id);
    return entry ? [{...ref,title:entry.title,kind:entry.kind,currentRevision:entry.revision,shared:!!entry.shared}] : [];
  });
  return records.flatMap(record => closing.has(record.turn) ? [{turn:record.turn,messageId:closing.get(record.turn),used:describe(record.used),learned:describe(record.learned)}] : []);
}
