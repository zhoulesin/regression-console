import { SEED_TODO } from './todo.js';
import { SEED_ROUTINE, FLOW_BINDINGS_ROUTINE } from './routine.js';
import { SEED_CHORE, FLOW_BINDINGS_CHORE } from './chore.js';

export { SEED_TODO } from './todo.js';
export { SEED_ROUTINE } from './routine.js';
export { SEED_CHORE } from './chore.js';

/** 全部模块 seed；后续加 routine/chore 功能点只需改对应文件 */
export const SEED_FEATURES = [...SEED_TODO, ...SEED_ROUTINE, ...SEED_CHORE];

/** @type {{ feature_module: string, feature_code: string, path: string, kind: 'flow' }[]} */
export const FLOW_BINDINGS = [
  { feature_module: 'todo', feature_code: '0.1', path: 'maestro/cold-launch.yaml', kind: 'flow' },
  { feature_module: 'todo', feature_code: '0.2', path: 'maestro/kill-relaunch.yaml', kind: 'flow' },
  { feature_module: 'todo', feature_code: '0.3', path: 'maestro/switch-day-week.yaml', kind: 'flow' },
  { feature_module: 'todo', feature_code: '0.4', path: 'maestro/todo/open-root.yaml', kind: 'flow' },
  { feature_module: 'todo', feature_code: '1.1', path: 'maestro/todo/list-crud.yaml', kind: 'flow' },
  { feature_module: 'todo', feature_code: '1.2', path: 'maestro/todo/list-crud.yaml', kind: 'flow' },
  { feature_module: 'todo', feature_code: '1.3', path: 'maestro/todo/list-crud.yaml', kind: 'flow' },
  { feature_module: 'todo', feature_code: '1.4', path: 'maestro/todo/list-crud.yaml', kind: 'flow' },
  {
    feature_module: 'todo',
    feature_code: '1.5',
    path: 'maestro/todo/list-drag-sort.yaml',
    kind: 'flow',
  },
  ...FLOW_BINDINGS_ROUTINE,
  ...FLOW_BINDINGS_CHORE,
];
