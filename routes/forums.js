const express = require('express');
const router = express.Router();
const db = require('../database/db');
const timeUtils = require('../utils/timeUtils');

// Middleware to check if user is admin
function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  db.get('SELECT * FROM users WHERE id = ? AND username = ? AND displayname = ?', 
    [req.session.userId, 'admin', 'admin'], (err, user) => {
    if (err || !user) {
      return res.status(403).render('pages/error', { 
        error: 'Access denied. Admin privileges required.',
        user: req.session.userId ? {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname
        } : null
      });
    }
    next();
  });
}

// Forums main page - list all categories
router.get('/', (req, res) => {
  const websiteSearch = req.query.websiteSearch;

  db.all('SELECT * FROM forum_categories ORDER BY created_at ASC', [], (err, categories) => {
    if (err) {
      console.error('Error fetching forum categories:', err);
      return res.status(500).render('pages/error', { 
        error: 'Database error',
        user: req.session.userId ? {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname
        } : null
      });
    }

    // If there's a website search query, search the website directory
    if (websiteSearch && websiteSearch.trim()) {
      const searchPattern = `%${websiteSearch.toLowerCase().trim()}%`;
      const query = `SELECT * FROM website_directory 
                     WHERE is_active = 1 
                     AND (keywords LIKE ? OR title LIKE ? OR url LIKE ?)
                     ORDER BY title ASC`;

      db.all(query, [searchPattern, searchPattern, searchPattern], (err, websites) => {
        if (err) {
          console.error('Error searching website directory:', err);
          websites = [];
        }

        // Get forum banners for website search results
        db.all('SELECT * FROM forum_banners WHERE is_active = 1 ORDER BY display_order ASC, created_at ASC', [], (err, banners) => {
          if (err) {
            console.error('Error fetching forum banners:', err);
            banners = [];
          }

          res.render('pages/forums', { 
            categories: categories || [],
            websites: websites || [],
            websiteSearch: websiteSearch,
            banners: banners || [],
            error: req.query.error || null,
            success: req.query.success || null,
            user: req.session.userId ? {
              id: req.session.userId,
              username: req.session.username,
              displayname: req.session.displayname
            } : null
          });
        });
      });
    } else {
      // Get forum banners for regular page load
      db.all('SELECT * FROM forum_banners WHERE is_active = 1 ORDER BY display_order ASC, created_at ASC', [], (err, banners) => {
        if (err) {
          console.error('Error fetching forum banners:', err);
          banners = [];
        }

        res.render('pages/forums', { 
          categories: categories || [],
          banners: banners || [],
          error: req.query.error || null,
          success: req.query.success || null,
          user: req.session.userId ? {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname
          } : null
        });
      });
    }
  });
});

// View category and its threads
router.get('/category/:id', (req, res) => {
  const categoryId = req.params.id;

  // First get the forum banners
  db.all('SELECT * FROM forum_banners WHERE is_active = 1 ORDER BY display_order ASC, created_at ASC', [], (err, banners) => {
    if (err) {
      console.error('Error fetching forum banners:', err);
      banners = [];
    }

    // Get category info
    db.get('SELECT * FROM forum_categories WHERE id = ?', [categoryId], (err, category) => {
      if (err || !category) {
        return res.redirect('/forums?error=Category not found');
      }

      // Get threads in this category with reply counts
      db.all(`SELECT ft.*, 
                     (SELECT COUNT(*) FROM forum_posts WHERE thread_id = ft.id) as actual_reply_count
              FROM forum_threads ft
              WHERE ft.category_id = ? 
              ORDER BY ft.is_pinned DESC, ft.last_reply_at DESC, ft.created_at DESC`, 
        [categoryId], (err, threads) => {
        if (err) {
          console.error('Error fetching threads:', err);
          threads = [];
        } else if (threads) {
          // Use the calculated reply count
          threads = threads.map(thread => ({
            ...thread,
            reply_count: thread.actual_reply_count || 0
          }));
        }

        res.render('pages/forum-category', { 
          category: category,
          threads: threads || [],
          banners: banners || [],
          error: req.query.error,
          success: req.query.success,
          user: req.session.userId ? {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname
          } : null
        });
      });
    });
  });
});

// View thread and its posts
router.get('/thread/:id', (req, res) => {
  const threadId = req.params.id;

  // First get the forum banners
  db.all('SELECT * FROM forum_banners WHERE is_active = 1 ORDER BY display_order ASC, created_at ASC', [], (err, banners) => {
    if (err) {
      console.error('Error fetching forum banners:', err);
      banners = [];
    }

    // Get thread info
    db.get(`SELECT t.*, c.name as category_name 
            FROM forum_threads t 
            JOIN forum_categories c ON t.category_id = c.id 
            WHERE t.id = ?`, [threadId], (err, thread) => {
      if (err || !thread) {
        return res.redirect('/forums?error=Thread not found');
      }

      // Get posts in this thread
      db.all('SELECT * FROM forum_posts WHERE thread_id = ? ORDER BY created_at ASC', 
        [threadId], (err, posts) => {
        if (err) {
          console.error('Error fetching posts:', err);
          posts = [];
        }

        res.render('pages/forum-thread', { 
          thread: thread,
          posts: posts || [],
          banners: banners || [],
          error: req.query.error,
          success: req.query.success,
          user: req.session.userId ? {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname
          } : null
        });
      });
    });
  });
});

// Create new thread (admin only)
router.get('/category/:id/new-thread', requireAdmin, (req, res) => {
  const categoryId = req.params.id;

  db.get('SELECT * FROM forum_categories WHERE id = ?', [categoryId], (err, category) => {
    if (err || !category) {
      return res.redirect('/forums?error=Category not found');
    }

    res.render('pages/forum-new-thread', { 
      category: category,
      error: req.query.error,
      success: null,
      user: {
        id: req.session.userId,
        username: req.session.username,
        displayname: req.session.displayname
      }
    });
  });
});

// Handle new thread creation (admin only)
router.post('/category/:id/new-thread', requireAdmin, (req, res) => {
  const categoryId = req.params.id;
  const { title, content, is_pinned } = req.body;

  if (!title || !content) {
    return res.redirect(`/forums/category/${categoryId}/new-thread?error=Title and content are required`);
  }

  db.run(`INSERT INTO forum_threads 
          (category_id, title, content, created_by, created_by_username, created_by_displayname, is_pinned, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [categoryId, title, content, req.session.userId, req.session.username, req.session.displayname, is_pinned ? 1 : 0, timeUtils.now()],
    function(err) {
      if (err) {
        console.error('Error creating thread:', err);
        return res.redirect(`/forums/category/${categoryId}/new-thread?error=Failed to create thread`);
      }

      res.redirect(`/forums/thread/${this.lastID}?success=Thread created successfully`);
    }
  );
});

// Add reply to thread (users and vendors can reply)
router.post('/thread/:id/reply', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const threadId = req.params.id;
  const { content } = req.body;

  if (!content) {
    return res.redirect(`/forums/thread/${threadId}?error=Reply content is required`);
  }

  // Check if thread exists and is not locked
  db.get('SELECT * FROM forum_threads WHERE id = ?', [threadId], (err, thread) => {
    if (err || !thread) {
      return res.redirect('/forums?error=Thread not found');
    }

    if (thread.is_locked === 1) {
      return res.redirect(`/forums/thread/${threadId}?error=This thread is locked`);
    }

    // Add the reply
    const serverTime = timeUtils.now();
    db.run(`INSERT INTO forum_posts 
            (thread_id, content, created_by, created_by_username, created_by_displayname, created_at)
            VALUES (?, ?, ?, ?, ?, ?)`,
      [threadId, content, req.session.userId, req.session.username, req.session.displayname, serverTime],
      function(err) {
        if (err) {
          console.error('Error adding reply:', err);
          return res.redirect(`/forums/thread/${threadId}?error=Failed to add reply`);
        }

        // Update thread reply count and last reply time
        db.run(`UPDATE forum_threads 
                SET reply_count = (SELECT COUNT(*) FROM forum_posts WHERE thread_id = ?), 
                    last_reply_at = ?
                WHERE id = ?`,
          [threadId, serverTime, threadId], (err) => {
          if (err) {
            console.error('Error updating thread stats:', err);
          }
          res.redirect(`/forums/thread/${threadId}?success=Reply added successfully`);
        });
      }
    );
  });
});

// API endpoint to get active forum banners
router.get('/api/forum-banners', (req, res) => {
  console.log('Forum banners API called');
  db.all('SELECT * FROM forum_banners WHERE is_active = 1 ORDER BY display_order ASC, created_at ASC', [], (err, banners) => {
    if (err) {
      console.error('Error fetching forum banners:', err);
      return res.status(500).json({ error: 'Failed to fetch banners' });
    }

    console.log(`Found ${banners ? banners.length : 0} active banners`);
    if (banners && banners.length > 0) {
      console.log('Banner titles:', banners.map(b => b.title));
    }

    res.json(banners || []);
  });
});

// API endpoint to search website directory
router.get('/api/website-search', (req, res) => {
  const searchTerm = req.query.q;

  if (!searchTerm) {
    return res.json([]);
  }

  const query = `SELECT * FROM website_directory 
                 WHERE is_active = 1 
                 AND (keywords LIKE ? OR title LIKE ? OR url LIKE ?)
                 ORDER BY title ASC`;

  const searchPattern = `%${searchTerm.toLowerCase()}%`;

  db.all(query, [searchPattern, searchPattern, searchPattern], (err, websites) => {
    if (err) {
      console.error('Error searching website directory:', err);
      return res.status(500).json({ error: 'Search failed' });
    }

    res.json(websites || []);
  });
});

// API endpoint to add website to directory
router.post('/api/website-directory/add', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Login required' });
  }

  const { title, url, keywords, description } = req.body;

  if (!title || !url || !keywords) {
    return res.status(400).json({ error: 'Title, URL, and keywords are required' });
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  db.run(`INSERT INTO website_directory (title, url, keywords, description, created_by, created_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    [title, url, keywords.toLowerCase(), description || null, req.session.userId, timeUtils.now()],
    function(err) {
      if (err) {
        console.error('Error adding website to directory:', err);
        return res.status(500).json({ error: 'Failed to add website' });
      }

      res.json({ 
        success: true, 
        message: 'Website added to directory',
        id: this.lastID 
      });
    }
  );
});

module.exports = router;