const express = require('express');
const router = express.Router();
const db = require('../database/db');
const multer = require('multer');

// Configure multer for memory storage (we'll convert to base64)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Admin authentication middleware
function requireAdmin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is admin
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

// Admin dashboard
router.get('/dashboard', requireAdmin, (req, res) => {
  db.all('SELECT id, username, displayname, created_at, is_vendor FROM users ORDER BY created_at DESC', [], (err, users) => {
    if (err) {
      return res.status(500).render('pages/error', { 
        error: 'Database error: ' + err.message,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname
        }
      });
    }

    // Calculate financial metrics
    db.get(`SELECT 
      SUM(CASE WHEN status = 'completed' THEN total_price * 0.05 ELSE 0 END) as paid_vendor_fee,
      SUM(CASE WHEN status = 'pending' OR status = 'processing' OR status = 'accepted' THEN total_price ELSE 0 END) as total_in_escrow,
      SUM(CASE WHEN status = 'completed' THEN total_price * 0.05 ELSE 0 END) as market_fee
      FROM orders`, [], (err, financials) => {

      // Calculate actual escrow after deducting the 5% fee
      const totalInEscrow = financials ? (financials.total_in_escrow || 0) : 0;
      const escrowFee = totalInEscrow * 0.05;
      const actualEscrow = totalInEscrow - escrowFee;

      // Calculate order statistics
      db.get(`SELECT 
        COUNT(CASE WHEN status = 'processing' THEN 1 END) as orders_processing,
        COUNT(CASE WHEN status = 'disputed' THEN 1 END) as disputes_open,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_orders
        FROM orders`, [], (err, orderStats) => {

        const stats = {
          paidVendorFee: financials ? (financials.paid_vendor_fee || 0).toFixed(2) : '0.00',
          inEscrow: actualEscrow.toFixed(2),
          escrowFee: escrowFee.toFixed(2),
          marketFee: ((financials ? (financials.market_fee || 0) : 0) + escrowFee).toFixed(2),
          ordersProcessing: orderStats ? (orderStats.orders_processing || 0) : 0,
          disputesOpen: orderStats ? (orderStats.disputes_open || 0) : 0,
          completedOrders: orderStats ? (orderStats.completed_orders || 0) : 0
        };

        res.render('pages/admin-dashboard', { 
          users: users || [],
          stats: stats,
          user: {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname
          }
        });
      });
    });
  });
});

// Admin users management
router.get('/users', requireAdmin, (req, res) => {
  db.all('SELECT * FROM users ORDER BY created_at DESC', [], (err, users) => {
    if (err) {
      return res.status(500).render('pages/error', { 
        error: 'Database error: ' + err.message,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname
        }
      });
    }

    res.render('pages/admin-users', { 
      users: users || [],
      user: {
        id: req.session.userId,
        username: req.session.username,
        displayname: req.session.displayname
      },
      success: req.query.success,
      error: req.query.error
    });
  });
});

// Ban user
router.post('/ban-user/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;
  const { ban_reason } = req.body;

  if (userId == req.session.userId) {
    return res.redirect('/admin/users?error=Cannot ban yourself');
  }

  db.run('UPDATE users SET is_banned = 1, ban_reason = ? WHERE id = ?', 
    [ban_reason || 'No reason provided', userId], function(err) {
    if (err) {
      return res.redirect('/admin/users?error=Failed to ban user');
    }
    res.redirect('/admin/users?success=User banned successfully');
  });
});

// Unban user
router.post('/unban-user/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;

  db.run('UPDATE users SET is_banned = 0, ban_reason = NULL WHERE id = ?', 
    [userId], function(err) {
    if (err) {
      return res.redirect('/admin/users?error=Failed to unban user');
    }
    res.redirect('/admin/users?success=User unbanned successfully');
  });
});

// Support messages management
router.get('/support', requireAdmin, (req, res) => {
  db.all('SELECT * FROM support_messages ORDER BY last_activity DESC', [], (err, messages) => {
    if (err) {
      return res.status(500).render('pages/error', { 
        error: 'Database error: ' + err.message,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname
        }
      });
    }

    // Get replies for each message
    const messagesWithReplies = [];
    let completed = 0;

    if (!messages || messages.length === 0) {
      return res.render('pages/admin-support', { 
        messages: [],
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname
        },
        success: req.query.success,
        error: req.query.error
      });
    }

    messages.forEach(message => {
      db.all('SELECT * FROM support_message_replies WHERE message_id = ? ORDER BY created_at ASC',
        [message.id], (err, replies) => {
        message.replies = replies || [];
        messagesWithReplies.push(message);
        completed++;

        if (completed === messages.length) {
          // Sort by last activity again
          messagesWithReplies.sort((a, b) => new Date(b.last_activity) - new Date(a.last_activity));
          res.render('pages/admin-support', { 
            messages: messagesWithReplies,
            user: {
              id: req.session.userId,
              username: req.session.username,
              displayname: req.session.displayname
            },
            success: req.query.success,
            error: req.query.error
          });
        }
      });
    });
  });
});

// Respond to support message
router.post('/support/:id/respond', requireAdmin, (req, res) => {
  const messageId = req.params.id;
  const { admin_response } = req.body;

  if (!admin_response) {
    return res.redirect('/admin/support?error=Response cannot be empty');
  }

  // Add the admin reply
  db.run(`INSERT INTO support_message_replies 
          (message_id, sender_type, sender_id, sender_name, reply_text) 
          VALUES (?, ?, ?, ?, ?)`,
    [messageId, 'admin', req.session.userId, req.session.displayname, admin_response],
    function(err) {
      if (err) {
        return res.redirect('/admin/support?error=Failed to send response');
      }

      // Update message status and last activity
      db.run('UPDATE support_messages SET status = ?, last_activity = ? WHERE id = ?',
        ['responded', new Date().toISOString(), messageId], (err) => {
        if (err) {
          console.error('Error updating message status:', err);
        }
        res.redirect('/admin/support?success=Response sent successfully');
      });
    }
  );
});

// Close support message
router.post('/support/:id/close', requireAdmin, (req, res) => {
  const messageId = req.params.id;

  db.run('UPDATE support_messages SET status = ?, last_activity = ? WHERE id = ?', 
    ['closed', new Date().toISOString(), messageId], function(err) {
    if (err) {
      return res.redirect('/admin/support?error=Failed to close message');
    }
    res.redirect('/admin/support?success=Message closed successfully');
  });
});

// Reopen support message
router.post('/support/:id/reopen', requireAdmin, (req, res) => {
  const messageId = req.params.id;

  db.run('UPDATE support_messages SET status = ?, last_activity = ? WHERE id = ?', 
    ['open', new Date().toISOString(), messageId], function(err) {
    if (err) {
      return res.redirect('/admin/support?error=Failed to reopen message');
    }
    res.redirect('/admin/support?success=Message reopened successfully');
  });
});

// Make user a vendor
router.post('/make-vendor/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;

  if (userId == req.session.userId) {
    return res.redirect('/admin/users?error=Cannot modify your own vendor status');
  }

  // Check if user is already a vendor
  db.get('SELECT is_vendor, displayname FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.redirect('/admin/users?error=Failed to check user status');
    }

    if (!user) {
      return res.redirect('/admin/users?error=User not found');
    }

    if (user.is_vendor === 1) {
      return res.redirect('/admin/users?error=User is already a vendor');
    }

    // Update user to be a vendor
    db.run('UPDATE users SET is_vendor = 1 WHERE id = ?', [userId], function(err) {
      if (err) {
        return res.redirect('/admin/users?error=Failed to make user a vendor');
      }

      // Insert into vendors table
      db.run('INSERT OR IGNORE INTO vendors (user_id, business_name, business_description) VALUES (?, ?, ?)', 
        [userId, user.displayname + "'s Store", "Vendor store created by admin"], 
        function(err) {
          if (err) {
            console.error('Error creating vendor record:', err);
          }
          res.redirect('/admin/users?success=User successfully made a vendor');
        }
      );
    });
  });
});

// Remove vendor status from user
router.post('/remove-vendor/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;

  if (userId == req.session.userId) {
    return res.redirect('/admin/users?error=Cannot modify your own vendor status');
  }

  // Check if user is a vendor
  db.get('SELECT is_vendor FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.redirect('/admin/users?error=Failed to check user status');
    }

    if (!user) {
      return res.redirect('/admin/users?error=User not found');
    }

    if (user.is_vendor !== 1) {
      return res.redirect('/admin/users?error=User is not a vendor');
    }

    // Remove vendor status
    db.run('UPDATE users SET is_vendor = 0 WHERE id = ?', [userId], function(err) {
      if (err) {
        return res.redirect('/admin/users?error=Failed to remove vendor status');
      }

      // Remove from vendors table
      db.run('DELETE FROM vendors WHERE user_id = ?', [userId], function(err) {
        if (err) {
          console.error('Error removing vendor record:', err);
        }
        res.redirect('/admin/users?success=Vendor status removed successfully');
      });
    });
  });
});

// Delete support message (admin can delete any message)
router.post('/support/:id/delete', requireAdmin, (req, res) => {
  const messageId = req.params.id;

  // Delete all replies first
  db.run('DELETE FROM support_message_replies WHERE message_id = ?', [messageId], (err) => {
    if (err) {
      console.error('Error deleting message replies:', err);
      return res.redirect('/admin/support?error=Failed to delete message');
    }

    // Delete the main message
    db.run('DELETE FROM support_messages WHERE id = ?', [messageId], (err) => {
      if (err) {
        console.error('Error deleting support message:', err);
        return res.redirect('/admin/support?error=Failed to delete message');
      }

      res.redirect('/admin/support?success=Message deleted successfully');
    });
  });
});

// Admin forum categories management page
router.get('/forum-categories', requireAdmin, (req, res) => {
  // Get all forum categories
  db.all('SELECT * FROM forum_categories ORDER BY created_at ASC', [], (err, categories) => {
    if (err) {
      console.error('Error fetching forum categories:', err);
      categories = [];
    }

    // Get all forum banners
    db.all('SELECT * FROM forum_banners ORDER BY display_order ASC, created_at ASC', [], (err, banners) => {
      if (err) {
        console.error('Error fetching forum banners:', err);
        banners = [];
      }

      // Get all websites in directory
      db.all('SELECT * FROM website_directory ORDER BY created_at DESC', [], (err, websites) => {
        if (err) {
          console.error('Error fetching website directory:', err);
          websites = [];
        }

        // Get thread counts for categories
        const categoriesWithStats = [];
        let completed = 0;

        if (!categories || categories.length === 0) {
          return res.render('pages/admin-forum-categories', { 
            categories: [],
            banners: banners || [],
            websites: websites || [],
            error: req.query.error,
            success: req.query.success,
            user: {
              id: req.session.userId,
              username: req.session.username,
              displayname: req.session.displayname
            }
          });
        }

        categories.forEach(category => {
          db.get('SELECT COUNT(*) as thread_count FROM forum_threads WHERE category_id = ?', 
            [category.id], (err, result) => {
            category.thread_count = result ? result.thread_count : 0;
            categoriesWithStats.push(category);
            completed++;

            if (completed === categories.length) {
              res.render('pages/admin-forum-categories', { 
                categories: categoriesWithStats,
                banners: banners || [],
                websites: websites || [],
                error: req.query.error,
                success: req.query.success,
                user: {
                  id: req.session.userId,
                  username: req.session.username,
                  displayname: req.session.displayname
                }
              });
            }
          });
        });
      });
    });
  });
});

// Add new forum category
router.post('/forum-categories/add', requireAdmin, (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    return res.redirect('/admin/forum-categories?error=Category name is required');
  }

  // Check if category name already exists
  db.get('SELECT id FROM forum_categories WHERE name = ?', [name], (err, existing) => {
    if (err) {
      console.error('Error checking existing category:', err);
      return res.redirect('/admin/forum-categories?error=Failed to create category');
    }

    if (existing) {
      return res.redirect('/admin/forum-categories?error=Category name already exists');
    }

    // Create new category
    db.run('INSERT INTO forum_categories (name, description, created_by) VALUES (?, ?, ?)', 
      [name, description || null, req.session.userId], function(err) {
      if (err) {
        console.error('Error creating forum category:', err);
        return res.redirect('/admin/forum-categories?error=Failed to create category');
      }

      res.redirect('/admin/forum-categories?success=Category created successfully');
    });
  });
});

// Delete forum category
router.post('/forum-categories/:id/delete', requireAdmin, (req, res) => {
  const categoryId = req.params.id;

  // Check if category exists and count threads
  db.get('SELECT COUNT(*) as thread_count FROM forum_threads WHERE category_id = ?', 
    [categoryId], (err, result) => {
    if (err) {
      console.error('Error checking thread count:', err);
      return res.redirect('/admin/forum-categories?error=Failed to delete category');
    }

    if (result.thread_count > 0) {
      return res.redirect('/admin/forum-categories?error=Cannot delete category with existing threads');
    }

    // Delete the category
    db.run('DELETE FROM forum_categories WHERE id = ?', [categoryId], function(err) {
      if (err) {
        console.error('Error deleting forum category:', err);
        return res.redirect('/admin/forum-categories?error=Failed to delete category');
      }

      if (this.changes === 0) {
        return res.redirect('/admin/forum-categories?error=Category not found');
      }

      res.redirect('/admin/forum-categories?success=Category deleted successfully');
    });
  });
});

// Get forum banners list (JSON endpoint)
router.get('/forum-banners/list', requireAdmin, (req, res) => {
  db.all('SELECT * FROM forum_banners ORDER BY display_order ASC, created_at ASC', [], (err, banners) => {
    if (err) {
      console.error('Error fetching forum banners:', err);
      return res.status(500).json([]);
    }
    res.json(banners || []);
  });
});



// Add new forum banner
router.post('/forum-banners/add', requireAdmin, upload.single('banner_image'), (req, res) => {
  const { title, link_url, display_order, keywords } = req.body;

  if (!title || !req.file) {
    return res.redirect('/admin/forum-categories?error=Banner title and image are required');
  }

  // Convert image to base64
  const imageBase64 = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;

  db.run('INSERT INTO forum_banners (title, image_data, link_url, display_order, keywords, created_by) VALUES (?, ?, ?, ?, ?, ?)', 
    [title, imageBase64, link_url || null, parseInt(display_order) || 0, keywords || null, req.session.userId], function(err) {
    if (err) {
      console.error('Error creating forum banner:', err);
      return res.redirect('/admin/forum-categories?error=Failed to create banner');
    }

    res.redirect('/admin/forum-categories?success=Banner created successfully');
  });
});

// Toggle banner active status
router.post('/forum-banners/:id/toggle', requireAdmin, (req, res) => {
  const bannerId = req.params.id;

  db.get('SELECT is_active FROM forum_banners WHERE id = ?', [bannerId], (err, banner) => {
    if (err || !banner) {
      return res.redirect('/admin/forum-categories?error=Banner not found');
    }

    const newStatus = banner.is_active === 1 ? 0 : 1;

    db.run('UPDATE forum_banners SET is_active = ? WHERE id = ?', [newStatus, bannerId], function(err) {
      if (err) {
        console.error('Error toggling banner status:', err);
        return res.redirect('/admin/forum-categories?error=Failed to update banner');
      }

      res.redirect('/admin/forum-categories?success=Banner status updated successfully');
    });
  });
});

// Delete forum banner
router.post('/forum-banners/:id/delete', requireAdmin, (req, res) => {
  const bannerId = req.params.id;

  db.run('DELETE FROM forum_banners WHERE id = ?', [bannerId], function(err) {
    if (err) {
      console.error('Error deleting forum banner:', err);
      return res.redirect('/admin/forum-categories?error=Failed to delete banner');
    }

    if (this.changes === 0) {
      return res.redirect('/admin/forum-categories?error=Banner not found');
    }

    res.redirect('/admin/forum-categories?success=Banner deleted successfully');
  });
});

// Add website to directory
router.post('/website-directory/add', requireAdmin, (req, res) => {
  const { title, url, keywords, description } = req.body;

  if (!title || !url || !keywords) {
    return res.redirect('/admin/forum-categories?error=Title, URL, and keywords are required');
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch (e) {
    return res.redirect('/admin/forum-categories?error=Invalid URL format');
  }

  // Check if website already exists
  db.get('SELECT id FROM website_directory WHERE url = ?', [url], (err, existing) => {
    if (err) {
      console.error('Error checking existing website:', err);
      return res.redirect('/admin/forum-categories?error=Failed to add website');
    }

    if (existing) {
      return res.redirect('/admin/forum-categories?error=Website with this URL already exists');
    }

    // Add website to directory
    db.run('INSERT INTO website_directory (title, url, keywords, description, created_by) VALUES (?, ?, ?, ?, ?)', 
      [title, url, keywords.toLowerCase(), description || null, req.session.userId], function(err) {
      if (err) {
        console.error('Error adding website to directory:', err);
        return res.redirect('/admin/forum-categories?error=Failed to add website');
      }

      res.redirect('/admin/forum-categories?success=Website added to directory successfully');
    });
  });
});

// Toggle website active status
router.post('/website-directory/:id/toggle', requireAdmin, (req, res) => {
  const websiteId = req.params.id;

  db.get('SELECT is_active FROM website_directory WHERE id = ?', [websiteId], (err, website) => {
    if (err || !website) {
      return res.redirect('/admin/forum-categories?error=Website not found');
    }

    const newStatus = website.is_active === 1 ? 0 : 1;

    db.run('UPDATE website_directory SET is_active = ? WHERE id = ?', [newStatus, websiteId], function(err) {
      if (err) {
        console.error('Error toggling website status:', err);
        return res.redirect('/admin/forum-categories?error=Failed to update website');
      }

      res.redirect('/admin/forum-categories?success=Website status updated successfully');
    });
  });
});

// Delete website from directory
router.post('/website-directory/:id/delete', requireAdmin, (req, res) => {
  const websiteId = req.params.id;

  db.run('DELETE FROM website_directory WHERE id = ?', [websiteId], function(err) {
    if (err) {
      console.error('Error deleting website:', err);
      return res.redirect('/admin/forum-categories?error=Failed to delete website');
    }

    if (this.changes === 0) {
      return res.redirect('/admin/forum-categories?error=Website not found');
    }

    res.redirect('/admin/forum-categories?success=Website deleted successfully');
  });
});

// Make vendor trusted
router.post('/make-trusted-vendor/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;

  if (userId == req.session.userId) {
    return res.redirect('/admin/dashboard?error=Cannot modify your own trusted status');
  }

  // Check if user is a vendor
  db.get('SELECT is_vendor, is_trusted_vendor FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.redirect('/admin/dashboard?error=Failed to check user status');
    }

    if (!user) {
      return res.redirect('/admin/dashboard?error=User not found');
    }

    if (user.is_vendor !== 1) {
      return res.redirect('/admin/dashboard?error=User is not a vendor');
    }

    if (user.is_trusted_vendor === 1) {
      return res.redirect('/admin/dashboard?error=User is already a trusted vendor');
    }

    // Make vendor trusted
    db.run('UPDATE users SET is_trusted_vendor = 1 WHERE id = ?', [userId], function(err) {
      if (err) {
        return res.redirect('/admin/dashboard?error=Failed to make vendor trusted');
      }

      // Update vendors table as well
      db.run('UPDATE vendors SET is_trusted = 1 WHERE user_id = ?', [userId], function(err) {
        if (err) {
          console.error('Error updating vendor trusted status:', err);
        }
        res.redirect('/admin/dashboard?success=Vendor successfully marked as trusted');
      });
    });
  });
});

// Remove trusted vendor status
router.post('/remove-trusted-vendor/:id', requireAdmin, (req, res) => {
  const userId = req.params.id;

  if (userId == req.session.userId) {
    return res.redirect('/admin/dashboard?error=Cannot modify your own trusted status');
  }

  // Check if user is a trusted vendor
  db.get('SELECT is_vendor, is_trusted_vendor FROM users WHERE id = ?', [userId], (err, user) => {
    if (err) {
      return res.redirect('/admin/dashboard?error=Failed to check user status');
    }

    if (!user) {
      return res.redirect('/admin/dashboard?error=User not found');
    }

    if (user.is_vendor !== 1) {
      return res.redirect('/admin/dashboard?error=User is not a vendor');
    }

    if (user.is_trusted_vendor !== 1) {
      return res.redirect('/admin/dashboard?error=User is not a trusted vendor');
    }

    // Remove trusted vendor status
    db.run('UPDATE users SET is_trusted_vendor = 0 WHERE id = ?', [userId], function(err) {
      if (err) {
        return res.redirect('/admin/dashboard?error=Failed to remove trusted vendor status');
      }

      // Update vendors table as well
      db.run('UPDATE vendors SET is_trusted = 0 WHERE user_id = ?', [userId], function(err) {
        if (err) {
          console.error('Error updating vendor trusted status:', err);
        }
        res.redirect('/admin/dashboard?success=Trusted vendor status removed successfully');
      });
    });
  });
});

// Dispute Center
router.get('/dispute-center', requireAdmin, (req, res) => {
  // Get all disputed orders with related information
  db.all(`SELECT 
    o.id, 
    COALESCE(o.order_number, 'ORD-' || o.id) as order_number, 
    o.total_price, o.created_at, o.status,
    o.buyer_id, 
    COALESCE(o.buyer_username, u1.username) as buyer_username, 
    COALESCE(o.buyer_displayname, u1.displayname) as buyer_displayname,
    o.vendor_id, 
    COALESCE(o.vendor_username, u2.username) as vendor_username, 
    COALESCE(o.vendor_displayname, u2.displayname) as vendor_displayname,
    p.name as product_name, p.id as product_id
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN users u1 ON o.buyer_id = u1.id
    LEFT JOIN users u2 ON o.vendor_id = u2.id
    WHERE o.status = 'disputed'
    ORDER BY o.created_at DESC`, [], (err, disputes) => {
    if (err) {
      console.error('Error fetching disputes:', err);
      return res.status(500).render('pages/error', { 
        error: 'Database error: ' + err.message,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname
        }
      });
    }

    res.render('pages/admin-dispute-center', { 
      disputes: disputes || [],
      user: {
        id: req.session.userId,
        username: req.session.username,
        displayname: req.session.displayname
      },
      success: req.query.success,
      error: req.query.error
    });
  });
});

// Resolve dispute in favor of buyer
router.post('/dispute-center/:id/resolve-buyer', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const { resolution_notes } = req.body;

  // Update order status to refunded and add resolution notes
  db.run(`UPDATE orders SET 
    status = 'refunded', 
    dispute_resolution = 'buyer_favor',
    resolution_notes = ?,
    resolved_at = ?,
    resolved_by = ?
    WHERE id = ? AND status = 'disputed'`, 
    [resolution_notes || 'Resolved in favor of buyer', new Date().toISOString(), req.session.userId, orderId], 
    function(err) {
      if (err) {
        console.error('Error resolving dispute:', err);
        return res.redirect('/admin/dispute-center?error=Failed to resolve dispute');
      }

      if (this.changes === 0) {
        return res.redirect('/admin/dispute-center?error=Dispute not found or already resolved');
      }

      res.redirect('/admin/dispute-center?success=Dispute resolved in favor of buyer - refund issued');
    }
  );
});

// Resolve dispute in favor of vendor
router.post('/dispute-center/:id/resolve-vendor', requireAdmin, (req, res) => {
  const orderId = req.params.id;
  const { resolution_notes } = req.body;

  // Update order status to completed and add resolution notes
  db.run(`UPDATE orders SET 
    status = 'completed', 
    dispute_resolution = 'vendor_favor',
    resolution_notes = ?,
    resolved_at = ?,
    resolved_by = ?
    WHERE id = ? AND status = 'disputed'`, 
    [resolution_notes || 'Resolved in favor of vendor', new Date().toISOString(), req.session.userId, orderId], 
    function(err) {
      if (err) {
        console.error('Error resolving dispute:', err);
        return res.redirect('/admin/dispute-center?error=Failed to resolve dispute');
      }

      if (this.changes === 0) {
        return res.redirect('/admin/dispute-center?error=Dispute not found or already resolved');
      }

      res.redirect('/admin/dispute-center?success=Dispute resolved in favor of vendor - payment released');
    }
  );
});

module.exports = router;