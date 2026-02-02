const express = require('express');
const http = require('http');
const path = require('path');
const session = require('express-session');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');
const sqlite3 = require('sqlite3').verbose();
const { Server } = require('socket.io');

const APP_PORT = process.env.PORT || 3000;
const PASSCODE = process.env.PASSCODE || 'changeme';
const SESSION_SECRET = process.env.SESSION_SECRET || 'please_change_this_secret';

// Basic Express setup
const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Session middleware (shared between Express and Socket.IO)
const sessionMiddleware = session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 day
});
app.use(cookieParser());
app.use(sessionMiddleware);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Wrap session middleware for socket.io
io.use((socket, next) => {
  sessionMiddleware(socket.request, socket.request.res || {}, next);
});

// Initialize SQLite DB
const DB_PATH = path.join(__dirname, 'chat.sqlite');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      created_at INTEGER
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel_id INTEGER,
      user_id TEXT,
      username TEXT,
      text TEXT,
      timestamp INTEGER,
      edited_at INTEGER,
      FOREIGN KEY(channel_id) REFERENCES channels(id)
    );
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS reactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER,
      emoji TEXT,
      user_id TEXT,
      username TEXT,
      timestamp INTEGER,
      FOREIGN KEY(message_id) REFERENCES messages(id)
    );
  `);
});

// Helper: run SQL with Promise
function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}
function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}
function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

// Middleware to require session auth (passcode entered)
function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'not_authenticated' });
}

// Routes: login with passcode + optional username
app.post('/login', (req, res) => {
  const { passcode, username } = req.body;
  if (!passcode || passcode !== PASSCODE) {
    return res.status(401).json({ ok: false });
  }
  // mark session as authenticated and store user id (simple random id)
  req.session.authed = true;
  // create a stable user id per session to identify message authors (you can expand to real auth)
  if (!req.session.userId) req.session.userId = 'u_' + Math.random().toString(36).slice(2, 10);
  req.session.username = (username && username.trim()) ? username.trim() : ('User' + Math.floor(Math.random()*9000+1000));
  req.session.save(() => res.json({ ok: true, userId: req.session.userId, username: req.session.username }));
});

app.get('/api/session', (req, res) => {
  if (req.session && req.session.authed) {
    return res.json({ authed: true, userId: req.session.userId, username: req.session.username });
  }
  return res.json({ authed: false });
});

// Channels API
app.get('/api/channels', requireAuth, async (req, res) => {
  const rows = await all('SELECT id, name FROM channels ORDER BY name ASC');
  res.json({ channels: rows });
});
app.post('/api/channels', requireAuth, async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'missing_name' });
  const timestamp = Date.now();
  const result = await run('INSERT INTO channels (name, created_at) VALUES (?,?)', [name, timestamp]);
  const id = result.lastID;
  const ch = await get('SELECT id, name FROM channels WHERE id = ?', [id]);
  io.emit('channel_created', ch);
  res.json({ channel: ch });
});

// Messages API
app.get('/api/messages/:channelId', requireAuth, async (req, res) => {
  const channelId = Number(req.params.channelId);
  const msgs = await all('SELECT * FROM messages WHERE channel_id = ? ORDER BY timestamp ASC', [channelId]);
  for (const m of msgs) {
    m.reactions = await all('SELECT id, message_id, emoji, user_id, username, timestamp FROM reactions WHERE message_id = ? ORDER BY timestamp ASC', [m.id]);
  }
  res.json({ messages: msgs });
});

// Socket.IO events (require session authed)
io.use((socket, next) => {
  const req = socket.request;
  if (req.session && req.session.authed) return next();
  next(new Error('unauthorized'));
});

io.on('connection', (socket) => {
  const sid = socket.request.session;
  const userId = sid.userId;
  const username = sid.username;

  socket.on('join_channel', async (channelId) => {
    socket.join('channel_' + channelId);
  });

  socket.on('send_message', async (data) => {
    const { channelId, text } = data;
    if (!channelId || !text) return;
    const timestamp = Date.now();
    const result = await run(
      'INSERT INTO messages (channel_id, user_id, username, text, timestamp) VALUES (?,?,?,?,?)',
      [channelId, userId, username, text, timestamp]
    );
    const newMsgId = result.lastID;
    const message = await get('SELECT * FROM messages WHERE id = ?', [newMsgId]);
    message.reactions = [];
    io.to('channel_' + channelId).emit('new_message', message);
  });

  socket.on('toggle_reaction', async (data) => {
    // add/remove reaction by (messageId, emoji, user)
    const { messageId, emoji } = data;
    if (!messageId || !emoji) return;
    const existing = await get('SELECT id FROM reactions WHERE message_id = ? AND emoji = ? AND user_id = ?', [messageId, emoji, userId]);
    if (existing) {
      await run('DELETE FROM reactions WHERE id = ?', [existing.id]);
      io.emit('reaction_removed', { id: existing.id, messageId, emoji, userId, username });
    } else {
      const ts = Date.now();
      const r = await run('INSERT INTO reactions (message_id, emoji, user_id, username, timestamp) VALUES (?,?,?,?,?)', [messageId, emoji, userId, username, ts]);
      const newId = r.lastID;
      const reaction = await get('SELECT * FROM reactions WHERE id = ?', [newId]);
      io.emit('reaction_added', reaction);
    }
  });

  socket.on('edit_message', async (data) => {
    const { messageId, newText } = data;
    if (!messageId || typeof newText !== 'string') return;
    const msg = await get('SELECT * FROM messages WHERE id = ?', [messageId]);
    if (!msg) return;
    if (msg.user_id !== userId) return; // only author can edit
    const editedAt = Date.now();
    await run('UPDATE messages SET text = ?, edited_at = ? WHERE id = ?', [newText, editedAt, messageId]);
    const updated = await get('SELECT * FROM messages WHERE id = ?', [messageId]);
    io.emit('message_edited', updated);
  });

  socket.on('delete_message', async (data) => {
    const { messageId } = data;
    if (!messageId) return;
    const msg = await get('SELECT * FROM messages WHERE id = ?', [messageId]);
    if (!msg) return;
    if (msg.user_id !== userId) return; // only author can delete
    await run('DELETE FROM reactions WHERE message_id = ?', [messageId]);
    await run('DELETE FROM messages WHERE id = ?', [messageId]);
    io.emit('message_deleted', { messageId });
  });
});

// Serve index.html from / (public/index.html)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start server
server.listen(APP_PORT, () => {
  console.log(`Server listening on port ${APP_PORT}`);
});