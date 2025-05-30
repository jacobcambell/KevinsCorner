const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Home page with vendor listings
router.get('/', (req, res) => {
  const productType = req.query.type;
  const category = req.query.category;
  const priceRange = req.query.priceRange;

  let categoryFilter = '';
  let typeFilter = '';
  let priceFilter = '';

  if (category && category !== 'all') {
    categoryFilter = 'AND p.category = ?';
  }

  if (productType && productType !== 'all') {
    typeFilter = 'AND p.product_type = ?';
  }

  if (priceRange && priceRange !== 'all') {
    switch (priceRange) {
      case '0-25':
        priceFilter = 'AND CAST(p.price AS REAL) < 25';
        break;
      case '25-50':
        priceFilter = 'AND CAST(p.price AS REAL) >= 25 AND CAST(p.price AS REAL) <= 50';
        break;
      case '50-100':
        priceFilter = 'AND CAST(p.price AS REAL) >= 50 AND CAST(p.price AS REAL) <= 100';
        break;
      case '100-250':
        priceFilter = 'AND CAST(p.price AS REAL) >= 100 AND CAST(p.price AS REAL) <= 250';
        break;
      case '250-500':
        priceFilter = 'AND CAST(p.price AS REAL) >= 250 AND CAST(p.price AS REAL) <= 500';
        break;
      case '500+':
        priceFilter = 'AND CAST(p.price AS REAL) > 500';
        break;
    }
  }

  let query = `
    SELECT 
      p.*,
      v.business_name as vendor_name,
      v.avatar as vendor_avatar,
      v.country_flag as vendor_country_flag,
      u.displayname as vendor_displayname,
      u.username as vendor_username,
      ROUND(AVG(vf.rating), 1) as vendor_rating,
      COUNT(vf.rating) as rating_count
    FROM products p
    JOIN vendors v ON p.vendor_id = v.id
    JOIN users u ON v.user_id = u.id
    LEFT JOIN vendor_feedback vf ON v.id = vf.vendor_id
    WHERE p.status = 'active' 
    AND v.vacation_mode = 0
    ${categoryFilter}
    ${typeFilter}
    ${priceFilter}
    GROUP BY p.id, v.id
    ORDER BY p.created_at DESC 
    LIMIT 20
  `;

  let params = [];
  if (category && category !== 'all') {
    params.push(category);
  }
  if (productType && productType !== 'all') {
    params.push(productType);
  }

  // Get active vendor products with ratings (excluding vendors in vacation mode)
  db.all(query, params, (err, products) => {
    if (err) {
      console.error('Error fetching vendor products:', err);
      return res.status(500).render('pages/error', { 
        error: 'Failed to fetch products. Please try again later.',
        user: req.session.userId ? {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: req.session.isVendor || false
        } : null
      });
    }

    // Parse image URLs for products
    if (products) {
      products = products.map(product => {
        if (product.image_urls) {
          try {
            product.images = JSON.parse(product.image_urls);
          } catch (e) {
            console.error(`Error parsing image URLs for product ${product.id}:`, e);
            product.images = [];
          }
        } else {
          product.images = [];
        }
        return product;
      });
    }

    res.render('pages/home', {
      products: products || [],
      selectedCategory: category || 'all',
      selectedType: productType || 'all',
      selectedPriceRange: priceRange || 'all',
      error: req.query.error || null,
      success: req.query.success || null,
      user: req.session.userId ? {
        id: req.session.userId,
        username: req.session.username,
        displayname: req.session.displayname,
        isVendor: req.session.isVendor || false
      } : null
    });
  });
});

// Profile page
router.get('/profile', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  db.get('SELECT * FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err) {
      console.error('Error fetching user profile:', err);
      return res.status(500).render('pages/error', { 
        error: 'Database error: ' + err.message,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: false
        }
      });
    }

    if (!user) {
      console.warn(`User with ID ${req.session.userId} not found.`);
      return res.status(404).render('pages/error', {
        error: 'User profile not found.',
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: false
        }
      });
    }

    const userObj = {
      id: req.session.userId,
      username: user.username,
      displayname: user.displayname,
      isVendor: user.is_vendor === 1
    };

    res.render('pages/profile', { 
      user: userObj,
      profileUser: user,
      success: req.query.success,
      error: req.query.error
    });
  });
});

// Get all users (admin only)
router.get('/users', (req, res) => {
  if (req.session.username !== 'admin') {
    return res.redirect('/?error=Unauthorized');
  }

  db.all('SELECT * FROM users ORDER BY created_at DESC', [], (err, users) => {
    if (err) {
      console.error('Error fetching all users (admin):', err);
      return res.status(500).render('pages/error', { error: 'Database error: ' + err.message });
    }

    res.render('pages/users', { 
      users: users,
      user: {
        id: req.session.userId,
        username: req.session.username,
        displayname: req.session.displayname,
        isVendor: false
      }
    });
  });
});

// Update profile settings
router.post('/profile/update-settings', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const { preferredCurrency } = req.body;

  // Validate currency
  const validCurrencies = ['USD', 'GBP', 'CAD', 'EUR', 'AUD'];
  if (!validCurrencies.includes(preferredCurrency)) {
    return res.redirect('/profile?error=Invalid currency selection.');
  }

  db.run(
    'UPDATE users SET preferred_currency = ? WHERE id = ?',
    [preferredCurrency, req.session.userId],
    function(err) {
      if (err) {
        console.error('Error updating profile settings:', err);
        return res.redirect('/profile?error=Failed to update profile settings');
      }

      res.redirect('/profile?success=Profile settings updated successfully');
    }
  );
});

// Update security settings
router.post('/profile/update-security', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const { publicKey, twoFactorEnabled } = req.body;
  const twoFactorValue = twoFactorEnabled === '1' ? 1 : 0;

  // Validate public key format if provided
  if (publicKey && publicKey.trim()) {
    const trimmedKey = publicKey.trim();
    if (!trimmedKey.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----') || 
        !trimmedKey.includes('-----END PGP PUBLIC KEY BLOCK-----')) {
      return res.redirect('/profile?error=Invalid public key format. Please paste a valid Kleopatra/PGP public key.');
    }
  }

  db.run(
    'UPDATE users SET public_key = ?, two_factor_enabled = ? WHERE id = ?',
    [publicKey || null, twoFactorValue, req.session.userId],
    function(err) {
      if (err) {
        console.error('Error updating security settings:', err);
        return res.redirect('/profile?error=Failed to update security settings');
      }

      res.redirect('/profile?success=Security settings updated successfully');
    }
  );
});

// Buyer orders page
router.get('/orders', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  console.log(`Fetching orders for buyer ${req.session.userId}`);

  // Get buyer's orders with product and vendor information - use LEFT JOINs to avoid missing orders
  db.all(`
    SELECT 
      o.*,
      COALESCE(p.name, 'Product #' || o.product_id) as product_name,
      COALESCE(p.product_type, 'unknown') as product_type,
      COALESCE(p.description, '') as product_description,
      COALESCE(v.business_name, 'Unknown Vendor') as vendor_name,
      COALESCE(u.displayname, 'Unknown Vendor') as vendor_displayname,
      dpd.content_type,
      dpd.download_url,
      dpd.download_password,
      dpd.account_username,
      dpd.account_password,
      dpd.account_email,
      dpd.additional_info,
      dpd.instructions
    FROM orders o
    LEFT JOIN products p ON o.product_id = p.id
    LEFT JOIN vendors v ON o.vendor_id = v.id
    LEFT JOIN users u ON v.user_id = u.id
    LEFT JOIN digital_product_details dpd ON p.id = dpd.product_id
    WHERE o.buyer_id = ?
    ORDER BY o.created_at DESC
  `, [req.session.userId], (err, orders) => {
    if (err) {
      console.error('Error fetching buyer orders:', err);
      return res.render('pages/buyer-orders', { 
        orders: [],
        error: 'Failed to load orders: ' + err.message,
        success: null,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: false
        },
        unreadMessageCount: req.unreadMessageCount || 0,
        pendingVendorOrders: req.pendingVendorOrders || 0,
        orderUpdates: 0
      });
    }

    console.log(`Found ${orders ? orders.length : 0} orders for user ${req.session.userId}`);

    // Ensure orders is always an array
    const ordersList = orders || [];

    // Log the orders for debugging
    if (ordersList.length > 0) {
      console.log('Orders found:', ordersList.map(o => ({ id: o.id, status: o.status, product_name: o.product_name })));
    } else {
      console.log('No orders found for user', req.session.userId);
    }

    // Orders are fetched without any automatic timestamp updates

    // Render orders page with the fetched orders
    res.render('pages/buyer-orders', { 
      orders: ordersList,
      error: req.query.error,
      success: req.query.success,
      user: {
        id: req.session.userId,
        username: req.session.username,
        displayname: req.session.displayname,
        isVendor: false
      },
      unreadMessageCount: req.unreadMessageCount || 0,
      pendingVendorOrders: req.pendingVendorOrders || 0,
      orderUpdates: req.orderUpdates || 0
    });
  });
});

// Mark order notifications as read
router.post('/orders/mark-read', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Update last_viewed_at for all orders for this buyer
  db.run(`
    UPDATE orders 
    SET last_viewed_at = ? 
    WHERE buyer_id = ?
  `, [new Date().toISOString(), req.session.userId], function(err) {
    if (err) {
      console.error('Error marking orders as read:', err);
      return res.redirect('/orders?error=Failed to mark notifications as read');
    }

    res.redirect('/orders?success=Order notifications marked as read');
  });
});

// Mark order as received
router.post('/orders/:id/received', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const orderId = req.params.id;

  // Check if user owns this order and it's shipped
  db.get(`
    SELECT o.*, p.name as product_name, v.business_name as vendor_name
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN vendors v ON o.vendor_id = v.id
    WHERE o.id = ? AND o.buyer_id = ? AND o.status = 'shipped'
  `, [orderId, req.session.userId], (err, order) => {
    if (err) {
      console.error('Error fetching order for received confirmation:', err);
      return res.redirect('/orders?error=Order not found');
    }
    if (!order) {
      console.warn(`Order ${orderId} not found or not shipped for user ${req.session.userId}`);
      return res.redirect('/orders?error=Order not found or not yet shipped');
    }

    // Update order status to received and then completed
    db.run(`UPDATE orders SET status = 'received', received_at = ? WHERE id = ?`, 
      [new Date().toISOString(), orderId], function(err) {
      if (err) {
        console.error('Error marking order as received:', err);
        return res.redirect('/orders?error=Failed to mark order as received');
      }

      // Immediately mark as completed since buyer confirmed receipt
      db.run(`UPDATE orders SET status = 'completed', completed_at = ? WHERE id = ?`, 
        [new Date().toISOString(), orderId], function(err) {
        if (err) {
          console.error('Error marking order as completed:', err);
          return res.redirect('/orders?success=Order marked as received but completion failed');
        }

        // Redirect to feedback page instead of back to orders
        res.redirect(`/orders/${orderId}/feedback?success=Order marked as received! Please leave feedback for the vendor.`);
      });
    });
  });
});

// Dispute an order
router.post('/orders/:id/dispute', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const orderId = req.params.id;
  const { dispute_reason, dispute_details } = req.body;

  // Verify order belongs to user and can be disputed (only shipped orders, not received/completed)
  db.get(`SELECT * FROM orders WHERE id = ? AND buyer_id = ? AND status = 'shipped'`, 
    [orderId, req.session.userId], (err, order) => {
    if (err) {
      console.error('Error fetching order for dispute:', err);
      return res.redirect('/orders?error=Order not found or cannot be disputed');
    }
    if (!order) {
      console.warn(`Order ${orderId} not found or cannot be disputed by user ${req.session.userId}`);
      return res.redirect('/orders?error=Order not found or disputes can only be opened on shipped orders before marking as received');
    }

    // Prepare dispute reason text
    let fullDisputeReason = dispute_reason || 'other';
    if (dispute_details && dispute_details.trim()) {
      fullDisputeReason += ': ' + dispute_details.trim();
    }

    // Update order status to disputed and pause timers by clearing deadlines
    db.run(`UPDATE orders SET 
      status = 'disputed', 
      disputed_at = ?, 
      dispute_reason = ?,
      buyer_dispute_deadline = NULL
      WHERE id = ?`, 
      [new Date().toISOString(), fullDisputeReason, orderId], function(err) {
      if (err) {
        console.error('Error disputing order:', err);
        return res.redirect('/orders?error=Failed to dispute order');
      }

      console.log(`Order ${orderId} disputed by buyer ${req.session.userId}. Timers paused.`);
      res.redirect('/orders?success=Dispute opened successfully. All timers have been paused and the case has been sent to admin review.');
    });
  });
});

// Show feedback form
router.get('/orders/:id/feedback', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const orderId = req.params.id;

  // Get order details with vendor info
  db.get(`
    SELECT 
      o.*,
      p.name as product_name,
      v.business_name as vendor_name,
      u.displayname as vendor_displayname
    FROM orders o
    JOIN products p ON o.product_id = p.id
    JOIN vendors v ON o.vendor_id = v.id
    JOIN users u ON v.user_id = u.id
    WHERE o.id = ? AND o.buyer_id = ? AND o.status IN ('received', 'completed')
  `, [orderId, req.session.userId], (err, order) => {
    if (err) {
      console.error('Error fetching order details for feedback:', err);
      return res.redirect('/orders?error=Order not found or feedback not available');
    }
    if (!order) {
      console.warn(`Order ${orderId} not found or feedback is not available for user ${req.session.userId}`);
      return res.redirect('/orders?error=Order not found or feedback not available');
    }

    // Check if feedback already given
    db.get('SELECT id FROM vendor_feedback WHERE order_id = ?', [orderId], (err, feedback) => {
      if (err) {
        console.error('Error checking existing feedback:', err);
        return res.redirect('/orders?error=Failed to check existing feedback');
      }
      if (feedback) {
        return res.redirect('/orders?error=Feedback already submitted for this order');
      }

      res.render('pages/vendor-feedback', {
        order: order,
        error: req.query.error,
        success: req.query.success,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: false
        }
      });
    });
  });
});

// Submit feedback
router.post('/orders/:id/feedback', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const orderId = req.params.id;
  const { rating, feedback } = req.body;

  if (!rating || rating < 1 || rating > 5) {
    return res.redirect(`/orders/${orderId}/feedback?error=Please provide a rating between 1 and 5 stars`);
  }

  // Verify order belongs to user and is received or completed
  db.get(`SELECT * FROM orders WHERE id = ? AND buyer_id = ? AND status IN ('received', 'completed')`, 
    [orderId, req.session.userId], (err, order) => {
    if (err) {
      console.error('Error fetching order to submit feedback:', err);
      return res.redirect('/orders?error=Order not found or feedback not available');
    }
    if (!order) {
      console.warn(`Order ${orderId} not found or feedback cannot be submitted for user ${req.session.userId}`);
      return res.redirect('/orders?error=Order not found or feedback not available');
    }

    // Check if feedback already exists
    db.get('SELECT id FROM vendor_feedback WHERE order_id = ?', [orderId], (err, existingFeedback) => {
      if (err) {
        console.error('Error checking for existing feedback:', err);
        return res.redirect('/orders?error=Failed to check for existing feedback');
      }
      if (existingFeedback) {
        return res.redirect('/orders?error=Feedback already submitted for this order');
      }

      // Insert feedback
      db.run(`INSERT INTO vendor_feedback 
        (order_id, vendor_id, buyer_id, rating, feedback_text, created_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, order.vendor_id, req.session.userId, parseInt(rating), feedback || null, new Date().toISOString()],
        function(err) {
          if (err) {
            console.error('Error submitting feedback:', err);
            return res.redirect(`/orders/${orderId}/feedback?error=Failed to submit feedback`);
          }

          // Mark order as feedback given
          db.run('UPDATE orders SET feedback_given = 1 WHERE id = ?', [orderId], (err) => {
            if (err) {
              console.error('Error updating feedback flag:', err);
            }
            res.redirect('/orders?success=Thank you for your feedback!');
          });
        }
      );
    });
  });
});

module.exports = router;