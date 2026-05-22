export interface EmotionState {
  curiosity: number
  confidence: number
  frustration: number
  fascination: number
  existential_tension: number
}

export interface Thought {
  id: number
  content: string
  emotion_state: string | EmotionState
  parent_thought_id: number | null
  created_at: string
  thought_type: string
}

export interface Memory {
  id: number
  content: string
  emotion_snapshot: string | EmotionState
  tags: string | null
  created_at: string
  last_accessed: string
}

export interface Goal {
  id: number
  description: string
  status: 'active' | 'achieved' | 'abandoned'
  priority: number
  created_at: string
  updated_at: string
  progress: number
}

export interface ConversationMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}

export interface SelfConversation {
  id: number
  content: string
  emotion_state: string | EmotionState
  timestamp: string
}

export interface SandboxResult {
  id: number
  query: string
  code: string
  result: string
  success: number
  timestamp: string
}

export interface PersonalityVersion {
  id: number
  version: number
  diff: string
  full_config: Record<string, unknown>
  created_at: string
}

export interface User {
  username: string
  role: string
  created_at?: string
}

export interface WsMessage {
  type: 'thought' | 'emotion_update' | 'goal_update' | 'sandbox_result' | 'evolution_proposal' | 'notification' | 'pong' | 'typing' | 'user_thought'
  data: unknown
}
