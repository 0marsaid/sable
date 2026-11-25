export type TextPart = { type: 'text'; text: string };
export type ImagePart = { type: 'image_url'; imageUrl: string };
export type ContentPart = TextPart | ImagePart;

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type ToolSchema = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ChatRequest = {
  messages: ChatMessage[];
  tools: ToolSchema[];
  model?: string;
};

export type ChatResult = {
  content: string | null;
  toolCalls: ToolCall[];
};

export interface LlmClient {
  readonly configured: boolean;
  chat(input: ChatRequest): Promise<ChatResult>;
}
