require("dotenv").config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const http = require("http");
const Database = require("better-sqlite3");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 3000);
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const APP_URL = process.env.APP_URL || "";
const DB_FILE = process.env.DB_FILE || "./chat.db";

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true }
});
const db = new Database(DB_FILE);

db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT NOT NULL,
  last_name TEXT,
  photo_url TEXT,
  last_seen INTEGER NOT NULL DEFAULT (strftime('%s','now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sender_id INTEGER NOT NULL,
  receiver_id INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
  FOREIGN KEY(sender_id) REFERENCES users(id),
  FOREIGN KEY(receiver_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_pair
ON messages(sender_id, receiver_id, created_at);
`);

app.use(express.json({ limit: "32kb" }));

// Statik fayllarni public o'rniga ildiz (root) papkadan xizmat qildirish
app.use(express.static(__dirname));

function telegramCheck(initData) {
  if (!BOT_TOKEN || !initData) return null;

  const params = new URLSearchParams(initData);
  const receivedHash = params.get("hash");
  if (!receivedHash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = crypto
    .createHmac("sha256", "WebAppData")
    .update(BOT_TOKEN)
    .digest();

  const calculatedHash = crypto
    .createHmac("sha256", secret)
    .update(dataCheckString)
    .digest("hex");

  if (calculatedHash.length !== receivedHash.length) return null;
  if (!crypto.timingSafeEqual(
    Buffer.from(calculatedHash, "utf8"),
    Buffer.from(receivedHash, "utf8")
  )) return null;

  const authDate = Number(params.get("auth_date") || 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > 86400) return null;

  try {
    return JSON.parse(params.get("user") || "{}");
  } catch {
    return null;
  }
}

function upsertUser(user) {
  const stmt = db.prepare(`
    INSERT INTO users (id, username, first_name, last_name, photo_url, last_seen)
    VALUES (@id, @username, @first_name, @last_name, @photo_url, strftime('%s','now'))
    ON CONFLICT(id) DO UPDATE SET
      username=excluded.username,
      first_name=excluded.first_name,
      last_name=excluded.last_name,
      photo_url=excluded.photo_url,
      last_seen=strftime('%s','now')
  `);
  stmt.run({
    id: Number(user.id),
    username: user.username || null,
    first_name: user.first_name || "User",
    last_name: user.last_name || null,
    photo_url: user.photo_url || null
  });
}

function authMiddleware(req, res, next) {
  const initData = req.headers["x-telegram-init-data"];
  const telegramUser = telegramCheck(initData);

  if (telegramUser && telegramUser.id) {
    upsertUser(telegramUser);
    req.user = {
      id: Number(telegramUser.id),
      username: telegramUser.username || null,
      first_name: telegramUser.first_name || "User",
      last_name: telegramUser.last_name || null,
      photo_url: telegramUser.photo_url || null
    };
    return next();
  }

  // Development fallback. Set REQUIRE_TELEGRAM=true in production.
  if (process.env.REQUIRE_TELEGRAM === "true") {
    return res.status(401).json({ error: "Telegram authentication required" });
  }

  const demo = {
    id: 999000001,
    username: "demo_user",
    first_name: "Demo",
    last_name: "User",
    photo_url: null
  };
  upsertUser(demo);
  req.user = demo;
  next();
}

app.get("/api/me", authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

app.get("/api/users", authMiddleware, (req, res) => {
  const q = String(req.query.q || "").trim().slice(0, 50);
  const rows = db.prepare(`
    SELECT id, username, first_name, last_name, photo_url, last_seen
    FROM users
    WHERE id != ?
      AND (
        username LIKE ? OR
        first_name LIKE ? OR
        last_name LIKE ?
      )
    ORDER BY first_name, username
    LIMIT 50
  `).all(req.user.id, `%${q}%`, `%${q}%`, `%${q}%`);
  res.json({ users: rows });
});

app.get("/api/messages/:otherId", authMiddleware, (req, res) => {
  const otherId = Number(req.params.otherId);
  if (!Number.isSafeInteger(otherId)) return res.status(400).json({ error: "Invalid user" });

  const rows = db.prepare(`
    SELECT id, sender_id, receiver_id, text, created_at
    FROM messages
    WHERE (sender_id = ? AND receiver_id = ?)
       OR (sender_id = ? AND receiver_id = ?)
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `).all(req.user.id, otherId, otherId, req.user.id);

  res.json({ messages: rows.reverse() });
});

function saveMessage(senderId, receiverId, text) {
  const clean = String(text || "").trim().slice(0, 2000);
  if (!clean) return null;

  const info = db.prepare(`
    INSERT INTO messages (sender_id, receiver_id, text)
    VALUES (?, ?, ?)
  `).run(senderId, receiverId, clean);

  return db.prepare(`
    SELECT id, sender_id, receiver_id, text, created_at
    FROM messages WHERE id = ?
  `).get(info.lastInsertRowid);
}

io.use((socket, next) => {
  const initData = socket.handshake.auth?.initData;
  const telegramUser = telegramCheck(initData);

  if (telegramUser?.id) {
    upsertUser(telegramUser);
    socket.user = {
      id: Number(telegramUser.id),
      username: telegramUser.username || null,
      first_name: telegramUser.first_name || "User",
      last_name: telegramUser.last_name || null,
      photo_url: telegramUser.photo_url || null
    };
    return next();
  }

  if (process.env.REQUIRE_TELEGRAM === "true") {
    return next(new Error("Telegram authentication required"));
  }

  socket.user = { id: 999000001, username: "demo_user", first_name: "Demo", last_name: "User", photo_url: null };
  upsertUser(socket.user);
  next();
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.user.id}`);
  io.emit("presence", { userId: socket.user.id, online: true });

  socket.on("send_message", ({ receiverId, text }) => {
    const receiver = Number(receiverId);
    if (!Number.isSafeInteger(receiver) || receiver <= 0) return;
    const message = saveMessage(socket.user.id, receiver, text);
    if (!message) return;

    io.to(`user:${socket.user.id}`).to(`user:${receiver}`).emit("new_message", message);
  });

  socket.on("typing", ({ receiverId, isTyping }) => {
    const receiver = Number(receiverId);
    if (!Number.isSafeInteger(receiver)) return;
    io.to(`user:${receiver}`).emit("typing", {
      userId: socket.user.id,
      isTyping: Boolean(isTyping)
    });
  });

  socket.on("disconnect", () => {
    db.prepare("UPDATE users SET last_seen = strftime('%s','now') WHERE id = ?").run(socket.user.id);
    io.emit("presence", { userId: socket.user.id, online: false, lastSeen: Math.floor(Date.now()/1000) });
  });
});

// index.html ni ham ildiz papkadan yuklash
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

server.listen(PORT, () => {
  console.log(`Mini Chat running on http://localhost:${PORT}`);
  if (APP_URL) console.log(`Configured APP_URL: ${APP_URL}`);
});
