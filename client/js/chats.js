const token = localStorage.getItem('token');
const me    = JSON.parse(localStorage.getItem('user') || 'null');

if (!token || !me) window.location.href = '/';

let currentChatId   = null;
let currentChatType = null;
let oldestMessageId = null;
let hasMore         = true;
let modalMode       = 'private';
let allUsers        = [];
let typingTimer     = null;
let unreadCounts    = {};

const myAvatar = document.getElementById("my-avatar");
const myUsername = document.getElementById("my-username");
const avatarInput = document.getElementById("avatarInput");

if (myAvatar && myUsername) {
  myUsername.textContent = me.username;

  showMyAvatar();

  myAvatar.style.cursor = "pointer";
  myAvatar.title = "Изменить аватар";
  myAvatar.addEventListener("click", function() {
    if (avatarInput) {
      avatarInput.click();
    }
  });
}

if (avatarInput) {
  avatarInput.addEventListener("change", uploadAvatar);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  return res;
}

const socket = io({ auth: { token } });
socket.on('connect', () => console.log('Socket подключён'));
socket.on('connect_error', (err) => console.error('Socket ошибка:', err.message));


socket.on("group_created", async function(group) {
  console.log(
    "Добавлена новая группа:",
    group.name
  );

  await loadChats();
});

socket.on("new_message", function(msg) {
  if (
    Number(msg.chat_id) === Number(currentChatId) &&
    Number(msg.sender_id) !== Number(me.id)
  ) {
    appendMessage(msg);
    scrollToBottom();
    socket.emit("read_messages", {
      chatId: currentChatId
    });

  } else if (
    Number(msg.sender_id) !== Number(me.id)
  ) {
    unreadCounts[msg.chat_id] =
      (unreadCounts[msg.chat_id] || 0) + 1;

    updateUnreadBadge(msg.chat_id);
  }

  updateChatPreview(
    msg.chat_id,
    msg.text
  );
});

socket.on('messages_read', ({ chatId }) => {
  if (Number(chatId) === Number(currentChatId)) {
    document.querySelectorAll('.msg-read-status').forEach(el => {
      el.textContent = '✓✓';
      el.style.color = 'rgba(255,255,255,1)';
      el.title = 'Прочитано';
    });
  }
});
socket.on('typing', ({ username, chatId }) => {
  if (Number(chatId) !== Number(currentChatId)) return;
  const el = document.getElementById('typing-indicator');
  if (el) {
    el.textContent = `${username} печатает...`;
    el.style.display = 'block';
  }
});

socket.on('stop_typing', ({ chatId }) => {
  if (Number(chatId) !== Number(currentChatId)) return;
  const el = document.getElementById('typing-indicator');
  if (el) el.style.display = 'none';
});
socket.on("chat_deleted", async function(data) {
  const deletedChatId = Number(data.chatId);

  console.log(
    "Удалён чат:",
    deletedChatId
  );
  const chatItem = document.getElementById(
    "chat-item-" + deletedChatId
  );

  if (chatItem) {
    chatItem.remove();
  }
  if (
    Number(currentChatId) === deletedChatId
  ) {
    currentChatId = null;
    currentChatType = null;
    oldestMessageId = null;
    hasMore = true;

    document.getElementById("chat-area").innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">
          <svg
            width="28"
            height="28"
            fill="none"
            stroke="var(--muted)"
            stroke-width="1.5"
            viewBox="0 0 24 24"
          >
            <path
              d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"
            />
          </svg>
        </div>

        <p>Чат был удалён</p>
      </div>
    `;
  }
  await loadChats();
});
function updateUnreadBadge(chatId) {
  const item = document.getElementById(`chat-item-${chatId}`);
  if (!item) return;

  let badge = item.querySelector('.unread-badge');
  const count = unreadCounts[chatId] || 0;

  if (count > 0) {
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'unread-badge';
      badge.style.cssText = 'min-width:18px;height:18px;background:var(--primary);color:#fff;border-radius:9px;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;padding:0 5px;margin-left:auto;flex-shrink:0;';
      item.querySelector('.chat-item-top').appendChild(badge);
    }
    badge.textContent = count > 99 ? '99+' : count;
  } else {
    if (badge) badge.remove();
  }
}

async function loadChats() {
  const res  = await api('/chats');
  const data = await res.json();
  const list = document.getElementById('chat-list');

  if (!data.length) {
    list.innerHTML = '<div style="padding:24px 16px;color:var(--muted);text-align:center;font-size:13px">Нет чатов — создайте первый</div>';
    return;
  }

  list.innerHTML = data.map(chat => {
    const isSaved = chat.type === 'saved';
    const isGroup = chat.type === 'group';
    const initial = isSaved ? '★' : (chat.name || '?')[0].toUpperCase();
    const avatarClass = isSaved ? 'saved' : isGroup ? 'group' : '';
    const displayName = isSaved ? 'Избранное' : (chat.name || 'Без названия');
    return `
      <div class="chat-item" id="chat-item-${chat.id}" onclick="openChat(${chat.id}, '${escHtml(displayName)}', '${chat.type}')">
        <div class="chat-item-top">
          <div class="chat-avatar ${avatarClass}">${chat.avatar && chat.type === "private"? `<img src="${chat.avatar}" alt="Аватар" >` : initial}</div>
          <div class="chat-item-name">${escHtml(displayName)}</div>
          ${isGroup ? '<span class="chat-type-badge">группа</span>' : ''}
          ${isSaved ? '<span class="chat-type-badge">заметки</span>' : ''}
        </div>
        <div class="chat-item-preview">${escHtml(chat.last_message || 'Нет сообщений')}</div>
      </div>
    `;
  }).join('');
}

function updateChatPreview(chatId, text) {
  const el = document.querySelector(`#chat-item-${chatId} .chat-item-preview`);
  if (el) el.textContent = text;
}

async function openChat(chatId, chatName, chatType) {
  currentChatId   = Number(chatId);
  currentChatType = chatType || null;
  oldestMessageId = null;
  hasMore         = true;
  unreadCounts[chatId] = 0;
  updateUnreadBadge(chatId);

  document.querySelectorAll('.chat-item').forEach(el => el.classList.remove('active'));
  const activeItem = document.getElementById(`chat-item-${chatId}`);
  if (activeItem) activeItem.classList.add('active');

  socket.emit('join_chat', currentChatId);
  socket.emit('read_messages', { chatId: currentChatId });

  const membersBtn = chatType === 'group' ? `
    <button onclick="openMembersModal()" style="width:34px;height:34px;border:1px solid var(--border);background:var(--bg);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--muted);" title="Участники">
      <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
    </button>
  ` : '';

  document.getElementById('chat-area').innerHTML = `
    <div style="background:var(--surface);border-bottom:1px solid var(--border);padding:14px 20px;display:flex;align-items:center;gap:10px;">
      <div style="width:36px;height:36px;border-radius:50%;background:var(--primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;">${(chatName||'?')[0].toUpperCase()}</div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:15px;color:var(--text)">${escHtml(chatName)}</div>
        <div id="typing-indicator" style="display:none;font-size:11px;color:var(--primary);font-style:italic;margin-top:1px;"></div>
      </div>
      ${membersBtn}
      <button onclick="toggleSearch()" style="width:34px;height:34px;border:1px solid var(--border);background:var(--bg);border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--muted);" title="Поиск">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
      </button>
      <button onclick="deleteChat()" style="width:34px;height:34px;border:1px solid #f0cccb;background:#fdf0ef;border-radius:8px;cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--danger);" title="Удалить чат">
        <svg width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
      </button>
    </div>
    <div id="search-bar" style="display:none;padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--border);gap:8px;align-items:center;">
      <input type="text" id="search-input" placeholder="Поиск по сообщениям..." style="flex:1;padding:8px 12px;border:1.5px solid var(--border);border-radius:8px;font-size:13px;outline:none;background:var(--bg);">
      <button onclick="searchMessages()" class="btn btn-primary" style="padding:8px 14px;font-size:13px;">Найти</button>
      <button onclick="clearSearch()" style="width:30px;height:30px;border:none;background:none;cursor:pointer;color:var(--muted);font-size:18px;">×</button>
    </div>
    <div id="search-results"></div>
    <div id="messages-container" style="flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:6px;" onscroll="handleScroll()">
      <div style="text-align:center;color:var(--muted);font-size:13px">Загрузка...</div>
    </div>
    <div style="background:var(--surface);border-top:1px solid var(--border);padding:12px 16px;display:flex;gap:10px;align-items:flex-end;">
      <textarea id="msg-input" placeholder="Написать сообщение..." rows="1"
        style="flex:1;border:1.5px solid var(--border);border-radius:20px;padding:10px 16px;font-size:14px;outline:none;resize:none;max-height:120px;font-family:inherit;background:var(--bg);color:var(--text);transition:border-color .15s;"
        onkeydown="handleMsgKey(event)" oninput="handleTyping(event)"
        onfocus="this.style.borderColor='var(--primary)'" onblur="this.style.borderColor='var(--border)'"></textarea>
      <button onclick="sendMessage()" style="width:40px;height:40px;background:var(--primary);border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0;" onmouseover="this.style.background='var(--primary-h)'" onmouseout="this.style.background='var(--primary)'">
        <svg width="16" height="16" fill="none" stroke="#fff" stroke-width="2.5" viewBox="0 0 24 24"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
      </button>
    </div>
  `;

  await loadMessages();
  document.getElementById('msg-input').focus();
}

async function loadMessages(prepend = false) {
  if (!hasMore && prepend) return;

  const url = oldestMessageId
    ? `/chats/${currentChatId}/messages?limit=30&before=${oldestMessageId}`
    : `/chats/${currentChatId}/messages?limit=30`;

  const res  = await api(url);
  const msgs = await res.json();
  const container = document.getElementById('messages-container');

  if (!msgs.length) {
    hasMore = false;
    if (!prepend) container.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:20px 0;">Нет сообщений — напишите первым!</div>';
    return;
  }
  if (msgs.length < 30) hasMore = false;
  oldestMessageId = msgs[0].id;

  if (prepend) {
    const prevHeight = container.scrollHeight;
    const btn = document.getElementById('load-more-btn');
    if (btn) btn.remove();
    if (hasMore) container.prepend(makeLoadMoreBtn());
    msgs.forEach(m => {
      const el  = createMessageEl(m);
      const ref = container.children[hasMore ? 1 : 0];
      ref ? container.insertBefore(el, ref) : container.appendChild(el);
    });
    container.scrollTop = container.scrollHeight - prevHeight;
  } else {
    container.innerHTML = '';
    if (hasMore) container.appendChild(makeLoadMoreBtn());
    msgs.forEach(m => container.appendChild(createMessageEl(m)));
    scrollToBottom();
  }
}
function showMyAvatar() {
  if (!myAvatar) {
    return;
  }

  if (me.avatar) {
    myAvatar.innerHTML = `
      <img
        src="${me.avatar}"
        alt="Аватар"
        style="
          width: 100%;
          height: 100%;
          border-radius: 50%;
          object-fit: cover;
        "
      >
    `;
  } else {
    myAvatar.textContent =
      me.username[0].toUpperCase();
  }
}
function makeLoadMoreBtn() {
  const btn = document.createElement('button');
  btn.id = 'load-more-btn';
  btn.textContent = 'Загрузить ещё';
  btn.style.cssText = 'align-self:center;padding:6px 16px;background:var(--surface);border:1px solid var(--border);border-radius:20px;font-size:12px;cursor:pointer;color:var(--muted);margin-bottom:8px;';
  btn.onclick = () => loadMessages(true);
  return btn;
}

function createMessageEl(msg) {
  const isMine = Number(msg.sender_id) === Number(me.id);
  const div = document.createElement('div');
  div.style.cssText = `display:flex;flex-direction:column;align-items:${isMine ? 'flex-end' : 'flex-start'};`;
  div.dataset.messageId = msg.id;
  div.innerHTML = `
    ${!isMine ? `<div style="font-size:11px;font-weight:600;color:var(--primary);margin-bottom:3px;padding-left:4px;">${escHtml(msg.sender_name)}</div>` : ''}
    <div style="max-width:65%;padding:10px 14px;border-radius:${isMine ? '16px 16px 4px 16px' : '16px 16px 16px 4px'};background:${isMine ? 'var(--primary)' : 'var(--surface)'};color:${isMine ? '#fff' : 'var(--text)'};font-size:14px;line-height:1.5;border:${isMine ? 'none' : '1px solid var(--border)'};">
      ${escHtml(msg.text)}
      <div style="font-size:10px;opacity:.6;margin-top:4px;text-align:right;display:flex;align-items:center;justify-content:flex-end;gap:6px;">
        <span>${formatTime(msg.created_at)}</span>
        ${isMine ? `<span class="msg-read-status" style="color:${msg.is_read ? 'rgba(255,255,255,1)' : 'rgba(255,255,255,0.5)'};" title="${msg.is_read ? 'Прочитано' : 'Доставлено'}">${msg.is_read ? '✓✓' : '✓'}</span>` : ''}
        ${isMine ? `<span onclick="deleteMessage(${msg.id})" style="cursor:pointer;opacity:.7;font-size:10px;" title="Удалить">✕</span>` : ''}
      </div>
    </div>
  `;
  return div;
}

function appendMessage(msg) {
  const container = document.getElementById('messages-container');
  if (!container) return;
  container.appendChild(createMessageEl(msg));
}

function sendMessage() {
  const input = document.getElementById('msg-input');
  const text  = input.value.trim();
  if (!text || !currentChatId) return;

  const tempMsg = {
    id:          Date.now(),
    chat_id:     currentChatId,
    sender_id:   me.id,
    sender_name: me.username,
    text:        text,
    created_at:  new Date().toISOString(),
    is_read:     false,
  };
  appendMessage(tempMsg);
  scrollToBottom();
  updateChatPreview(currentChatId, text);
  socket.emit('send_message', { chatId: currentChatId, text });
  socket.emit('stop_typing', { chatId: currentChatId });
  clearTimeout(typingTimer);
  input.value = '';
  input.style.height = 'auto';
}

function handleTyping(e) {
  autoResize(e.target);
  if (!currentChatId) return;
  socket.emit('typing', { chatId: currentChatId });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit('stop_typing', { chatId: currentChatId });
  }, 2000);
}

function handleMsgKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
}

function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 120) + 'px';
}

function handleScroll() {
  const c = document.getElementById('messages-container');
  if (c && c.scrollTop < 60 && hasMore) loadMessages(true);
}

async function deleteMessage(messageId) {
  if (!confirm('Удалить сообщение?')) return;
  const res = await api(`/chats/${currentChatId}/messages/${messageId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Не удалось удалить'); return; }
  const el = document.querySelector(`[data-message-id="${messageId}"]`);
  if (el) el.remove();
}

async function deleteChat() {
  if (!currentChatId) return;
  if (!confirm('Удалить чат вместе со всеми сообщениями?')) return;
  const res = await api(`/chats/${currentChatId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Не удалось удалить чат'); return; }
  currentChatId = null;
  currentChatType = null;
  document.getElementById('chat-area').innerHTML = `
    <div class="empty-state">
      <div class="empty-icon">
        <svg width="28" height="28" fill="none" stroke="var(--muted)" stroke-width="1.5" viewBox="0 0 24 24">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </div>
      <p>Выберите чат или создайте новый</p>
    </div>
  `;
  await loadChats();
}

function toggleSearch() {
  const bar = document.getElementById('search-bar');
  const show = bar.style.display === 'none';
  bar.style.display = show ? 'flex' : 'none';
  if (show) document.getElementById('search-input').focus();
  else clearSearch();
}

async function searchMessages() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  const res     = await api(`/chats/${currentChatId}/search?q=${encodeURIComponent(q)}`);
  const results = await res.json();
  const el      = document.getElementById('search-results');
  if (!results.length) {
    el.innerHTML = '<div style="padding:10px 16px;font-size:13px;color:var(--muted);background:var(--surface);border-bottom:1px solid var(--border);">Ничего не найдено</div>';
    return;
  }
  el.innerHTML = `<div style="padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--border);max-height:160px;overflow-y:auto;">
    <div style="font-size:11px;color:var(--muted);margin-bottom:8px;font-weight:600;letter-spacing:.04em;">НАЙДЕНО: ${results.length}</div>
    ${results.map(m => `<div style="padding:6px 8px;border-radius:6px;font-size:13px;color:var(--muted);" onmouseover="this.style.background='var(--bg)'" onmouseout="this.style.background='none'"><b style="color:var(--text)">${escHtml(m.sender_name)}</b>: ${escHtml(m.text)}</div>`).join('')}
  </div>`;
}

function clearSearch() {
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  const bar = document.getElementById('search-bar');
  if (input) input.value = '';
  if (results) results.innerHTML = '';
  if (bar) bar.style.display = 'none';
}

async function openMembersModal() {
  if (!currentChatId) return;
  document.getElementById('members-modal').classList.add('open');
  await loadMembers();
}

function closeMembersModal(e) {
  const overlay = document.getElementById('members-modal');
  if (!e || e.target === overlay) overlay.classList.remove('open');
}

async function loadMembers() {
  const res     = await api(`/chats/${currentChatId}/members`);
  const members = await res.json();
  const list    = document.getElementById('members-list');
  list.innerHTML = '';
  if (!res.ok) { list.textContent = members.error || 'Ошибка'; return; }

  members.forEach(member => {
    const canDelete = member.role !== 'admin' && Number(member.id) !== Number(me.id);
    const div = document.createElement('div');
    div.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border);';
    div.innerHTML = `
      <div
  style="
    width:32px;
    height:32px;
    border-radius:50%;
    background:var(--primary);
    color:#fff;
    display:flex;
    align-items:center;
    justify-content:center;
    font-size:12px;
    font-weight:600;
    flex-shrink:0;
    overflow:hidden;
  "
>
  ${
    member.avatar
      ? `
        <img
          src="${member.avatar}"
          alt="Аватар"
          style="
            width:100%;
            height:100%;
            object-fit:cover;
          "
        >
      `
      : member.username[0].toUpperCase()
  }
</div>
      <div style="flex:1;">
        <div style="font-size:14px;font-weight:600;color:var(--text);">${escHtml(member.username)}</div>
        <div style="font-size:11px;color:var(--muted);">${member.role === 'admin' ? 'администратор' : 'участник'}</div>
      </div>
      ${canDelete ? `<button onclick="deleteMember(${member.id})" style="padding:5px 10px;background:#fdf0ef;border:1px solid #f0cccb;border-radius:6px;font-size:12px;color:var(--danger);cursor:pointer;">Удалить</button>` : ''}
    `;
    list.appendChild(div);
  });

  const memberIds = members.map(m => Number(m.id));
  const select = document.getElementById('new-member-select');
  select.innerHTML = '<option value="">Выберите пользователя...</option>';
  const res2 = await api('/users');
  const users = await res2.json();
  users.filter(u => !memberIds.includes(Number(u.id))).forEach(u => {
    const opt = document.createElement('option');
    opt.value = u.id;
    opt.textContent = u.username;
    select.appendChild(opt);
  });
}

async function addMember() {
  const select = document.getElementById('new-member-select');
  const userId = Number(select.value);
  if (!userId) { alert('Выберите пользователя'); return; }
  const res = await api(`/chats/${currentChatId}/members`, {
    method: 'POST',
    body: JSON.stringify({ userId }),
  });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Не удалось добавить'); return; }
  select.value = '';
  await loadMembers();
}

async function deleteMember(userId) {
  if (!confirm('Удалить участника из группы?')) return;
  const res = await api(`/chats/${currentChatId}/members/${userId}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Не удалось удалить'); return; }
  await loadMembers();
}

async function openSaved() {
  const res  = await api('/chats/private', { method: 'POST', body: JSON.stringify({ userId: me.id }) });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Ошибка'); return; }
  await loadChats();
  openChat(data.id, 'Избранное', 'saved');
}

async function openModal(mode) {
  modalMode = mode;
  document.getElementById('modal-title').textContent = mode === 'private' ? 'Новый личный чат' : 'Создать группу';
  document.getElementById('modal-group-name').style.display = mode === 'group' ? '' : 'none';
  document.getElementById('modal-confirm-btn').onclick = mode === 'private' ? createPrivateChat : createGroupChat;

  const res = await api('/users');
  allUsers  = await res.json();

  const list = document.getElementById('user-list');
  if (!allUsers.length) {
    list.innerHTML = '<div style="color:var(--muted);font-size:13px;padding:8px 0;">Нет других пользователей</div>';
  } else {
    list.innerHTML = allUsers.map(u => `
      <div class="user-item">
        <input type="${mode === 'private' ? 'radio' : 'checkbox'}" name="user-sel" value="${u.id}" id="u-${u.id}">
        <label for="u-${u.id}" style="cursor:pointer;">${escHtml(u.username)}</label>
      </div>
    `).join('');
  }
  document.getElementById('modal-overlay').classList.add('open');
}

function closeModal(e) {
  if (!e || e.target === document.getElementById('modal-overlay')) {
    document.getElementById('modal-overlay').classList.remove('open');
  }
}

async function createPrivateChat() {
  const selected = document.querySelector('input[name=user-sel]:checked');
  if (!selected) return alert('Выберите пользователя');
  const res  = await api('/chats/private', { method: 'POST', body: JSON.stringify({ userId: parseInt(selected.value) }) });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Ошибка'); return; }
  closeModal();
  await loadChats();
  const user = allUsers.find(u => u.id === parseInt(selected.value));
  openChat(data.id, user?.username || 'Чат', 'private');
}

async function createGroupChat() {
  const name    = document.getElementById('group-name-input').value.trim();
  const checked = [...document.querySelectorAll('input[name=user-sel]:checked')];
  if (!name) return alert('Введите название группы');
  if (!checked.length) return alert('Выберите хотя бы одного участника');
  const memberIds = checked.map(el => parseInt(el.value));
  const res  = await api('/chats/group', { method: 'POST', body: JSON.stringify({ name, memberIds }) });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Ошибка'); return; }
  closeModal();
  await loadChats();
  openChat(data.id, name, 'group');
}

async function deleteAccount() {
  if (!confirm('Удалить аккаунт? Это нельзя отменить.')) return;
  const res = await api('/users/me', { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Ошибка'); return; }
  localStorage.clear();
  window.location.href = '/';
}

function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/';
}

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom() {
  const c = document.getElementById('messages-container');
  if (c) c.scrollTop = c.scrollHeight;
}
async function uploadAvatar(event) {
  const file = event.target.files[0];

  if (!file) {
    return;
  }

  const allowedTypes = [
    "image/png",
    "image/jpeg",
    "image/webp"
  ];

  if (!allowedTypes.includes(file.type)) {
    alert("Можно выбрать только PNG, JPG или WEBP");
    event.target.value = "";
    return;
  }

  if (file.size > 2 * 1024 * 1024) {
    alert("Размер изображения должен быть не больше 2 МБ");
    event.target.value = "";
    return;
  }

  const reader = new FileReader();

  reader.onload = async function() {
    const avatar = reader.result;

    try {
      const response = await api("/users/me/avatar", {
        method: "PUT",
        body: JSON.stringify({
          avatar: avatar
        })
      });

      const result = await response.json();

      if (!response.ok) {
        alert(
          result.error ||
          "Не удалось сохранить аватар"
        );
        return;
      }

      me.avatar = result.avatar;

      localStorage.setItem(
        "user",
        JSON.stringify(me)
      );

      showMyAvatar();

      event.target.value = "";

    } catch (error) {
      console.error(
        "Ошибка загрузки аватара:",
        error
      );

      alert("Ошибка соединения с сервером");
    }
  };

  reader.readAsDataURL(file);
}
loadChats();