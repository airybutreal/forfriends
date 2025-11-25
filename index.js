require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { db, init } = require('./db');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

init();

const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret';
const PORT = process.env.PORT || 4000;

const app = express();
app.use(cors());
app.use(express.json());

// serve frontend static
app.use(express.static(path.join(__dirname, 'public')));

// --- SIMPLE FILE UPLOAD (optional) ---
const upload = multer({ dest: path.join(__dirname, 'public', 'uploads/') });
app.post('/api/upload', upload.single('file'), (req, res) => {
  // returns relative url to static file
  const fileUrl = `/uploads/${path.basename(req.file.path)}`;
  res.json({ url: fileUrl });
});

// ---------- AUTH ----------
app.post('/api/register', async (req, res) => {
  const { username, password, displayName } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'username+password required' });
  const hash = await bcrypt.hash(password, 10);
  db.run(`INSERT INTO users (username, password_hash, display_name, created_at) VALUES (?, ?, ?, ?)`,
    [username, hash, displayName || username, Date.now()], function(err) {
      if (err) return res.status(400).json({ error: 'username taken' });
      const userId = this.lastID;
      const token = jwt.sign({ id: userId, username }, JWT_SECRET, { expiresIn: '7d' });
      res.json({ token, user: { id: userId, username, displayName: displayName || username } });
    });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, row) => {
    if (err || !row) return res.status(400).json({ error: 'invalid username/password' });
    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(400).json({ error: 'invalid username/password' });
    const token = jwt.sign({ id: row.id, username: row.username }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: row.id, username: row.username, displayName: row.display_name } });
  });
});

// ---------- SERVERS / CHANNELS / MESSAGES ----------
app.get('/api/servers', (req, res) => {
  db.all(`SELECT * FROM servers`, [], (err, rows) => res.json(rows));
});

app.post('/api/servers', (req, res) => {
  const { name } = req.body;
  const invite = Math.random().toString(36).slice(2,8).toUpperCase();
  db.run(`INSERT INTO servers (name, invite_code) VALUES (?, ?)`, [name || 'Server', invite], function(err) {
    if (err) return res.status(500).json({ error: 'failed' });
    const serverId = this.lastID;
    // create default general channel
    db.run(`INSERT INTO channels (server_id, name) VALUES (?, ?)`, [serverId, 'general']);
    db.get(`SELECT * FROM servers WHERE id = ?`, [serverId], (e, r) => res.json(r));
  });
});

app.get('/api/servers/:id/channels', (req, res) => {
  db.all(`SELECT * FROM channels WHERE server_id = ?`, [req.params.id], (err, rows) => res.json(rows));
});

app.post('/api/channels', (req, res) => {
  const { serverId, name } = req.body;
  db.run(`INSERT INTO channels (server_id, name) VALUES (?, ?)`, [serverId, name || 'channel'], function(err) {
    if (err) return res.status(500).json({ error: 'failed' });
    db.get(`SELECT * FROM channels WHERE id = ?`, [this.lastID], (e, r) => res.json(r));
  });
});

app.get('/api/channels/:id/messages', (req, res) => {
  db.all(
    `SELECT m.*, u.username as author_name, u.display_name as author_display FROM messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.channel_id = ? ORDER BY m.ts ASC LIMIT 1000`,
    [req.params.id],
    (err, rows) => res.json(rows)
  );
});

// --------- HTTP server + Socket.IO ----------
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

// socket auth - token in handshake.auth.token
io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('no token'));
  try {
    const data = jwt.verify(token, JWT_SECRET);
    socket.user = data;
    return next();
  } catch (e) {
    return next(new Error('invalid token'));
  }
});

io.on('connection', (socket) => {
  console.log('user connected', socket.user.username);

  socket.on('join_channel', (channelId) => {
    socket.join('channel_' + channelId);
    console.log('join', socket.user.username, channelId);
  });

  socket.on('leave_channel', (channelId) => {
    socket.leave('channel_' + channelId);
  });

  socket.on('send_message', (payload) => {
    // payload { channelId, text }
    if (!socket.user || !payload?.channelId || !payload?.text) return;
    const ts = Date.now();
    db.run(`INSERT INTO messages (channel_id, author_id, text, ts) VALUES (?, ?, ?, ?)`,
      [payload.channelId, socket.user.id, payload.text, ts], function(err) {
        if (err) return;
        // fetch saved message with user info
        db.get(`SELECT m.*, u.username as author_name, u.display_name as author_display FROM messages m LEFT JOIN users u ON u.id = m.author_id WHERE m.id = ?`, [this.lastID], (e, row) => {
          io.to('channel_' + payload.channelId).emit('message', row);
        });
      });
  });

  socket.on('disconnect', () => {
    console.log('disconnect', socket.user.username);
  });
});

httpServer.listen(PORT, () => console.log('Server running on http://localhost:' + PORT));
