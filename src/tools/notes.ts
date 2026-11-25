import { requiredId, requiredText, type Tool } from './types.js';

function formatNote(note: { id: number; body: string; isTodo: boolean; done: boolean }): string {
  const kind = note.isTodo ? 'todo' : 'note';
  const mark = note.isTodo ? (note.done ? '[done] ' : '[open] ') : '';
  return `#${note.id} (${kind}) ${mark}${note.body}`;
}

export function noteTools(): Tool[] {
  const add: Tool = {
    name: 'add_note',
    sensitive: false,
    description: 'Save a note or a to-do. Use a to-do when the user wants something they can check off.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        text: { type: 'string' },
        todo: { type: 'boolean', description: 'True for a to-do, false for a plain note. Default false.' },
      },
      required: ['text'],
    },
    summarize: (args) => {
      const kind = args.todo === true ? 'to-do' : 'note';
      return `Save a ${kind}: ${String(args.text ?? '')}`;
    },
    validate: (args) => {
      const missing = requiredText(args, 'text', 'text');
      if (missing) return missing;
      if (String(args.text).trim().length > 2000) return 'Keep the note under 2000 characters.';
      return null;
    },
    async execute(args, ctx) {
      const text = String(args.text).trim();
      const todo = args.todo === true;
      const id = ctx.store.addNote(ctx.phone, text, todo);
      return `Saved ${todo ? 'to-do' : 'note'} #${id}: ${text}`;
    },
  };

  const list: Tool = {
    name: 'list_notes',
    sensitive: false,
    description: 'List notes and to-dos. Status defaults to open (not done).',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        status: { type: 'string', enum: ['open', 'done', 'all'] },
      },
    },
    summarize: (args) => `List ${typeof args.status === 'string' ? args.status : 'open'} notes.`,
    async execute(args, ctx) {
      const status = args.status === 'done' || args.status === 'all' ? args.status : 'open';
      const notes = ctx.store.listNotes(ctx.phone, status);
      if (notes.length === 0) return `No ${status} notes.`;
      return notes.map(formatNote).join('\n');
    },
  };

  const complete: Tool = {
    name: 'complete_todo',
    sensitive: false,
    description: 'Mark a to-do done by id.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    summarize: (args, ctx) => {
      const id = requiredId(args);
      const note = id ? ctx.store.getNote(ctx.phone, id) : undefined;
      return note ? `Mark #${note.id} done: ${note.body}` : `Mark to-do #${String(args.id ?? '')} done`;
    },
    validate: (args, ctx) => {
      const id = requiredId(args);
      if (!id) return 'id must be a positive integer.';
      const note = ctx.store.getNote(ctx.phone, id);
      if (!note) return `No note with id ${id}.`;
      if (!note.isTodo) return `#${id} is a note, not a to-do.`;
      if (note.done) return `#${id} is already done.`;
      return null;
    },
    async execute(args, ctx) {
      const id = requiredId(args)!;
      const note = ctx.store.getNote(ctx.phone, id);
      const ok = ctx.store.completeNote(ctx.phone, id);
      if (!ok || !note) return `Couldn't mark #${id} done.`;
      return `Done #${id}: ${note.body}`;
    },
  };

  const remove: Tool = {
    name: 'delete_note',
    sensitive: true,
    description: 'Permanently delete a note or to-do by id.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: { id: { type: 'integer' } },
      required: ['id'],
    },
    summarize: (args, ctx) => {
      const id = requiredId(args);
      const note = id ? ctx.store.getNote(ctx.phone, id) : undefined;
      return note ? `Delete #${note.id}: ${note.body}` : `Delete note #${String(args.id ?? '')}`;
    },
    validate: (args, ctx) => {
      const id = requiredId(args);
      if (!id) return 'id must be a positive integer.';
      if (!ctx.store.getNote(ctx.phone, id)) return `No note with id ${id}.`;
      return null;
    },
    async execute(args, ctx) {
      const id = requiredId(args)!;
      const note = ctx.store.getNote(ctx.phone, id);
      const ok = ctx.store.deleteNote(ctx.phone, id);
      if (!ok || !note) return `No note with id ${id}.`;
      return `Deleted #${id}: ${note.body}`;
    },
  };

  return [add, list, complete, remove];
}
