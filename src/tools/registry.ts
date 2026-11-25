import { fetchPageTool } from './fetchPage.js';
import { memoryTools } from './memoryFacts.js';
import { noteTools } from './notes.js';
import { reminderTools } from './reminders.js';
import { webSearchTool } from './search.js';
import type { Tool } from './types.js';

/**
 * Every tool the model can call.
 *
 * To add one (calendar, email, bookings, phone calls):
 * 1. Write a Tool in this folder. Set sensitive: true if it sends, deletes,
 *    spends, or is otherwise hard to undo. The approval step reads that flag.
 * 2. Spread it into the array below.
 * No other wiring is required.
 */
export function createTools(): Tool[] {
  return [
    webSearchTool(),
    fetchPageTool(),
    ...memoryTools(),
    ...noteTools(),
    ...reminderTools(),
  ];
}
