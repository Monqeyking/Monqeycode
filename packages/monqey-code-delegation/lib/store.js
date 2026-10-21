import fs from 'node:fs';
import path from 'node:path';
import { addUsage, emptyUsage } from './manager.js';

export class TaskStore {
  constructor(root, schema) {
    this.directory = path.join(root, 'storages', 'workers');
    this.schema = schema;
    fs.mkdirSync(this.directory, { recursive: true });
  }
  file(parentId) {
    if (!/^[a-z0-9-]{1,100}$/i.test(parentId)) throw new Error('Invalid parent chat id.');
    return path.join(this.directory, `${parentId}.json`);
  }
  readDocument(parentId) {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file(parentId), 'utf8'));
      const archivedUsage = {};
      for (const key of Object.keys(emptyUsage())) {
        if (!Number.isFinite(raw.archivedUsage?.[key]) || raw.archivedUsage[key] < 0) throw new Error('Invalid archived worker usage.');
        archivedUsage[key] = raw.archivedUsage[key];
      }
      return { tasks: this.schema.parse(raw.tasks), archivedUsage };
    } catch (error) { if (error.code === 'ENOENT') return { tasks: [], archivedUsage: emptyUsage() }; throw error; }
  }
  read(parentId) { return this.readDocument(parentId).tasks; }
  totalUsage(parentId) {
    const document = this.readDocument(parentId);
    return document.tasks.reduce((sum, task) => addUsage(sum, task.usage), document.archivedUsage);
  }
  save(task) {
    const document = this.readDocument(task.parentId);
    const tasks = document.tasks.filter(item => item.id !== task.id);
    tasks.push(task);
    // Keep all active records and the latest 50 finished tasks per chat. Native
    // child sessions retain their own full history independently of this index.
    const running = tasks.filter(item => ['starting', 'running', 'recovering'].includes(item.status));
    const ended = tasks.filter(item => !running.includes(item));
    const finished = ended.slice(-50);
    const archivedUsage = ended.slice(0, Math.max(0, ended.length - 50)).reduce((sum, item) => addUsage(sum, item.usage), document.archivedUsage);
    const records = this.schema.parse([...finished, ...running]);
    const target = this.file(task.parentId);
    const temporary = `${target}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify({ tasks: records, archivedUsage }));
    fs.renameSync(temporary, target);
  }
}
