import './style.scss'
import { JabdamRoom } from './store'
import type { ChatMessage } from './types'

const room = new JabdamRoom()
const app = document.querySelector<HTMLDivElement>('#app')!

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function formatTime(ts: number): string {
  return new Intl.DateTimeFormat('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  }).format(ts)
}

function renderMessage(message: ChatMessage): string {
  const mine = message.clientId === room.clientId && message.type === 'chat'
  const system = message.type === 'system'
  const classes = ['msg', mine ? 'msg--mine' : '', system ? 'msg--system' : '']
    .filter(Boolean)
    .join(' ')

  if (system) {
    return `
      <article class="${classes}" data-id="${message.id}">
        <div class="msg__bubble">${escapeHtml(message.text)}</div>
      </article>
    `
  }

  return `
    <article class="${classes}" data-id="${message.id}">
      <div class="msg__meta">
        <span class="msg__nick">${escapeHtml(message.nickname)}</span>
        <time>${formatTime(message.createdAt)}</time>
      </div>
      <div class="msg__bubble">${escapeHtml(message.text)}</div>
    </article>
  `
}

function renderGate(): void {
  app.innerHTML = `
    <section class="gate" aria-label="잡담방 입장">
      <div class="gate__scene">
        <h1 class="gate__brand">잡담방</h1>
        <p class="gate__lead">가벼운 이야기만 두고 가는 밤의 라운지. 닉네임만 정하면 바로 들어올 수 있어요.</p>
        <form class="gate__form" id="enter-form">
          <label class="gate__label" for="nickname">닉네임</label>
          <div class="gate__row">
            <input
              class="gate__input"
              id="nickname"
              name="nickname"
              maxlength="16"
              autocomplete="nickname"
              placeholder="예: 밤에산책하는사람"
              required
            />
            <button class="btn" type="submit">들어가기</button>
          </div>
        </form>
      </div>
    </section>
  `

  const form = app.querySelector<HTMLFormElement>('#enter-form')!
  const input = app.querySelector<HTMLInputElement>('#nickname')!
  input.focus()

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const nickname = input.value.trim()
    if (!nickname) return
    room.enter(nickname)
    render()
  })
}

function renderRoom(): void {
  const previousScroll = app.querySelector<HTMLElement>('.feed')
  const previousInput = app.querySelector<HTMLInputElement>('#message')
  const draft = previousInput?.value ?? ''
  const hadFocus = document.activeElement === previousInput
  const wasNearBottom =
    !previousScroll ||
    previousScroll.scrollHeight - previousScroll.scrollTop - previousScroll.clientHeight < 80

  app.innerHTML = `
    <section class="room" aria-label="잡담방">
      <header class="room__top">
        <h1 class="room__brand">잡담방</h1>
        <div class="room__meta">
          <span class="presence-dot" aria-hidden="true"></span>
          <span>${room.onlineCount()}명 접속 중 · ${escapeHtml(room.nickname)}</span>
          <button class="btn btn--ghost" type="button" id="leave-btn">나가기</button>
        </div>
      </header>
      <div class="feed" id="feed" role="log" aria-live="polite">
        ${
          room.messages.length
            ? room.messages.map(renderMessage).join('')
            : `<p class="empty">아직 말이 없어요.<br />첫 잡담의 주인공이 되어 보세요.</p>`
        }
      </div>
      <form class="composer" id="composer">
        <p class="composer__hint">같은 브라우저의 다른 탭에서도 실시간으로 이어집니다.</p>
        <input
          class="composer__input"
          id="message"
          name="message"
          maxlength="500"
          placeholder="무슨 이야기 할까요?"
          autocomplete="off"
        />
        <button class="btn" type="submit">보내기</button>
      </form>
    </section>
  `

  const feed = app.querySelector<HTMLElement>('#feed')!
  if (wasNearBottom) {
    feed.scrollTop = feed.scrollHeight
  } else if (previousScroll) {
    feed.scrollTop = previousScroll.scrollTop
  }

  app.querySelector('#leave-btn')?.addEventListener('click', () => {
    room.leave()
    render()
  })

  const form = app.querySelector<HTMLFormElement>('#composer')!
  const input = app.querySelector<HTMLInputElement>('#message')!
  input.value = draft
  if (hadFocus || !previousInput) input.focus()
  input.selectionStart = input.selectionEnd = input.value.length

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const text = input.value
    if (!text.trim()) return
    room.send(text)
    input.value = ''
    input.focus()
  })
}

function render(): void {
  if (!room.nickname) renderGate()
  else renderRoom()
}

room.subscribe(() => {
  if (!room.nickname) return
  renderRoom()
})

render()
