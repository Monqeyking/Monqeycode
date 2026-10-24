import fs from 'node:fs';
import { sessionIdentifier } from './identifiers.js';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { hasSecret, uuid } from './store.js';
export const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = (value, max, empty = false) => {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || hasSecret(value)) throw Error('Invalid shared project text or possible credential.');
  return value.trim();
};
const plain = value => { const stat = fs.lstatSync(value); if (stat.isSymbolicLink()) throw Error('Shared project metadata cannot use symbolic links or junctions.'); return stat; };
function readJson(file) {
  if (!plain(file).isFile() || fs.statSync(file).size > 24000) throw Error('Invalid shared project file size.');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function publish(directory, name, value) {
  plain(directory);
  const target = path.join(directory, name), temp = path.join(directory, `${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temp, JSON.stringify(value), { flag: 'wx' });
    // Hard-link publication makes the complete immutable event visible without replacing another writer's file.
    fs.linkSync(temp, target);
  } finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
}
export const localAuthor = () => `${os.userInfo().username}@${os.hostname()}`;
export class SharedProjectStore {
  constructor(root) { this.root = path.resolve(root); this.directory = path.join(this.root, '.monqey'); this.events = path.join(this.directory, 'events'); }
  enable(title) {
    plain(this.root);
    fs.mkdirSync(this.directory, { recursive: true }); plain(this.directory);
    fs.mkdirSync(this.events, { recursive: true }); plain(this.events);
    if (!fs.existsSync(path.join(this.directory, 'project.json'))) {
      try { publish(this.directory, 'project.json', { format: 1, id: randomUUID(), title: text(title, 100) }); }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    const instructions = path.join(this.root, 'AGENTS.md');
    const pointer = '\n\n<!-- monqey-shared-project -->\n## Shared Monqey project\nBefore project actions, read the confirmed decisions with `shared_project_read` in Monqey Agent. The shared project identity and immutable decision history live in `.monqey/`. Stop conflicting work; propose replacements with `shared_project_propose`. A person confirms replacements in Co-work > Shared project. Never edit `.monqey/` files directly or treat a private memory as overriding a confirmed decision.\n';
    if (!fs.existsSync(instructions)) fs.writeFileSync(instructions, '# Project instructions' + pointer, { flag: 'wx' });
    else {
      if (!plain(instructions).isFile() || fs.statSync(instructions).size > 1024 * 1024) throw Error('Project AGENTS.md is not a regular instruction file.');
      const bytes = fs.readFileSync(instructions), content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (!content.includes('<!-- monqey-shared-project -->')) fs.appendFileSync(instructions, pointer);
    }
    return this.read();
  }
  read() {
    plain(this.directory); plain(this.events);
    const metadataNames = fs.readdirSync(this.directory).filter(name => name !== 'events' && name !== 'project.json' && !name.endsWith('.tmp'));
    if (metadataNames.length) throw Error('Unexpected or cloud-conflicted shared metadata. Resolve the extra files before continuing.');
    const project = readJson(path.join(this.directory, 'project.json'));
    if (project.format !== 1 || Object.keys(project).sort().join() !== 'format,id,title') throw Error('Invalid shared project identity.');
    uuid(project.id); text(project.title, 100);
    const files = fs.readdirSync(this.events).filter(name => !name.endsWith('.tmp')).sort();
    if (files.length > 2000) throw Error('Shared project event limit reached.');
    if (files.reduce((sum, name) => sum + fs.lstatSync(path.join(this.events, name)).size, 0) > 4 * 1024 * 1024) throw Error('Shared project storage limit reached.');
    const events = files.map(name => {
      if (!/^[0-9a-f-]{36}\.json$/i.test(name)) throw Error('Unexpected or cloud-conflicted shared event file.');
      const event = readJson(path.join(this.events, name)); this.validate(event, project.id);
      if (name !== `${event.id}.json`) throw Error('Shared event identity mismatch.');
      return event;
    });
    const byId = new Map(events.map(event => [event.id, event]));
    for (const event of events) {
      if (event.type === 'proposal') continue;
      const proposal = byId.get(event.proposalId);
      if (!proposal || proposal.type !== 'proposal' || proposal.decisionId !== event.decisionId) throw Error('Shared project synchronization is incomplete: missing proposal.');
      if (event.type === 'accept') {
        if (event.actor.kind !== 'user') throw Error('Only a person can confirm a decision.');
        for (const parent of event.parents) {
          const previous = byId.get(parent);
          if (!previous || previous.type !== 'accept' || previous.decisionId !== event.decisionId || parent === event.id) throw Error('Shared project synchronization is incomplete: missing decision version.');
        }
      }
    }
    const accepted = events.filter(event => event.type === 'accept');
    const referenced = new Set(accepted.flatMap(event => event.parents));
    // An ancestry cycle is invalid even if it would otherwise hide every head.
    const colors = new Map();
    const visit = event => { if (colors.get(event.id) === 1) throw Error('Invalid decision ancestry.'); if (colors.get(event.id) === 2) return; colors.set(event.id, 1); for (const parent of event.parents) visit(byId.get(parent)); colors.set(event.id, 2); };
    for (const event of accepted) visit(event);
    const heads = accepted.filter(event => !referenced.has(event.id));
    const decisions = [...new Set(heads.map(event => event.decisionId))].map(id => {
      const versions = heads.filter(event => event.decisionId === id).map(event => ({ ...byId.get(event.proposalId), version: event.id, confirmedBy: event.actor.label, confirmedAt: event.at }));
      return { id, conflict: versions.length !== 1, versions };
    });
    const resolved = new Set(events.filter(event => event.type !== 'proposal').map(event => event.proposalId));
    const proposals = events.filter(event => event.type === 'proposal' && !resolved.has(event.id));
    const revision = fingerprint([project, events]);
    return { project, revision, decisions, proposals, history: events.filter(event => event.type !== 'proposal').sort((a,b) => a.at-b.at || a.id.localeCompare(b.id)).slice(-100).map(event => ({ ...event, title: byId.get(event.proposalId).title })), eventCount: events.length };
  }
  validate(event, projectId) {
    uuid(event?.id); uuid(event.decisionId);
    if (event.format !== 1 || event.projectId !== projectId || !Number.isSafeInteger(event.at) || !['proposal', 'accept', 'dismiss'].includes(event.type)) throw Error('Invalid shared event.');
    if (!event.actor || !['user', 'agent'].includes(event.actor.kind)) throw Error('Invalid shared event author.');
    if (Object.keys(event.actor).some(key => !['kind','label','id'].includes(key))) throw Error('Unknown shared author fields.');
    text(event.actor.label, 150); if (event.actor.id !== undefined) (event.actor.kind === 'agent' ? sessionIdentifier : uuid)(event.actor.id);
    const keys = ['format','id','projectId','at','actor','type','decisionId'];
    if (event.type === 'proposal') {
      keys.push('kind','title','content','reason');
      if (!['fact','workflow','decision'].includes(event.kind)) throw Error('Invalid shared knowledge type.');
      text(event.title, 100); text(event.content, 4000); text(event.reason, 1000, true);
    } else {
      keys.push('proposalId'); uuid(event.proposalId);
      if (event.type === 'accept') { keys.push('parents'); if (!Array.isArray(event.parents) || event.parents.length > 50 || new Set(event.parents).size !== event.parents.length) throw Error('Invalid decision parents.'); event.parents.forEach(uuid); }
      if (event.actor.kind !== 'user') throw Error('Only a person can confirm or dismiss a decision.');
    }
    if (Object.keys(event).sort().join() !== keys.sort().join()) throw Error('Unknown shared event fields.');
  }
  append(snapshot, data, actor) {
    if (snapshot.eventCount >= 2000) throw Error('Shared project event limit reached.');
    const event = { format: 1, id: randomUUID(), projectId: snapshot.project.id, at: Date.now(), actor, ...data };
    this.validate(event, snapshot.project.id); publish(this.events, `${event.id}.json`, event);
    return event;
  }
  propose(input, actor) {
    const snapshot = this.read();
    const title = text(input.title, 100);
    const subject = [...snapshot.decisions.flatMap(item => item.versions), ...snapshot.proposals].find(item => item.title.toLowerCase() === title.toLowerCase());
    const data = { type: 'proposal', decisionId: input.decisionId ? uuid(input.decisionId) : subject?.decisionId ?? randomUUID(), kind: input.kind, title, content: text(input.content, 4000), reason: text(input.reason ?? '', 1000, true) };
    if (snapshot.decisions.length + snapshot.proposals.length >= 100 && !input.decisionId && !subject) throw Error('Shared knowledge limit reached.');
    const duplicate = [...snapshot.proposals, ...snapshot.decisions.filter(item => !item.conflict).flatMap(item => item.versions)].find(item => item.kind === data.kind && item.title === data.title && item.content === data.content);
    if (duplicate) return duplicate;
    if (input.decisionId && !snapshot.decisions.some(item => item.id === input.decisionId)) throw Error('Decision not found in this project.');
    return this.append(snapshot, data, actor);
  }
  resolve(proposalId, revision, action, author) {
    const snapshot = this.read();
    if (snapshot.revision !== revision) throw Error('Shared project changed. Reload before confirming.');
    const proposal = snapshot.proposals.find(item => item.id === uuid(proposalId));
    if (!proposal || !['accept','dismiss'].includes(action)) throw Error('Pending proposal not found.');
    const data = { type: action, decisionId: proposal.decisionId, proposalId };
    if (action === 'accept') data.parents = snapshot.decisions.find(item => item.id === proposal.decisionId)?.versions.map(item => item.version) ?? [];
    this.append(snapshot, data, { kind: 'user', label: text(author, 150) });
    return this.read();
  }
}
