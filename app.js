const tg = window.Telegram?.WebApp;
const app = document.querySelector(".app");
const usersEl = document.getElementById("users");
const searchEl = document.getElementById("search");
const meNameEl = document.getElementById("meName");
const emptyEl = document.getElementById("empty");
const panelEl = document.getElementById("chatPanel");
const messagesEl = document.getElementById("messages");
const inputEl = document.getElementById("messageInput");
const composerEl = document.getElementById("composer");
const typingEl = document.getElementById("typing");
const chatNameEl = document.getElementById("chatName");
const chatStatusEl = document.getElementById("chatStatus");
const chatAvatarEl = document.getElementById("chatAvatar");
const backBtn = document.getElementById("backBtn");

if (tg) {
  tg.ready();
  tg.expand();
}

const initData = tg?.initData || "";
let me = null;
let selected = null;
let socket = null;
let searchTimer = null;
let typingTimer = null;
const online = new Set();

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Telegram-Init-Data": initData,
      ...(options.headers || {})
    }
  }).then(async r => {
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || "Xatolik");
    return data;
  });
}

function avatarUrl(user) {
  return user.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent((user.first_name || "U")[0])}&background=e3eaf2&color=304050`;
}

function renderUser(user) {
  const row = document.createElement("div");
  row.className = "user";
  row.dataset.id = user.id;

  const img = document.createElement("img");
  img.className = "avatar";
  img.src = avatarUrl(user);
  img.alt = "";
  img.onerror = () => { img.src = avatarUrl({first_name: "U"}); };

  const info = document.createElement("div");
  info.className = "user-info";

  const name = document.createElement("div");
  name.className = "user-name";
  name.textContent = [user.first_name, user.last_name].filter(Boolean).join(" ");

  const handle = document.createElement("div");
  handle.className = "user-handle";
  handle.textContent = user.username ? "@" + user.username : "Telegram user";

  info.append(name, handle);

  const dot = document.createElement("span");
  dot.className = "status-dot" + (online.has(user.id) ? " online" : "");

  row.append(img, info, dot);
  row.addEventListener("click", () => openChat(user));
  return row;
}

async function loadUsers(q = "") {
  try {
    const data = await api("/api/users?q=" + encodeURIComponent(q));
    usersEl.innerHTML = "";
    if (!data.users.length) {
      usersEl.innerHTML = '<div class="no-users">Foydalanuvchi topilmadi</div>';
      return;
    }
    data.users.forEach(u => usersEl.appendChild(renderUser(u)));
  } catch (e) {
    usersEl.innerHTML = `<div class="no-users">${escapeHtml(e.message)}</div>`;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[c]));
}

function formatTime(ts) {
  return new Date(Number(ts) * 1000).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit"
  });
}

function addMessage(msg) {
  const div = document.createElement("div");
  div.className = "msg " + (Number(msg.sender_id) === Number(me.id) ? "mine" : "theirs");
  div.dataset.id = msg.id;
  div.innerHTML = `<div>${escapeHtml(msg.text)}</div><div class="msg-time">${formatTime(msg.created_at)}</div>`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function openChat(user) {
  selected = user;
  app.classList.add("chat-open");
  emptyEl.classList.add("hidden");
  panelEl.classList.remove("hidden");

  chatNameEl.textContent = [user.first_name, user.last_name].filter(Boolean).join(" ");
  chatAvatarEl.src = avatarUrl(user);
  updateStatus();

  messagesEl.innerHTML = '<div class="no-users">Yuklanmoqda...</div>';
  try {
    const data = await api(`/api/messages/${user.id}`);
    messagesEl.innerHTML = "";
    data.messages.forEach(addMessage);
  } catch (e) {
    messagesEl.innerHTML = `<div class="no-users">${escapeHtml(e.message)}</div>`;
  }
  inputEl.focus();
}

function updateStatus() {
  if (!selected) return;
  chatStatusEl.textContent = online.has(Number(selected.id)) ? "online" : "offline";
  chatStatusEl.style.color = online.has(Number(selected.id)) ? "#2aa66a" : "#8a949e";
}

function connectSocket() {
  socket = io({
    auth: { initData }
  });

  socket.on("connect", () => {
    console.log("connected");
  });

  socket.on("new_message", msg => {
    if (!selected) return;
    const belongs = (
      Number(msg.sender_id) === Number(selected.id) &&
      Number(msg.receiver_id) === Number(me.id)
    ) || (
      Number(msg.sender_id) === Number(me.id) &&
      Number(msg.receiver_id) === Number(selected.id)
    );
    if (belongs && !document.querySelector(`.msg[data-id="${msg.id}"]`)) {
      addMessage(msg);
    }
  });

  socket.on("presence", data => {
    const id = Number(data.userId);
    if (data.online) online.add(id);
    else online.delete(id);
    updateStatus();
    loadUsers(searchEl.value.trim());
  });

  socket.on("typing", data => {
    if (selected && Number(data.userId) === Number(selected.id)) {
      typingEl.textContent = data.isTyping ? "yozmoqda..." : "";
    }
  });
}

composerEl.addEventListener("submit", e => {
  e.preventDefault();
  if (!selected || !socket) return;
  const text = inputEl.value.trim();
  if (!text) return;
  socket.emit("send_message", { receiverId: selected.id, text });
  inputEl.value = "";
  socket.emit("typing", { receiverId: selected.id, isTyping: false });
});

inputEl.addEventListener("input", () => {
  if (!selected || !socket) return;
  socket.emit("typing", { receiverId: selected.id, isTyping: inputEl.value.length > 0 });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit("typing", { receiverId: selected.id, isTyping: false });
  }, 900);
});

searchEl.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => loadUsers(searchEl.value.trim()), 250);
});

backBtn.addEventListener("click", () => {
  app.classList.remove("chat-open");
  selected = null;
});

(async function init() {
  try {
    const data = await api("/api/me");
    me = data.user;
    meNameEl.textContent = [me.first_name, me.last_name].filter(Boolean).join(" ");
    connectSocket();
    await loadUsers();
  } catch (e) {
    meNameEl.textContent = "Kirish xatosi";
    usersEl.innerHTML = `<div class="no-users">${escapeHtml(e.message)}</div>`;
  }
})();