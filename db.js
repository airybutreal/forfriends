// db.js - sqlite helper
const sqlite3 = require('sqlite3').verbose();
const DB_PATH = './database.sqlite3';
const db = new sqlite3.Database(DB_PATH);

function init(){
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password_hash TEXT,
        display_name TEXT,
        created_at INTEGER
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS servers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        invite_code TEXT
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        server_id INTEGER,
        name TEXT
      );
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER,
        author_id INTEGER,
        text TEXT,
        ts INTEGER
      );
    `);

    // create default 'Friends' server + 'general' channel
    db.get(`SELECT id FROM servers WHERE name = ?`, ['Friends'], (err, row) => {
      if (!row) {
        db.run(`INSERT INTO servers (name, invite_code) VALUES (?, ?)`, ['Friends', Math.random().toString(36).slice(2,8).toUpperCase()], function() {
          const serverId = this.lastID;
          db.run(`INSERT INTO channels (server_id, name) VALUES (?, ?)`, [serverId, 'general']);
        });
      }
    });
  });
}

module.exports = { db, init };
