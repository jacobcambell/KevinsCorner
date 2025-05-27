const express = require('express');
const path = require('path');
const app = express();

// Database connection
require('./database/db');

// View engine setup
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Routes
app.use('/users', require('./routes/users'));

// Home route
app.get('/', (req, res) => {
  res.render('pages/home', { title: 'Home' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});