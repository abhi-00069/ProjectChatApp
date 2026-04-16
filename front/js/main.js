

let socket        = null;
let currentUser   = null;
let currentRoom   = null;
let allUsers      = [];
let typingTimer   = null;
let isTyping      = false;
let membersOpen   = false;


const API = {
    async post(url, body, auth = false) {
        const headers = { 'Content-Type': 'application/json' };
        if (auth) headers['Authorization'] = `Bearer ${currentUser.token}`;
        const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
        return res.json();
    },
    async get(url) {
        const res = await fetch(url, {
            headers: { 'Authorization': `Bearer ${currentUser.token}` }
        });
        return res.json();
    }
};


function switchTab(tab) {
    document.querySelectorAll('.auth-tab').forEach((t, i) => {
        t.classList.toggle('active', (tab === 'login' && i === 0) || (tab === 'register' && i === 1));
    });
    document.getElementById('login-form').classList.toggle('active', tab === 'login');
    document.getElementById('register-form').classList.toggle('active', tab === 'register');
    hideAuthError();
}

function showAuthError(msg) {
    const el = document.getElementById('auth-error');
    el.textContent = msg;
    el.style.display = 'block';
}

function hideAuthError() {
    document.getElementById('auth-error').style.display = 'none';
}


async function handleLogin(e) {
    e.preventDefault();
    hideAuthError();
    const btn = e.target.querySelector('button');
    btn.textContent = 'Signing in...';
    btn.disabled = true;

    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;

    try {
        const data = await API.post('/api/auth/login', { username, password });
        if (data.error) { showAuthError(data.error); return; }
        onAuthSuccess(data);
    } catch {
        showAuthError('Connection error. Is the server running?');
    } finally {
        btn.textContent = 'Sign In';
        btn.disabled = false;
    }
}


async function handleRegister(e) {
    e.preventDefault();
    hideAuthError();
    const btn = e.target.querySelector('button');
    btn.textContent = 'Creating account...';
    btn.disabled = true;

    const username = document.getElementById('reg-username').value.trim();
    const email    = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    if (password.length < 6) {
        showAuthError('Password must be at least 6 characters');
        btn.textContent = 'Create Account';
        btn.disabled = false;
        return;
    }

    try {
        const data = await API.post('/api/auth/register', { username, email, password });
        if (data.error) { showAuthError(data.error); return; }
        onAuthSuccess(data);
    } catch {
        showAuthError('Connection error. Is the server running?');
    } finally {
        btn.textContent = 'Create Account';
        btn.disabled = false;
    }
}

function onAuthSuccess(data) {
    currentUser = { ...data.user, token: data.token };
    localStorage.setItem('nexus_token', data.token);
    localStorage.setItem('nexus_user', JSON.stringify(data.user));

    console.log('✅ Token saved:', currentUser.token ? 'YES' : 'NO');

    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').style.display  = 'block';

    document.getElementById('my-username').textContent = currentUser.username;
    const myAvatar = document.getElementById('my-avatar');
    myAvatar.textContent      = currentUser.username[0].toUpperCase();
    myAvatar.style.background = currentUser.avatar || '#5865f2';


    if (socket) {
        socket.disconnect();
        socket = null;
    }

    initSocket();
    loadUsers();
}


function handleLogout() {
    localStorage.removeItem('nexus_token');
    localStorage.removeItem('nexus_user');
    if (socket) socket.disconnect();
    socket      = null;
    currentUser = null;
    currentRoom = null;
    allUsers    = [];
    document.getElementById('app-screen').style.display  = 'none';
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('user-list').innerHTML = '';
    document.getElementById('chat-area').innerHTML = `
        <div class="no-chat">
            <div class="nc-icon">💬</div>
            <h2>Welcome to Nexus Chat</h2>
            <p>Select a user from the sidebar to start chatting!</p>
        </div>`;
    showToast('Logged out successfully', 'info');
}


function initSocket() {
    const token = currentUser?.token || localStorage.getItem('nexus_token');
console.log('🔑 Token being sent:', token ? 'EXISTS' : 'MISSING');

socket = io({
    auth:       { token },
    query:      { token },
    transports: ['websocket', 'polling']
});

    socket.on('connect', () => {
        console.log('🟢 Socket connected:', socket.id);
        showToast('Connected!', 'success');
    });

    socket.on('connect_error', (err) => {
        console.error('❌ Socket error:', err.message);
        showToast('Connection error: ' + err.message, 'error');
    });

    socket.on('disconnect', (reason) => {
        console.log('🔴 Socket disconnected:', reason);
    });

  
    socket.on('newMessage', (msg) => {
        if (currentRoom && msg.roomId === currentRoom.roomId) {
            appendMessage(msg);
            scrollBottom();
        } else {
            markUnread(msg.sender);
            showToast(`💬 ${msg.sender}: ${msg.text || '📎 File'}`, 'info');
        }
    });


    socket.on('messageHistory', (messages) => {
        const container = document.getElementById('messages-container');
        if (!container) return;
        container.innerHTML = '';
        if (messages.length === 0) {
            container.innerHTML = `
                <div style="text-align:center;color:var(--text-muted);margin-top:40px;">
                    <div style="font-size:48px;margin-bottom:12px;">👋</div>
                    <p>Start the conversation!</p>
                </div>`;
            return;
        }
        let lastDate   = '';
        let lastSender = '';
        messages.forEach(msg => {
            const msgDate = new Date(msg.createdAt).toDateString();
            if (msgDate !== lastDate) {
                appendDateSeparator(msgDate);
                lastDate   = msgDate;
                lastSender = '';
            }
            appendMessage(msg, lastSender);
            lastSender = msg.sender;
        });
        scrollBottom();
    });

   
    socket.on('messageDeleted', ({ messageId }) => {
        const el = document.getElementById(`msg-${messageId}`);
        if (el) {
            el.innerHTML = `<em style="color:var(--text-muted);font-size:13px;">Message deleted</em>`;
        }
    });

   
    socket.on('typing', ({ users }) => {
        const bar = document.getElementById('typing-bar');
        if (!bar) return;
        const others = (users || []).filter(u => u !== currentUser.username);
        if (others.length === 0) {
            bar.innerHTML = '';
        } else {
            const names = others.join(', ');
            bar.innerHTML = `
                <div class="typing-dots">
                    <span></span><span></span><span></span>
                </div>
                <span>${names} ${others.length > 1 ? 'are' : 'is'} typing...</span>`;
        }
    });


    socket.on('userOnline', ({ username, isOnline, lastSeen }) => {
        updateUserOnlineStatus(username, isOnline, lastSeen);
    });

  
    socket.on('messagesRead', ({ username: reader }) => {
        if (reader !== currentUser.username) {
            document.querySelectorAll('.read-receipt').forEach(el => {
                el.innerHTML = '✓✓';
                el.style.color = '#00b0f4';
            });
        }
    });
}


async function loadUsers() {
    try {
        allUsers = await API.get('/api/users');
        renderUserList(allUsers);
        updateOnlineCount();

        const cb = document.getElementById('member-checkboxes');
        if (cb) {
            cb.innerHTML = allUsers.map(u => `
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;padding:4px 0;">
                    <input type="checkbox" value="${u.username}" style="accent-color:var(--accent);" />
                    <div style="background:${u.avatar || '#5865f2'};width:24px;height:24px;font-size:10px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;">
                        ${u.username[0].toUpperCase()}
                    </div>
                    <span style="font-size:14px;">${u.username}</span>
                </label>
            `).join('');
        }
    } catch (err) {
        console.error('loadUsers error:', err);
    }
}

function renderUserList(users) {
    const list = document.getElementById('user-list');
    list.innerHTML = '';

    if (users.length === 0) {
        list.innerHTML = `<p style="color:var(--text-muted);font-size:13px;padding:8px;">No users found</p>`;
        return;
    }

    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.id        = `user-item-${user.username}`;
        div.onclick   = () => openPrivateChat(user);

        div.innerHTML = `
            <div class="avatar" style="background:${user.avatar || '#5865f2'};">
                ${user.username[0].toUpperCase()}
                <span class="status-dot ${user.isOnline ? 'online' : 'offline'}"></span>
            </div>
            <div class="user-info">
                <div class="name">${user.username}</div>
                <div class="last-msg">${user.isOnline ? 'Online' : formatLastSeen(user.lastSeen)}</div>
            </div>
        `;
        list.appendChild(div);
    });
}

function filterUsers() {
    const q        = document.getElementById('search-input').value.toLowerCase();
    const filtered = allUsers.filter(u => u.username.toLowerCase().includes(q));
    renderUserList(filtered);
}

function updateUserOnlineStatus(username, isOnline, lastSeen) {
    const user = allUsers.find(u => u.username === username);
    if (user) { user.isOnline = isOnline; user.lastSeen = lastSeen; }

    const item = document.getElementById(`user-item-${username}`);
    if (item) {
        const dot  = item.querySelector('.status-dot');
        const info = item.querySelector('.last-msg');
        if (dot)  dot.className    = `status-dot ${isOnline ? 'online' : 'offline'}`;
        if (info) info.textContent = isOnline ? 'Online' : formatLastSeen(lastSeen);
    }

    if (currentRoom && currentRoom.targetUser === username) {
        const subtitle = document.querySelector('.chat-header-info .subtitle');
        if (subtitle) subtitle.textContent = isOnline ? '🟢 Online' : `Last seen ${formatLastSeen(lastSeen)}`;
    }

    updateOnlineCount();
}

function updateOnlineCount() {
    const count = allUsers.filter(u => u.isOnline).length;
    const el    = document.getElementById('online-count');
    if (el) el.textContent = count;
}

function markUnread(senderUsername) {
    const item = document.getElementById(`user-item-${senderUsername}`);
    if (!item) return;
    let badge = item.querySelector('.unread-badge');
    if (!badge) {
        badge           = document.createElement('div');
        badge.className = 'unread-badge';
        badge.textContent = '1';
        item.appendChild(badge);
    } else {
        badge.textContent = parseInt(badge.textContent) + 1;
    }
}


async function openPrivateChat(user) {
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active'));
    const item = document.getElementById(`user-item-${user.username}`);
    if (item) {
        item.classList.add('active');
        const badge = item.querySelector('.unread-badge');
        if (badge) badge.remove();
    }

    try {
        const room = await API.post('/api/rooms/private', { targetUsername: user.username }, true);
        currentRoom = {
            roomId:     room.roomId,
            name:       user.username,
            type:       'private',
            targetUser: user.username
        };

        renderChatArea(user);
        socket.emit('joinRoom', { roomId: room.roomId });
        console.log('📦 Joined room:', room.roomId);
    } catch (err) {
        console.error('openPrivateChat error:', err);
        showToast('Could not open chat', 'error');
    }
}


function renderChatArea(user) {
    const area        = document.getElementById('chat-area');
    const isOnline    = user.isOnline;
    const avatarColor = user.avatar || '#5865f2';

    area.innerHTML = `
        <div class="chat-header">
            <div class="header-avatar" style="background:${avatarColor};">
                ${user.username[0].toUpperCase()}
            </div>
            <div class="chat-header-info">
                <div class="title">${user.username}</div>
                <div class="subtitle">${isOnline ? '🟢 Online' : `Last seen ${formatLastSeen(user.lastSeen)}`}</div>
            </div>
            <div class="header-actions">
                <button class="header-btn" title="Members" onclick="toggleMembers()">
                    <i class="fas fa-users"></i>
                </button>
                <button class="header-btn" title="Search" onclick="showToast('Search coming soon!','info')">
                    <i class="fas fa-search"></i>
                </button>
                <button class="header-btn" title="Backup" onclick="doBackup()">
                    <i class="fas fa-download"></i>
                </button>
            </div>
        </div>
        <div class="chat-messages" id="messages-container"></div>
        <div class="typing-bar" id="typing-bar"></div>
        <div class="chat-input-area">
            <div class="input-box">
                <button class="input-btn" title="Attach file" onclick="document.getElementById('file-input').click()">
                    <i class="fas fa-paperclip"></i>
                </button>
                <input type="file" id="file-input" hidden accept="image/*,video/*,.pdf,.txt" />
                <textarea
                    id="msg-input"
                    placeholder="Message ${user.username}..."
                    rows="1"
                    onkeydown="handleKeyDown(event)"
                    oninput="handleTyping()"
                ></textarea>
                <button class="input-btn" title="Emoji" onclick="showToast('Emoji picker coming soon!','info')">
                    <i class="far fa-smile"></i>
                </button>
                <button class="send-btn" onclick="sendMessage()" title="Send">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;

    document.getElementById('file-input').addEventListener('change', handleFileUpload);
}


let lastRenderedSender = '';

function appendMessage(msg, prevSender = '') {
    const container = document.getElementById('messages-container');
    if (!container) return;

    const isOwn      = msg.sender === currentUser.username;
    const isSameSender = msg.sender === (prevSender || lastRenderedSender);
    lastRenderedSender = msg.sender;

    let group;
    const lastGroup  = container.querySelector('.msg-group:last-child');
    const canAppend  = lastGroup &&
        lastGroup.dataset.sender === msg.sender &&
        isSameSender;

    if (canAppend) {
        group = lastGroup;
    } else {
        group = document.createElement('div');
        group.className      = `msg-group${isOwn ? ' own' : ''}`;
        group.dataset.sender = msg.sender;

        const avatarColor = isOwn
            ? (currentUser.avatar || '#5865f2')
            : (allUsers.find(u => u.username === msg.sender)?.avatar || '#5865f2');

        group.innerHTML = `
            <div class="msg-group-header">
                <div style="background:${avatarColor};width:40px;height:40px;font-size:16px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;flex-shrink:0;">
                    ${msg.sender[0].toUpperCase()}
                </div>
                <div>
                    <span class="sender-name">${isOwn ? 'You' : msg.sender}</span>
                    <span class="msg-time">${formatTime(msg.createdAt)}</span>
                </div>
            </div>
            <div class="msg-group-body"></div>
        `;
        container.appendChild(group);
    }

    const body  = group.querySelector('.msg-group-body');
    const msgEl = document.createElement('div');
    msgEl.className = 'message';
    msgEl.id        = `msg-${msg._id}`;

    let content = '';

    if (msg.type === 'file' && msg.fileUrl) {
        if (msg.fileType === 'image') {
            content = `<img src="${msg.fileUrl}" class="msg-image" alt="${msg.fileName}"
                            onload="this.classList.add('loaded')"
                            onclick="window.open('${msg.fileUrl}','_blank')" />`;
        } else if (msg.fileType === 'video') {
            content = `<video src="${msg.fileUrl}" controls style="max-width:320px;border-radius:8px;"></video>`;
        } else {
            content = `
                <a href="${msg.fileUrl}" target="_blank" class="msg-file" download="${msg.fileName}">
                    <i class="fas fa-file" style="font-size:24px;"></i>
                    <div>
                        <div class="file-name">${msg.fileName}</div>
                        <div class="file-size">Click to download</div>
                    </div>
                </a>`;
        }
    } else {
        content = `<span class="msg-text">${escapeHtml(msg.text)}</span>`;
    }

    const receipt = isOwn
        ? `<span class="read-receipt" style="font-size:11px;color:var(--text-muted);margin-left:6px;">✓</span>`
        : '';

    msgEl.innerHTML = `
        ${content}
        ${receipt}
        <div class="msg-actions">
            ${isOwn ? `<button class="msg-action-btn delete" onclick="deleteMessage('${msg._id}')" title="Delete">
                <i class="fas fa-trash"></i>
            </button>` : ''}
            <button class="msg-action-btn" onclick="copyMessage('${escapeHtml(msg.text)}')" title="Copy">
                <i class="fas fa-copy"></i>
            </button>
        </div>
    `;

    body.appendChild(msgEl);
}

function appendDateSeparator(dateStr) {
    const container = document.getElementById('messages-container');
    if (!container) return;
    const sep       = document.createElement('div');
    sep.className   = 'date-sep';
    sep.textContent = dateStr === new Date().toDateString() ? 'Today' : dateStr;
    container.appendChild(sep);
}


function sendMessage() {
    const input = document.getElementById('msg-input');
    if (!input || !currentRoom) return;

    const text = input.value.trim();
    if (!text) return;

    console.log('📤 Sending message to room:', currentRoom.roomId);

    socket.emit('sendMessage', {
        roomId: currentRoom.roomId,
        text
    });

    input.value        = '';
    input.style.height = 'auto';
    stopTyping();
}

function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
    const ta       = e.target;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}


function handleTyping() {
    if (!currentRoom || !socket) return;
    const ta = document.getElementById('msg-input');
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; }

    if (!isTyping) {
        isTyping = true;
        socket.emit('typing', { roomId: currentRoom.roomId });
    }
    clearTimeout(typingTimer);
    typingTimer = setTimeout(stopTyping, 2000);
}

function stopTyping() {
    if (!currentRoom || !socket) return;
    isTyping = false;
    socket.emit('stopTyping', { roomId: currentRoom.roomId });
}


async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file || !currentRoom) return;

    showToast('Uploading file...', 'info');

    const formData = new FormData();
    formData.append('file', file);

    try {
        const res = await fetch('/api/upload', {
            method:  'POST',
            headers: { 'Authorization': `Bearer ${currentUser.token}` },
            body:    formData
        });
        const data = await res.json();
        if (data.error) { showToast(data.error, 'error'); return; }

        socket.emit('sendMessage', {
            roomId:   currentRoom.roomId,
            text:     '',
            fileUrl:  data.fileUrl,
            fileType: data.fileType,
            fileName: data.fileName
        });

        showToast('File sent!', 'success');
    } catch {
        showToast('File upload failed', 'error');
    }

    e.target.value = '';
}

function deleteMessage(messageId) {
    if (!currentRoom) return;
    if (!confirm('Delete this message?')) return;
    socket.emit('deleteMessage', { messageId, roomId: currentRoom.roomId });
}

function copyMessage(text) {
    navigator.clipboard.writeText(text).then(() => showToast('Copied!', 'success'));
}


function openGroupModal()  { document.getElementById('group-modal').classList.add('open');    }
function closeGroupModal() { document.getElementById('group-modal').classList.remove('open'); }

async function createGroup() {
    const name    = document.getElementById('group-name').value.trim();
    if (!name) { showToast('Enter a group name', 'error'); return; }

    const checked = [...document.querySelectorAll('#member-checkboxes input:checked')].map(c => c.value);
    if (checked.length === 0) { showToast('Select at least one member', 'error'); return; }

    try {
        const room = await API.post('/api/rooms/group', { name, members: checked }, true);
        closeGroupModal();
        showToast(`Group "${name}" created!`, 'success');
        currentRoom = { roomId: room.roomId, name: room.name, type: 'group' };
        socket.emit('joinRoom', { roomId: room.roomId });
        renderGroupChatArea(room);
    } catch {
        showToast('Could not create group', 'error');
    }
}

function renderGroupChatArea(room) {
    const area = document.getElementById('chat-area');
    area.innerHTML = `
        <div class="chat-header">
            <div class="header-avatar" style="background:#5865f2;">
                ${room.name[0].toUpperCase()}
            </div>
            <div class="chat-header-info">
                <div class="title">${room.name}</div>
                <div class="subtitle">Group Chat</div>
            </div>
            <div class="header-actions">
                <button class="header-btn" onclick="doBackup()" title="Backup">
                    <i class="fas fa-download"></i>
                </button>
            </div>
        </div>
        <div class="chat-messages" id="messages-container"></div>
        <div class="typing-bar" id="typing-bar"></div>
        <div class="chat-input-area">
            <div class="input-box">
                <button class="input-btn" onclick="document.getElementById('file-input').click()">
                    <i class="fas fa-paperclip"></i>
                </button>
                <input type="file" id="file-input" hidden accept="image/*,video/*,.pdf,.txt" />
                <textarea
                    id="msg-input"
                    placeholder="Message ${room.name}..."
                    rows="1"
                    onkeydown="handleKeyDown(event)"
                    oninput="handleTyping()"
                ></textarea>
                <button class="input-btn" onclick="showToast('Emoji coming soon!','info')">
                    <i class="far fa-smile"></i>
                </button>
                <button class="send-btn" onclick="sendMessage()">
                    <i class="fas fa-paper-plane"></i>
                </button>
            </div>
        </div>
    `;
    document.getElementById('file-input').addEventListener('change', handleFileUpload);
}


function toggleMembers() {
    membersOpen = !membersOpen;
    document.getElementById('members-panel').classList.toggle('open', membersOpen);
    if (membersOpen) {
        document.getElementById('members-list').innerHTML = allUsers.map(u => `
            <div class="user-item">
                <div class="avatar" style="background:${u.avatar || '#5865f2'};">
                    ${u.username[0].toUpperCase()}
                    <span class="status-dot ${u.isOnline ? 'online' : 'offline'}"></span>
                </div>
                <div class="user-info">
                    <div class="name">${u.username}</div>
                    <div class="last-msg">${u.isOnline ? 'Online' : 'Offline'}</div>
                </div>
            </div>
        `).join('');
    }
}


async function doBackup() {
    try {
        const data = await API.get('/api/backup');
        showToast(`Backup done! ${data.count} messages saved.`, 'success');
    } catch {
        showToast('Backup failed', 'error');
    }
}


let toastTimer = null;
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    toast.innerHTML   = `<span>${icons[type] || 'ℹ️'}</span> ${message}`;
    toast.className   = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}


function scrollBottom() {
    const c = document.getElementById('messages-container');
    if (c) c.scrollTop = c.scrollHeight;
}

function formatTime(dateStr) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleTimeString('en-IN', {
        hour: '2-digit', minute: '2-digit', hour12: true
    });
}

function formatLastSeen(dateStr) {
    if (!dateStr) return 'a while ago';
    const diff  = Date.now() - new Date(dateStr).getTime();
    const mins  = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days  = Math.floor(diff / 86400000);
    if (mins  < 1)  return 'just now';
    if (mins  < 60) return `${mins}m ago`;
    if (hours < 24) return `${hours}h ago`;
    return `${days}d ago`;
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g,  '&amp;')
        .replace(/</g,  '&lt;')
        .replace(/>/g,  '&gt;')
        .replace(/"/g,  '&quot;')
        .replace(/'/g,  '&#039;')
        .replace(/\n/g, '<br>');
}


window.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('nexus_token');
    const user  = localStorage.getItem('nexus_user');

    if (token && user) {
        const parsedUser = JSON.parse(user);
        currentUser      = { ...parsedUser, token };

        console.log('✅ Auto login, token:', token ? 'EXISTS' : 'MISSING');

        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('app-screen').style.display  = 'block';

        document.getElementById('my-username').textContent = currentUser.username;
        const myAvatar = document.getElementById('my-avatar');
        myAvatar.textContent      = currentUser.username[0].toUpperCase();
        myAvatar.style.background = currentUser.avatar || '#5865f2';

        initSocket();
        loadUsers();
    }
});
