import type { ChatMessage, Presence, SyncPayload } from './types'

const STORAGE_KEY = 'jabdam.messages.v1'
const CHANNEL_NAME = 'jabdam.room'
const PRESENCE_TTL_MS = 20_000
const MAX_MESSAGES = 200

function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function loadMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatMessage[]
    return Array.isArray(parsed) ? parsed.slice(-MAX_MESSAGES) : []
  } catch {
    return []
  }
}

function saveMessages(messages: ChatMessage[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-MAX_MESSAGES)))
}

export class JabdamRoom {
  readonly clientId = uid()
  nickname = ''
  messages: ChatMessage[] = loadMessages()
  presence = new Map<string, Presence>()

  private channel: BroadcastChannel | null = null
  private heartbeatTimer: number | null = null
  private pruneTimer: number | null = null
  private listeners = new Set<() => void>()

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  private post(payload: SyncPayload): void {
    this.channel?.postMessage(payload)
  }

  enter(nickname: string): void {
    this.nickname = nickname.trim().slice(0, 16)
    if (!this.nickname) return

    this.channel = new BroadcastChannel(CHANNEL_NAME)
    this.channel.onmessage = (event: MessageEvent<SyncPayload>) => {
      this.handlePayload(event.data)
    }

    const join: ChatMessage = {
      id: uid(),
      type: 'system',
      nickname: '잡담방',
      text: `${this.nickname} 님이 들어왔어요.`,
      createdAt: Date.now(),
      clientId: this.clientId,
    }
    this.appendMessage(join, true)

    this.touchPresence()
    this.post({ kind: 'hello', presence: this.selfPresence() })
    this.post({ kind: 'history', messages: this.messages })

    this.heartbeatTimer = window.setInterval(() => {
      this.touchPresence()
      this.post({ kind: 'presence', presence: this.selfPresence() })
    }, 5_000)

    this.pruneTimer = window.setInterval(() => this.prunePresence(), 3_000)

    window.addEventListener('beforeunload', this.onUnload)
    this.emit()
  }

  leave(): void {
    this.post({ kind: 'bye', clientId: this.clientId })
    if (this.nickname) {
      const leave: ChatMessage = {
        id: uid(),
        type: 'system',
        nickname: '잡담방',
        text: `${this.nickname} 님이 나갔어요.`,
        createdAt: Date.now(),
        clientId: this.clientId,
      }
      this.appendMessage(leave, true)
    }
    this.cleanup()
    this.nickname = ''
    this.emit()
  }

  send(text: string): void {
    const trimmed = text.trim().slice(0, 500)
    if (!trimmed || !this.nickname) return

    const message: ChatMessage = {
      id: uid(),
      type: 'chat',
      nickname: this.nickname,
      text: trimmed,
      createdAt: Date.now(),
      clientId: this.clientId,
    }
    this.appendMessage(message, true)
    this.post({ kind: 'message', message })
  }

  onlineCount(): number {
    this.prunePresence()
    const others = [...this.presence.values()].filter((p) => p.clientId !== this.clientId)
    return others.length + (this.nickname ? 1 : 0)
  }

  private selfPresence(): Presence {
    return {
      clientId: this.clientId,
      nickname: this.nickname,
      lastSeen: Date.now(),
    }
  }

  private touchPresence(): void {
    this.presence.set(this.clientId, this.selfPresence())
  }

  private upsertPresence(presence: Presence): boolean {
    const prev = this.presence.get(presence.clientId)
    this.presence.set(presence.clientId, presence)
    if (!prev) return true
    return prev.nickname !== presence.nickname
  }

  private prunePresence(): void {
    const now = Date.now()
    let changed = false
    for (const [id, p] of this.presence) {
      if (now - p.lastSeen > PRESENCE_TTL_MS) {
        this.presence.delete(id)
        changed = true
      }
    }
    if (changed) this.emit()
  }

  private handlePayload(payload: SyncPayload): void {
    switch (payload.kind) {
      case 'hello':
        const helloChanged = this.upsertPresence(payload.presence)
        this.post({ kind: 'presence', presence: this.selfPresence() })
        this.post({ kind: 'history', messages: this.messages })
        if (helloChanged) this.emit()
        break
      case 'presence':
        if (this.upsertPresence(payload.presence)) this.emit()
        break
      case 'bye':
        this.presence.delete(payload.clientId)
        this.emit()
        break
      case 'message':
        this.appendMessage(payload.message, false)
        break
      case 'history':
        this.mergeHistory(payload.messages)
        break
    }
  }

  private appendMessage(message: ChatMessage, broadcastLocal: boolean): void {
    if (this.messages.some((m) => m.id === message.id)) return
    this.messages = [...this.messages, message].slice(-MAX_MESSAGES)
    if (broadcastLocal) saveMessages(this.messages)
    else saveMessages(this.messages)
    this.emit()
  }

  private mergeHistory(incoming: ChatMessage[]): void {
    const map = new Map<string, ChatMessage>()
    for (const m of this.messages) map.set(m.id, m)
    for (const m of incoming) map.set(m.id, m)
    const merged = [...map.values()].sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_MESSAGES)
    const changed =
      merged.length !== this.messages.length ||
      merged.some((m, i) => m.id !== this.messages[i]?.id)
    if (!changed) return
    this.messages = merged
    saveMessages(this.messages)
    this.emit()
  }

  private onUnload = (): void => {
    this.post({ kind: 'bye', clientId: this.clientId })
    this.cleanup()
  }

  private cleanup(): void {
    window.removeEventListener('beforeunload', this.onUnload)
    if (this.heartbeatTimer !== null) window.clearInterval(this.heartbeatTimer)
    if (this.pruneTimer !== null) window.clearInterval(this.pruneTimer)
    this.heartbeatTimer = null
    this.pruneTimer = null
    this.channel?.close()
    this.channel = null
    this.presence.clear()
  }
}
