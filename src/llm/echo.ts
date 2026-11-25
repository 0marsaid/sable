import type { ChatMessage, ChatRequest, ChatResult, LlmClient } from './types.js';

function userText(message: ChatMessage | undefined): { text: string; hasImage: boolean } {
  if (!message || message.role !== 'user') return { text: '', hasImage: false };
  if (typeof message.content === 'string') return { text: message.content, hasImage: false };
  const text = message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join(' ')
    .trim();
  const hasImage = message.content.some((part) => part.type === 'image_url');
  return { text, hasImage };
}

/**
 * Offline stand-in used when LLM_MODE=mock.
 * It echoes text and acknowledges photos. It does not call tools.
 */
export class EchoLlm implements LlmClient {
  readonly configured = true;

  async chat(input: ChatRequest): Promise<ChatResult> {
    const last = input.messages[input.messages.length - 1];
    if (last?.role === 'tool') {
      return { content: `Done. ${last.content}`, toolCalls: [] };
    }
    const user = [...input.messages].reverse().find((message) => message.role === 'user');
    const { text, hasImage } = userText(user);
    if (hasImage) {
      const caption = text ? ` You wrote: ${text}` : '';
      return {
        content: `I can see the photo.${caption} This local mock model can't describe it — set LLM_API_KEY to use a vision model.`,
        toolCalls: [],
      };
    }
    return { content: `You said: ${text}`, toolCalls: [] };
  }
}
