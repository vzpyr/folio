import { saveSettings, loadSettings } from "../util/settings.ts";
import type { ToolCall } from "./chat.ts";

export interface AIConfig {
  baseUrl: string;
  token: string;
  model: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "tool" | "system" | "error";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
  detail?: string;
}

export const aiConfig = $state<AIConfig>(readConfig());

export const chatState = $state<{
  open: boolean;
  busy: boolean;
  messages: ChatMessage[];
}>({ open: false, busy: false, messages: [] });

function readConfig(): AIConfig {
  const s = loadSettings();

  return { baseUrl: s.aiBaseUrl, token: s.aiToken, model: s.aiModel };
}

export function updateAiConfig(patch: Partial<AIConfig>): void {
  Object.assign(aiConfig, patch);
  saveSettings({
    aiBaseUrl: aiConfig.baseUrl,
    aiToken: aiConfig.token,
    aiModel: aiConfig.model,
  });
}

export function aiConfigured(): boolean {
  return !!aiConfig.baseUrl && !!aiConfig.model;
}

export function openChat(): void {
  chatState.open = true;
}

export function closeChat(): void {
  chatState.open = false;
}

export function clearChat(): void {
  chatState.messages = [];
}

export function uid(): string {
  return crypto.randomUUID();
}
