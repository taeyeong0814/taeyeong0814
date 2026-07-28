export type ChatMessage = {
  id: string
  type: 'chat' | 'system'
  nickname: string
  text: string
  createdAt: number
  clientId: string
}

export type Presence = {
  clientId: string
  nickname: string
  lastSeen: number
}

export type SyncPayload =
  | { kind: 'hello'; presence: Presence }
  | { kind: 'presence'; presence: Presence }
  | { kind: 'bye'; clientId: string }
  | { kind: 'message'; message: ChatMessage }
  | { kind: 'history'; messages: ChatMessage[] }
