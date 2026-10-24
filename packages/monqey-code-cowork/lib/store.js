import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const statuses = ['todo', 'in_progress', 'waiting', 'done'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function id(value) { if (typeof value !== 'string' || !uuid.test(value)) throw Error('Invalid Co-work identifier.'); return value; }
function text(value, name, limit, empty = false) {
  if (typeof value !== 'string' || value.length > limit || (!empty && !value.trim())) throw Error(`${name} must contain ${empty ? 'at most' : '1 to'} ${limit} characters.`);
  return value.trim();
}
function actor(value) {
  if (!value || !['user', 'agent'].includes(value.kind)) throw Error('Invalid task actor.');
  return { kind: value.kind, id: text(value.id, 'Actor id', 100), label: text(value.label, 'Actor label', 100) };
}
export class CoworkStore {
  constructor(root) { this.directory = path.join(root, 'storages', 'cowork'); }
  file(workspaceId) { return path.join(this.directory, `${id(workspaceId)}.json`); }
  read(workspaceId) {
    const file = this.file(workspaceId);
    let board;
    try {
      if (fs.statSync(file).size > 16 * 1024 * 1024) throw Error('Co-work board exceeds its storage limit.');
      board = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) { if (error.code === 'ENOENT') return { format: 1, workspaceId, revision: 0, tasks: [], activity: [] }; throw Error('Co-work storage could not be read; existing data was retained.', { cause: error }); }
    this.validate(board, workspaceId);
    return board;
  }
  validate(board, workspaceId) {
    if (board?.format !== 1 || board.workspaceId !== workspaceId || !Number.isSafeInteger(board.revision) || board.revision < 0 || !Array.isArray(board.tasks) || board.tasks.length > 2000 || !Array.isArray(board.activity) || board.activity.length > 300) throw Error('Invalid Co-work storage; existing data was retained.');
    const ids = new Set();
    for (const task of board.tasks) {
      id(task.id); if (ids.has(task.id)) throw Error('Duplicate task in Co-work storage.'); ids.add(task.id);
      text(task.title, 'Title', 160); text(task.description, 'Description', 4000, true); text(task.assignee, 'Assignee', 100, true);
      if (!statuses.includes(task.status) || !Number.isSafeInteger(task.revision) || task.revision < 1 || typeof task.archived !== 'boolean' || !Array.isArray(task.dependencies) || task.dependencies.length > 50 || !Array.isArray(task.comments) || task.comments.length > 100 || !Number.isSafeInteger(task.createdAt) || !Number.isSafeInteger(task.updatedAt)) throw Error('Invalid task in Co-work storage.');
      if (task.linkedSessionId !== null) id(task.linkedSessionId);
      if (task.operationKey !== undefined) text(task.operationKey, 'Operation key', 250);
      actor(task.createdBy); actor(task.updatedBy);
      for (const comment of task.comments) { id(comment.id); text(comment.text, 'Comment', 2000); actor(comment.actor); if (!Number.isSafeInteger(comment.createdAt)) throw Error('Invalid task comment.'); }
    }
    const graph = new Map(board.tasks.map(task => [task.id, task.dependencies]));
    const visiting = new Set(), visited = new Set();
    const visit = key => { if (visiting.has(key)) throw Error('Task dependencies cannot form a cycle.'); if (visited.has(key)) return; visiting.add(key); for (const dependency of graph.get(key)) { id(dependency); if (!ids.has(dependency)) throw Error('Dependency belongs to another workspace or no longer exists.'); visit(dependency); } visiting.delete(key); visited.add(key); };
    for (const key of graph.keys()) visit(key);
    for (const event of board.activity) { id(event.id); id(event.taskId); actor(event.actor); text(event.text, 'Activity', 300); if (!Number.isSafeInteger(event.createdAt)) throw Error('Invalid activity.'); }
  }
  mutate(workspaceId, by, change) {
    const board = this.read(workspaceId);
    const result = change(board, actor(by));
    board.revision++;
    this.validate(board, workspaceId);
    const content = JSON.stringify(board);
    if (Buffer.byteLength(content) > 16 * 1024 * 1024) throw Error('Co-work board has reached its storage limit. Export or reduce old descriptions and comments first.');
    fs.mkdirSync(this.directory, { recursive: true });
    const file = this.file(workspaceId), temp = `${file}.${randomUUID()}.tmp`;
    try { fs.writeFileSync(temp, content, { mode: 0o600 }); fs.renameSync(temp, file); }
    finally { try { fs.unlinkSync(temp); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
    return { task: structuredClone(result), board };
  }
  event(board, task, by, message) {
    board.activity.unshift({ id: randomUUID(), taskId: task.id, actor: by, text: message, createdAt: Date.now() });
    board.activity = board.activity.slice(0, 300);
  }
  create(workspaceId, input, by, operationKey) {
    if (operationKey) {
      text(operationKey, 'Operation key', 250);
      const board = this.read(workspaceId), existing = board.tasks.find(task => task.operationKey === operationKey);
      if (existing) return { task: existing, board };
    }
    return this.mutate(workspaceId, by, (board, owner) => {
      if (board.tasks.length >= 2000) throw Error('This workspace has reached the 2,000-task limit.');
      const now = Date.now();
      const task = { id: randomUUID(), title: text(input.title, 'Title', 160), description: text(input.description ?? '', 'Description', 4000, true), assignee: text(input.assignee ?? '', 'Assignee', 100, true),
        status: 'todo', linkedSessionId: input.linkedSessionId == null ? null : id(input.linkedSessionId), dependencies: [], comments: [], revision: 1, archived: false, createdAt: now, updatedAt: now, createdBy: owner, updatedBy: owner,
        ...(operationKey ? { operationKey } : {}) };
      board.tasks.push(task); this.event(board, task, owner, `Created “${task.title}”.`); return task;
    });
  }
  update(workspaceId, taskId, revision, patch, by) {
    return this.mutate(workspaceId, by, (board, owner) => {
      const task = this.task(board, taskId, revision);
      const allowed = new Set(['title','description','assignee','status','dependencies','linkedSessionId','archived']);
      if (!patch || !Object.keys(patch).length || Object.keys(patch).some(key => !allowed.has(key))) throw Error('Invalid task changes.');
      if (patch.title !== undefined) task.title = text(patch.title, 'Title', 160);
      if (patch.description !== undefined) task.description = text(patch.description, 'Description', 4000, true);
      if (patch.assignee !== undefined) task.assignee = text(patch.assignee, 'Assignee', 100, true);
      if (patch.status !== undefined) { if (!statuses.includes(patch.status)) throw Error('Invalid task status.'); task.status = patch.status; }
      if (patch.dependencies !== undefined) { if (!Array.isArray(patch.dependencies) || patch.dependencies.length > 50) throw Error('Invalid task dependencies.'); task.dependencies = [...new Set(patch.dependencies.map(id))]; }
      if (patch.linkedSessionId !== undefined) task.linkedSessionId = patch.linkedSessionId === null ? null : id(patch.linkedSessionId);
      if (patch.archived !== undefined) { if (typeof patch.archived !== 'boolean') throw Error('Invalid archive state.'); task.archived = patch.archived; }
      const blocked = task.dependencies.filter(key => { const dependency = board.tasks.find(item => item.id === key); return !dependency || dependency.status !== 'done'; });
      if (task.status === 'done' && blocked.length) throw Error('Finish this task’s dependencies before marking it Done.');
      if (task.archived && task.status !== 'done' && board.tasks.some(other => !other.archived && other.status !== 'done' && other.dependencies.includes(task.id))) throw Error('Another open task depends on this task. Finish it before archiving.');
      // Dependency edits must not invalidate an already completed dependent.
      for (const other of board.tasks) if (other.status === 'done' && other.dependencies.includes(task.id) && task.status !== 'done') throw Error('Reopen completed dependent tasks before reopening this dependency.');
      task.revision++; task.updatedAt = Date.now(); task.updatedBy = owner;
      this.event(board, task, owner, `Updated “${task.title}” (${task.status.replace('_', ' ')}).`); return task;
    });
  }
  comment(workspaceId, taskId, revision, message, by) {
    return this.mutate(workspaceId, by, (board, owner) => {
      const task = this.task(board, taskId, revision);
      if (task.comments.length >= 100) throw Error('This task has reached the 100-comment limit.');
      task.comments.push({ id: randomUUID(), text: text(message, 'Comment', 2000), actor: owner, createdAt: Date.now() });
      task.revision++; task.updatedAt = Date.now(); task.updatedBy = owner;
      this.event(board, task, owner, `Commented on “${task.title}”.`); return task;
    });
  }
  task(board, taskId, revision) {
    const task = board.tasks.find(item => item.id === id(taskId));
    if (!task) throw Error('Task not found in this workspace.');
    if (!Number.isSafeInteger(revision) || task.revision !== revision) throw Error('This task changed since you read it. Reload the latest version before saving; your changes were not applied.');
    return task;
  }
}
