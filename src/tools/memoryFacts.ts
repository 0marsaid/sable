import { requiredId, requiredText, type Tool } from './types.js';

export function memoryTools(): Tool[] {
  const remember: Tool = {
    name: 'remember_fact',
    sensitive: false,
    description:
      'Save a durable fact about the user, such as a preference, a person in their life, or a detail they asked you to remember.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        fact: { type: 'string', description: 'One short fact, in the user\'s words when possible' },
      },
      required: ['fact'],
    },
    summarize: (args) => `Remember: ${String(args.fact ?? '')}`,
    validate: (args) => {
      const missing = requiredText(args, 'fact', 'fact');
      if (missing) return missing;
      if (String(args.fact).trim().length > 500) return 'Keep the fact under 500 characters.';
      return null;
    },
    async execute(args, ctx) {
      const fact = String(args.fact).trim();
      const saved = ctx.store.addFact(ctx.phone, fact);
      if (!saved.created) return `Already remembered (#${saved.id}): ${fact}`;
      return `Remembered (#${saved.id}): ${fact}`;
    },
  };

  const list: Tool = {
    name: 'list_facts',
    sensitive: false,
    description: 'List the durable facts saved about the user.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
    summarize: () => 'List remembered facts.',
    async execute(_args, ctx) {
      const facts = ctx.store.listFacts(ctx.phone);
      if (facts.length === 0) return 'No facts saved yet.';
      return facts.map((fact) => `#${fact.id}: ${fact.body}`).join('\n');
    },
  };

  const forget: Tool = {
    name: 'forget_fact',
    sensitive: true,
    description: 'Delete one saved fact by its id. This cannot be undone.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        id: { type: 'integer', description: 'Fact id from list_facts or the system prompt' },
      },
      required: ['id'],
    },
    summarize: (args, ctx) => {
      const id = requiredId(args);
      const fact = id ? ctx.store.getFact(ctx.phone, id) : undefined;
      return fact ? `Forget #${fact.id}: ${fact.body}` : `Forget fact #${String(args.id ?? '')}`;
    },
    validate: (args, ctx) => {
      const id = requiredId(args);
      if (!id) return 'id must be a positive integer.';
      if (!ctx.store.getFact(ctx.phone, id)) return `No fact with id ${id}.`;
      return null;
    },
    async execute(args, ctx) {
      const id = requiredId(args)!;
      const fact = ctx.store.getFact(ctx.phone, id);
      const removed = ctx.store.deleteFact(ctx.phone, id);
      if (!removed || !fact) return `No fact with id ${id}.`;
      return `Forgot #${id}: ${fact.body}`;
    },
  };

  return [remember, list, forget];
}
