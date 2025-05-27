// database/db.js
const sqlite3 = require('sqlite3').verbose();

// Connect to SQLite database (creates it if it doesn't exist)
const db = new sqlite3.Database('./database/kevins-corner.db', (err) => {
  if (err) {
    console.error('Database connection error:', err);
  } else {
    console.log('Connected to SQLite database');
    
    // Create tables if they don't exist
    db.run(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
});

module.exports = db;