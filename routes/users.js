const express = require('express');
const router = express.Router();
const db = require('../database/db'); // Updated path

router.get('/', (req, res) => {
  db.all('SELECT * FROM users', [], (err, rows) => {
    if (err) {
      return res.status(500).send(err.message);
    }
    res.render('pages/users', { users: rows || [] });
  });
});

module.exports = router;