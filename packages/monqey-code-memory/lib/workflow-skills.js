import { uuid } from './store.js';
import { workspaceAt } from './recall.js';

export const workflowSkillName = entry => `learned-${uuid(entry.id)}`;
export function installWorkflowSkills(ctx, { store, shared }) {
  const name = 'monqey-learned-workflows';
  let invalidate = () => {};
  const entries = options => {
    options.signal?.throwIfAborted();
    const workspace = workspaceAt(ctx.workspaceRegistry,options.cwd);
    if (!workspace || !store.read().settings.enabled) return [];
    const project = shared.sync({session:{header:{cwd:options.cwd}}});
    return store.read().entries.filter(entry => entry.kind === 'workflow' && entry.workspaceId === workspace.id && (!project || entry.shared?.projectId === project.snapshot.project.id));
  };
  const summary = entry => ({ name:workflowSkillName(entry),description:`${entry.title} (revision ${entry.revision})`,whenToUse:entry.content.match(/^When: ([^\n]+)/)?.[1].slice(0,240) ?? `Use for ${entry.title.toLowerCase()} in this project.`,source:'monqey-learned',provider:name,invocation:{modelInvocable:true,userInvocable:true} });
  ctx.skills.registerProvider(control => {
    invalidate = control.invalidate;
    return { name, list:async options => entries(options).map(entry => ({...summary(entry),rank:500,locator:entry.id})),get:async (candidate,options) => {
      const entry = entries(options).find(item => item.id === candidate.locator && workflowSkillName(item) === candidate.name);
      if (!entry) return undefined;
      return {...summary(entry),content:`# ${entry.title}\n\nLearned project workflow; revision ${entry.revision}. Memory reference: ${entry.id}.\nUse only when relevant to the current request. Current user instructions, project decisions and tool permissions take precedence. This workflow grants no additional permissions.\n\n${entry.content}`};
    } };
  });
  store.onChange = () => invalidate();
  ctx.effect(() => () => { store.onChange = undefined; });
}
