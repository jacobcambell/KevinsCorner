const express = require('express');
const router = express.Router();
const db = require('../database/db');
const imageProcessor = require('../utils/imageProcessor');
const multer = require('multer');

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
    files: 5 // Max 5 files
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Testing route to make current user a vendor
router.post('/make-vendor', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Update user to be a vendor
  db.run('UPDATE users SET is_vendor = 1 WHERE id = ?', [req.session.userId], function(err) {
    if (err) {
      console.error('Error making user a vendor:', err);
      return res.redirect('/?error=vendor-update-failed');
    }

    // Insert into vendors table
    db.run('INSERT OR IGNORE INTO vendors (user_id, business_name, business_description) VALUES (?, ?, ?)', 
      [req.session.userId, req.session.displayname + "'s Store", "Test vendor store"], 
      function(err) {
        if (err) {
          console.error('Error creating vendor record:', err);
        }
        res.redirect('/?success=vendor-activated');
      }
    );
  });
});

// Vendor application page
router.get('/apply', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login?redirect=/vendor/apply');
  }

  res.render('pages/vendor-apply', { 
    error: req.query.error,
    success: req.query.success,
    user: {
      id: req.session.userId,
      username: req.session.username,
      displayname: req.session.displayname,
      isVendor: req.session.isVendor || false
    }
  });
});

// Handle invite code application
router.post('/apply-with-invite', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login?redirect=/vendor/apply');
  }

  const { inviteCode } = req.body;

  if (!inviteCode) {
    return res.redirect('/vendor/apply?error=Please enter an invite code');
  }

  // Check if invite code is valid and unused
  db.get('SELECT * FROM vendor_invite_codes WHERE code = ? AND is_used = 0', [inviteCode], (err, invite) => {
    if (err) {
      console.error('Error checking invite code:', err);
      return res.redirect('/vendor/apply?error=Failed to validate invite code');
    }

    if (!invite) {
      return res.redirect('/vendor/apply?error=Invalid or already used invite code');
    }

    // Check if user is already a vendor
    db.get('SELECT is_vendor FROM users WHERE id = ?', [req.session.userId], (err, user) => {
      if (err || !user) {
        return res.redirect('/vendor/apply?error=User not found');
      }

      if (user.is_vendor === 1) {
        return res.redirect('/vendor/apply?error=You are already a vendor');
      }

      // Mark invite code as used
      db.run('UPDATE vendor_invite_codes SET is_used = 1, used_by = ?, used_at = ? WHERE id = ?', 
        [req.session.userId, new Date().toISOString(), invite.id], (err) => {
        if (err) {
          console.error('Error updating invite code:', err);
          return res.redirect('/vendor/apply?error=Failed to process invite code');
        }

        // Make user a vendor
        db.run('UPDATE users SET is_vendor = 1 WHERE id = ?', [req.session.userId], (err) => {
          if (err) {
            console.error('Error making user a vendor:', err);
            return res.redirect('/vendor/apply?error=Failed to activate vendor status');
          }

          // Insert into vendors table
          db.run('INSERT INTO vendors (user_id, business_name, business_description, vendor_type) VALUES (?, ?, ?, ?)', 
            [req.session.userId, req.session.displayname + "'s Store", "Vendor activated with invite code", "full"], 
            (err) => {
            if (err) {
              console.error('Error creating vendor record:', err);
            }

            // Update session
            req.session.isVendor = true;
            res.redirect('/vendor/profile?success=Congratulations! Your vendor account has been activated');
          });
        });
      });
    });
  });
});

// Create digital vendor application order
router.post('/create-digital-vendor-order', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login?redirect=/vendor/apply');
  }

  // Check if user is already a vendor
  db.get('SELECT is_vendor FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err || !user) {
      return res.redirect('/vendor/apply?error=User not found');
    }

    if (user.is_vendor === 1) {
      return res.redirect('/vendor/apply?error=You are already a vendor');
    }

    // Create a special digital vendor application order
    const digitalVendorProduct = {
      id: 'digital-vendor-fee',
      name: 'Digital Products Vendor License',
      description: 'License to sell digital products only on Kevin\'s Corner Marketplace',
      price: 50,
      currency: 'USD'
    };

    // Set auto-decline date to 1 week from now
    const autoDeclineDate = new Date();
    autoDeclineDate.setDate(autoDeclineDate.getDate() + 7);

    // Create special digital vendor fee order (vendor_id = 1 for system orders)
    db.run(`
      INSERT INTO orders (
        buyer_id, vendor_id, product_id, quantity, 
        unit_price, total_price, currency, payment_method,
        status, auto_decline_at, created_at, special_instructions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.session.userId,
      1, // System vendor ID
      'digital-vendor-fee',
      1,
      50,
      50,
      'USD',
      'XMR',
      'pending',
      autoDeclineDate.toISOString(),
      new Date().toISOString(),
      'DIGITAL_VENDOR_APPLICATION_FEE'
    ], function(err) {
      if (err) {
        console.error('Error creating digital vendor fee order:', err);
        return res.redirect('/vendor/apply?error=Failed to create digital vendor application order');
      }

      // Redirect to a special vendor fee order page
      res.redirect(`/vendor-fee-order/${this.lastID}`);
    });
  });
});

// Create paid vendor application order
router.post('/create-paid-order', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login?redirect=/vendor/apply');
  }

  // Check if user is already a vendor
  db.get('SELECT is_vendor FROM users WHERE id = ?', [req.session.userId], (err, user) => {
    if (err || !user) {
      return res.redirect('/vendor/apply?error=User not found');
    }

    if (user.is_vendor === 1) {
      return res.redirect('/vendor/apply?error=You are already a vendor');
    }

    // Create a special vendor application order
    const vendorFeeProduct = {
      id: 'vendor-fee',
      name: 'Vendor Application Fee',
      description: 'One-time fee to become a vendor on Kevin\'s Corner Marketplace',
      price: 300,
      currency: 'USD'
    };

    // Set auto-decline date to 1 week from now
    const autoDeclineDate = new Date();
    autoDeclineDate.setDate(autoDeclineDate.getDate() + 7);

    // Create special vendor fee order (vendor_id = 1 for system orders)
    db.run(`
      INSERT INTO orders (
        buyer_id, vendor_id, product_id, quantity, 
        unit_price, total_price, currency, payment_method,
        status, auto_decline_at, created_at, special_instructions
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      req.session.userId,
      1, // System vendor ID
      'vendor-fee',
      1,
      300,
      300,
      'USD',
      'XMR',
      'pending',
      autoDeclineDate.toISOString(),
      new Date().toISOString(),
      'VENDOR_APPLICATION_FEE'
    ], function(err) {
      if (err) {
        console.error('Error creating vendor fee order:', err);
        return res.redirect('/vendor/apply?error=Failed to create vendor application order');
      }

      // Redirect to a special vendor fee order page
      res.redirect(`/vendor-fee-order/${this.lastID}`);
    });
  });
});

// Create SEO service order
router.post('/create-seo-order', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login?redirect=/vendor/apply');
  }

  // Set auto-decline date to 1 week from now
  const autoDeclineDate = new Date();
  autoDeclineDate.setDate(autoDeclineDate.getDate() + 7);

  // Create SEO service order
  db.run(`
    INSERT INTO orders (
      buyer_id, vendor_id, product_id, quantity, 
      unit_price, total_price, currency, payment_method,
      status, auto_decline_at, created_at, special_instructions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    req.session.userId,
    1, // System vendor ID
    'seo-service',
    1,
    25,
    25,
    'USD',
    'XMR',
    'pending',
    autoDeclineDate.toISOString(),
    new Date().toISOString(),
    'SEO_WEBSITE_SUBMISSION_SERVICE'
  ], function(err) {
    if (err) {
      console.error('Error creating SEO service order:', err);
      return res.redirect('/vendor/apply?error=Failed to create SEO service order');
    }

    res.redirect(`/vendor-fee-order/${this.lastID}`);
  });
});

// Create forum banner ad order
router.post('/create-banner-order', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login?redirect=/vendor/apply');
  }

  // Set auto-decline date to 1 week from now
  const autoDeclineDate = new Date();
  autoDeclineDate.setDate(autoDeclineDate.getDate() + 7);

  // Create forum banner ad order
  db.run(`
    INSERT INTO orders (
      buyer_id, vendor_id, product_id, quantity, 
      unit_price, total_price, currency, payment_method,
      status, auto_decline_at, created_at, special_instructions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    req.session.userId,
    1, // System vendor ID
    'forum-banner-ad',
    1,
    100,
    100,
    'USD',
    'XMR',
    'pending',
    autoDeclineDate.toISOString(),
    new Date().toISOString(),
    'FORUM_BANNER_AD_MONTHLY'
  ], function(err) {
    if (err) {
      console.error('Error creating forum banner ad order:', err);
      return res.redirect('/vendor/apply?error=Failed to create forum banner ad order');
    }

    res.redirect(`/vendor-fee-order/${this.lastID}`);
  });
});

// Create single vendor store order
router.post('/create-store-order', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login?redirect=/vendor/apply');
  }

  // Set auto-decline date to 1 week from now
  const autoDeclineDate = new Date();
  autoDeclineDate.setDate(autoDeclineDate.getDate() + 7);

  // Create single vendor store order
  db.run(`
    INSERT INTO orders (
      buyer_id, vendor_id, product_id, quantity, 
      unit_price, total_price, currency, payment_method,
      status, auto_decline_at, created_at, special_instructions
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    req.session.userId,
    1, // System vendor ID
    'single-vendor-store',
    1,
    25,
    25,
    'USD',
    'XMR',
    'pending',
    autoDeclineDate.toISOString(),
    new Date().toISOString(),
    'SINGLE_VENDOR_STORE_MONTHLY'
  ], function(err) {
    if (err) {
      console.error('Error creating single vendor store order:', err);
      return res.redirect('/vendor/apply?error=Failed to create single vendor store order');
    }

    res.redirect(`/vendor-fee-order/${this.lastID}`);
  });
});

// Handle vendor application submission
router.post('/apply', (req, res) => {
  const {
    businessName,
    contactName,
    email,
    phone,
    businessAddress,
    businessType,
    yearsInBusiness,
    productCategories,
    businessDescription,
    website,
    socialMedia,
    agreeTerms,
    agreeMarketing
  } = req.body;

  // Validation
  if (!businessName || !contactName || !email || !phone || !businessAddress || 
      !businessType || !productCategories || !businessDescription || !agreeTerms) {
    return res.render('pages/vendor-apply', { 
      error: 'Please fill in all required fields and agree to terms and conditions',
      success: null 
    });
  }

  // Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.render('pages/vendor-apply', { 
      error: 'Please enter a valid email address',
      success: null 
    });
  }

  // Insert vendor application into database
  db.run(`INSERT INTO vendor_applications (
    business_name, contact_name, email, phone, business_address, 
    business_type, years_in_business, product_categories, 
    business_description, website, social_media, agree_marketing, 
    status, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
  [
    businessName, contactName, email, phone, businessAddress,
    businessType, yearsInBusiness || null, productCategories,
    businessDescription, website || null, socialMedia || null,
    agreeMarketing ? 1 : 0, 'pending', new Date().toISOString()
  ], 
  function(err) {
    if (err) {
      console.error('Error submitting vendor application:', err);
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.render('pages/vendor-apply', { 
          error: 'An application with this email already exists',
          success: null 
        });
      }
      return res.render('pages/vendor-apply', { 
        error: 'Failed to submit application. Please try again.',
        success: null 
      });
    }

    res.render('pages/vendor-apply', { 
      error: null,
      success: 'Your vendor application has been submitted successfully! We will review it and get back to you within 3-5 business days.' 
    });
  });
});

// Vendor dashboard with analytics
router.get('/dashboard', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor and get vendor info
  db.get('SELECT * FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=not-vendor');
    }

    // Get dashboard analytics data
    const analytics = {};

    // Get total sales and revenue
    db.get(`
      SELECT 
        COUNT(*) as total_orders,
        SUM(CASE WHEN status IN ('completed', 'received') THEN total_price ELSE 0 END) as total_revenue,
        SUM(CASE WHEN status = 'pending' THEN total_price ELSE 0 END) as pending_revenue,
        COUNT(CASE WHEN status = 'pending' THEN 1 END) as pending_orders,
        COUNT(CASE WHEN status IN ('completed', 'received') THEN 1 END) as completed_orders
      FROM orders 
      WHERE vendor_id = ?
    `, [vendor.id], (err, salesData) => {
      if (err) {
        console.error('Error fetching sales data:', err);
        salesData = { total_orders: 0, total_revenue: 0, pending_revenue: 0, pending_orders: 0, completed_orders: 0 };
      }
      analytics.sales = salesData;

      // Get monthly sales data for chart (last 12 months)
      db.all(`
        SELECT 
          strftime('%Y-%m', created_at) as month,
          COUNT(*) as order_count,
          SUM(total_price) as revenue
        FROM orders 
        WHERE vendor_id = ? AND status IN ('completed', 'received')
        AND created_at >= date('now', '-12 months')
        GROUP BY strftime('%Y-%m', created_at)
        ORDER BY month DESC
      `, [vendor.id], (err, monthlyData) => {
        if (err) {
          console.error('Error fetching monthly data:', err);
          monthlyData = [];
        }
        analytics.monthly = monthlyData;

        // Get product performance
        db.all(`
          SELECT 
            p.name,
            p.id,
            COUNT(o.id) as sales_count,
            SUM(o.total_price) as total_sales,
            p.stock_quantity,
            p.price
          FROM products p
          LEFT JOIN orders o ON p.id = o.product_id AND o.status IN ('completed', 'received')
          WHERE p.vendor_id = ?
          GROUP BY p.id
          ORDER BY sales_count DESC
          LIMIT 10
        `, [vendor.id], (err, productData) => {
          if (err) {
            console.error('Error fetching product data:', err);
            productData = [];
          }
          analytics.products = productData;

          // Get recent activity
          db.all(`
            SELECT 
              o.*,
              p.name as product_name,
              u.displayname as buyer_name
            FROM orders o
            LEFT JOIN products p ON o.product_id = p.id
            LEFT JOIN users u ON o.buyer_id = u.id
            WHERE o.vendor_id = ?
            ORDER BY o.created_at DESC
            LIMIT 10
          `, [vendor.id], (err, recentOrders) => {
            if (err) {
              console.error('Error fetching recent orders:', err);
              recentOrders = [];
            }
            analytics.recent = recentOrders;

            // Get vendor rating
            db.get(`
              SELECT 
                ROUND(AVG(rating), 1) as avg_rating,
                COUNT(*) as rating_count
              FROM vendor_feedback 
              WHERE vendor_id = ?
            `, [vendor.id], (err, ratingData) => {
              if (err) {
                console.error('Error fetching rating data:', err);
                ratingData = { avg_rating: 0, rating_count: 0 };
              }
              analytics.rating = ratingData;

              // Get product count
              db.get(`
                SELECT 
                  COUNT(*) as total_products,
                  COUNT(CASE WHEN status = 'active' THEN 1 END) as active_products,
                  COUNT(CASE WHEN product_type = 'digital' THEN 1 END) as digital_products
                FROM products 
                WHERE vendor_id = ?
              `, [vendor.id], (err, productStats) => {
                if (err) {
                  console.error('Error fetching product stats:', err);
                  productStats = { total_products: 0, active_products: 0, digital_products: 0 };
                }
                analytics.productStats = productStats;

                res.render('pages/vendor-dashboard', {
                  vendor: vendor,
                  analytics: analytics,
                  error: req.query.error,
                  success: req.query.success,
                  user: {
                    id: req.session.userId,
                    username: req.session.username,
                    displayname: req.session.displayname,
                    isVendor: true
                  }
                });
              });
            });
          });
        });
      });
    });
  });
});

// Products management page
router.get('/products', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor and get vendor info
  db.get('SELECT * FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=not-vendor');
    }

    // Get vendor's products
    db.all(`SELECT * FROM products WHERE vendor_id = ? ORDER BY created_at DESC`, [vendor.id], (err, products) => {
      if (err) {
        console.error('Error fetching products:', err);
        return res.render('pages/vendor-products', { 
          products: [],
          vendor: vendor,
          error: 'Failed to load products',
          success: null,
          user: {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname,
            isVendor: true
          }
        });
      }

      res.render('pages/vendor-products', { 
        products: products || [],
        vendor: vendor,
        error: req.query.error,
        success: req.query.success,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: true
        }
      });
    });
  });
});

// Add product page
router.get('/add-product', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=not-vendor');
    }

    const productType = req.query.type;
    if (!productType || !['physical', 'digital'].includes(productType)) {
      return res.render('pages/vendor-product-type', {
        error: req.query.error,
        success: null,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: true
        }
      });
    }

    res.render('pages/vendor-add-product', {
      productType: productType,
      error: req.query.error,
      success: null,
      user: {
        id: req.session.userId,
        username: req.session.username,
        displayname: req.session.displayname,
        isVendor: true
      }
    });
  });
});

// Handle adding new product
router.post('/add-product', upload.array('imageFiles', 5), (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=not-vendor');
    }

    const {
      productType,
      name,
      description,
      price,
      currency,
      category,
      stockQuantity,
      shippingWeight,
      shippingDimensions,
      status,
      // Digital content fields
      contentType,
      downloadUrl,
      downloadPassword,
      downloadLimit,
      accountUsername,
      accountPassword,
      accountEmail,
      textContent,
      instructions,
      additionalInfo,
      // Image fields
      productImages
    } = req.body;

    // Basic validation
    if (!productType || !name || !description || !price || !category) {
      return res.redirect(`/vendor/add-product?type=${productType}&error=Please fill in all required fields`);
    }

    // Type-specific validation
    if (productType === 'physical' && (!stockQuantity || stockQuantity < 0)) {
      return res.redirect(`/vendor/add-product?type=${productType}&error=Stock quantity is required for physical products`);
    }

    if (productType === 'digital') {
      if (!contentType) {
        return res.redirect(`/vendor/add-product?type=${productType}&error=Content type is required for digital products`);
      }

      if (contentType === 'download_link' && (!downloadUrl || !downloadPassword)) {
        return res.redirect(`/vendor/add-product?type=${productType}&error=Download URL and password are required`);
      }

      if (contentType === 'account_info' && (!accountUsername || !accountPassword)) {
        return res.redirect(`/vendor/add-product?type=${productType}&error=Account username and password are required`);
      }

      if (contentType === 'text_content' && !textContent) {
        return res.redirect(`/vendor/add-product?type=${productType}&error=Text content is required`);
      }
    }

    const shippingRequired = productType === 'physical' ? 1 : 0;

    // Insert main product first to get product ID
    db.run(`INSERT INTO products (
      vendor_id, product_type, name, description, price, currency, category,
      stock_quantity, shipping_weight, shipping_dimensions, shipping_required, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      vendor.id, productType, name, description, parseFloat(price), currency || 'USD',
      category, productType === 'physical' ? parseInt(stockQuantity) : 0,
      productType === 'physical' ? (shippingWeight || null) : null,
      productType === 'physical' ? (shippingDimensions || null) : null,
      shippingRequired, status || 'active'
    ], function(err) {
      if (err) {
        console.error('Error adding product:', err);
        return res.redirect(`/vendor/add-product?type=${productType}&error=Failed to add product`);
      }

      const productId = this.lastID;

      // Process images if provided - handle both file uploads and base64
      const processImagesAndComplete = async () => {
        let validImages = [];

        // Process uploaded files (when JS is disabled)
        if (req.files && req.files.length > 0) {
          for (const file of req.files) {
            try {
              // Convert buffer to base64
              const base64Image = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

              // Validate and resize if needed
              const resizedImg = await imageProcessor.validateAndResizeBase64Image(base64Image);
              if (resizedImg) {
                validImages.push(resizedImg);
              }
            } catch (error) {
              console.error('Error processing uploaded file:', error);
            }
          }
        }

        // Process base64 images (when JS is enabled)
        if (productImages) {
          // Handle both array and single values
          const imageArray = Array.isArray(productImages) ? productImages : [productImages];

          for (const img of imageArray) {
            if (img && img.trim()) {
              // Validate base64 image format
              if (imageProcessor.validateBase64Image(img)) {
                // Resize if too large but keep as base64
                const resizedImg = await imageProcessor.validateAndResizeBase64Image(img);
                if (resizedImg) {
                  validImages.push(resizedImg);
                }
              }
            }
          }
        }

        // Update product with images (stored as base64)
        if (validImages.length > 0) {
          db.run('UPDATE products SET image_urls = ? WHERE id = ?', 
            [JSON.stringify(validImages), productId], (err) => {
            if (err) {
              console.error('Error updating product images:', err);
            }
          });
        }

        return validImages;
      };

      // If digital product, insert digital content details
      if (productType === 'digital') {
        db.run(`INSERT INTO digital_product_details (
          product_id, content_type, download_url, download_password,
          account_username, account_password, account_email,
          additional_info, instructions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          productId, contentType,
          contentType === 'download_link' ? downloadUrl : null,
          contentType === 'download_link' ? downloadPassword : null,
          contentType === 'account_info' ? accountUsername : null,
          contentType === 'account_info' ? accountPassword : null,
          contentType === 'account_info' ? accountEmail : null,
          contentType === 'text_content' ? textContent : (additionalInfo || null),
          instructions || null
        ], async function(err) {
          if (err) {
            console.error('Error adding digital product details:', err);
            // Rollback product creation
            db.run('DELETE FROM products WHERE id = ?', [productId]);
            return res.redirect(`/vendor/add-product?type=${productType}&error=Failed to save digital content details`);
          }

          // Process images
          await processImagesAndComplete();
          res.redirect('/vendor/products?success=Digital product added successfully');
        });
      } else {
        // Process images for physical products
        processImagesAndComplete().then(() => {
          res.redirect('/vendor/products?success=Product added successfully');
        }).catch((error) => {
          console.error('Error in image processing:', error);
          res.redirect('/vendor/products?success=Product added successfully (images may have failed)');
        });
      }
    });
  });
});

// Vendor profile page
router.get('/profile', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor and get vendor info
  db.get('SELECT * FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=not-vendor');
    }

    // Get user's last login
    db.get('SELECT last_login FROM users WHERE id = ?', [req.session.userId], (err, userData) => {
      res.render('pages/vendor-profile', { 
        vendor: vendor,
        error: req.query.error,
        success: req.query.success,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: true,
          lastLogin: userData ? userData.last_login : null
        }
      });
    });
  });
});

// Handle vendor profile update
router.post('/profile/update', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const {
    businessName,
    businessDescription,
    countryFlag,
    shippingFrom,
    shippingTo,
    vacationMode,
    avatarBase64
  } = req.body;

  // Validation
  if (!businessName || !businessDescription) {
    return res.redirect('/vendor/profile?error=Business name and description are required');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=not-vendor');
    }

    // Update vendor profile
    db.run(`UPDATE vendors SET 
      business_name = ?, 
      business_description = ?, 
      country_flag = ?,
      shipping_from = ?, 
      shipping_to = ?, 
      vacation_mode = ?,
      avatar = ?
      WHERE user_id = ?`,
    [
      businessName,
      businessDescription,
      countryFlag || null,
      shippingFrom || null,
      shippingTo || null,
      vacationMode ? 1 : 0,
      avatarBase64 || null,
      req.session.userId
    ], function(err) {
      if (err) {
        console.error('Error updating vendor profile:', err);
        return res.redirect('/vendor/profile?error=Failed to update profile');
      }

      res.redirect('/vendor/profile?success=Profile updated successfully');
    });
  });
});

// Vendor orders page
router.get('/orders', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=Access denied - vendor account required');
    }

    console.log(`Fetching orders for vendor ${vendor.id} (user ${req.session.userId})`);

    // Get vendor's orders with product and digital content information
    db.all(`
      SELECT 
        o.*,
        COALESCE(p.name, 'Product #' || o.product_id) as product_name,
        COALESCE(p.product_type, 'unknown') as product_type,
        COALESCE(p.description, '') as product_description,
        COALESCE(u.displayname, 'Unknown User') as buyer_displayname,
        COALESCE(u.username, 'unknown') as buyer_username,
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
      LEFT JOIN users u ON o.buyer_id = u.id
      LEFT JOIN digital_product_details dpd ON p.id = dpd.product_id
      WHERE o.vendor_id = ?
      ORDER BY o.created_at DESC
    `, [vendor.id], (err, orders) => {
      if (err) {
        console.error('Error fetching vendor orders:', err);
        console.error('Vendor ID:', vendor.id);
        console.error('Full error details:', err.message);
        return res.render('pages/vendor-orders', { 
          orders: [],
          error: 'Failed to load orders: ' + err.message,
          success: null,
          user: {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname,
            isVendor: true
          },
          unreadMessageCount: req.unreadMessageCount || 0,
          pendingVendorOrders: 0,
          orderUpdates: req.orderUpdates || 0
        });
      }

      console.log(`Found ${orders ? orders.length : 0} orders for vendor ${vendor.id}`);
      
      // Ensure orders is always an array
      const ordersList = orders || [];
      
      // Log the orders for debugging
      if (ordersList.length > 0) {
        console.log('Vendor orders found:', ordersList.map(o => ({ id: o.id, status: o.status, product_name: o.product_name, buyer: o.buyer_displayname })));
      } else {
        console.log('No orders found for vendor', vendor.id);
      }

      // Orders are fetched without any automatic timestamp updates
      
      // Render orders page with the fetched orders
      res.render('pages/vendor-orders', { 
        orders: ordersList,
        error: req.query.error,
        success: req.query.success,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: true
        },
        unreadMessageCount: req.unreadMessageCount || 0,
        pendingVendorOrders: req.pendingVendorOrders || 0,
        orderUpdates: req.orderUpdates || 0
      });
    });
  });
});

// Vendor wallet page
router.get('/wallet', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=Access denied - vendor account required');
    }

    // Calculate vendor balances and get transactions
    db.all(`
      SELECT 
        o.id as order_id,
        o.total_price,
        o.status,
        o.completed_at,
        o.created_at,
        p.name as product_name
      FROM orders o
      LEFT JOIN products p ON o.product_id = p.id
      WHERE o.vendor_id = ? AND o.status IN ('completed', 'received')
      ORDER BY o.completed_at DESC
    `, [vendor.id], (err, completedOrders) => {
      if (err) {
        console.error('Error fetching completed orders:', err);
        completedOrders = [];
      }

      // Calculate balances
      let totalEarned = 0;
      let availableBalance = 0;
      const transactions = [];

      if (completedOrders) {
        completedOrders.forEach(order => {
          const amount = parseFloat(order.total_price);
          totalEarned += amount;
          
          // For now, make all completed orders available immediately
          // In a real system, you might have a holding period
          availableBalance += amount;

          // Add to transactions list
          transactions.push({
            type: 'sale',
            description: `Sale: ${order.product_name || 'Product #' + order.order_id}`,
            amount: amount,
            order_id: order.order_id,
            created_at: order.completed_at || order.created_at
          });
        });
      }

      // Get pending orders (not yet completed)
      db.all(`
        SELECT 
          o.total_price,
          o.status,
          o.created_at,
          p.name as product_name
        FROM orders o
        LEFT JOIN products p ON o.product_id = p.id
        WHERE o.vendor_id = ? AND o.status IN ('pending', 'accepted', 'shipped')
      `, [vendor.id], (err, pendingOrders) => {
        if (err) {
          console.error('Error fetching pending orders:', err);
          pendingOrders = [];
        }

        let pendingBalance = 0;
        if (pendingOrders) {
          pendingOrders.forEach(order => {
            pendingBalance += parseFloat(order.total_price);
          });
        }

        // TODO: Get actual payout history from a wallet_transactions table
        // For now, we'll use mock data or empty array

        res.render('pages/vendor-wallet', {
          availableBalance: availableBalance,
          pendingBalance: pendingBalance,
          totalEarned: totalEarned,
          transactions: transactions.slice(0, 10), // Show last 10 transactions
          error: req.query.error,
          success: req.query.success,
          user: {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname,
            isVendor: true
          }
        });
      });
    });
  });
});

// Handle payout request
router.post('/wallet/request-payout', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const { payoutAmount, payoutMethod, payoutAddress } = req.body;

  // Validation
  if (!payoutAmount || !payoutMethod || !payoutAddress) {
    return res.redirect('/vendor/wallet?error=Please fill in all payout fields');
  }

  const amount = parseFloat(payoutAmount);
  if (isNaN(amount) || amount < 10) {
    return res.redirect('/vendor/wallet?error=Minimum payout amount is $10.00');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=Access denied - vendor account required');
    }

    // TODO: Implement actual payout request logic
    // This would typically:
    // 1. Verify available balance
    // 2. Create a payout request record
    // 3. Deduct from available balance
    // 4. Queue for admin approval/processing

    console.log('Payout request received:', {
      vendorId: vendor.id,
      userId: req.session.userId,
      amount: amount,
      method: payoutMethod,
      address: payoutAddress
    });

    // For now, just show success message
    res.redirect('/vendor/wallet?success=Payout request submitted successfully! You will receive an email confirmation once processed.');
  });
});

// Forum categories management (vendors can add/delete categories)
router.get('/forum-categories', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=not-vendor');
    }

    // Get all forum categories
    db.all('SELECT * FROM forum_categories ORDER BY created_at ASC', [], (err, categories) => {
      if (err) {
        console.error('Error fetching forum categories:', err);
        return res.render('pages/vendor-forum-categories', { 
          categories: [],
          error: 'Failed to load categories',
          success: null,
          user: {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname,
            isVendor: true
          }
        });
      }

      res.render('pages/vendor-forum-categories', { 
        categories: categories || [],
        error: req.query.error,
        success: req.query.success,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: true
        }
      });
    });
  });
});

// Add new forum category
router.post('/forum-categories/add', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const { name, description } = req.body;

  if (!name) {
    return res.redirect('/vendor/forum-categories?error=Category name is required');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=not-vendor');
    }

    // Check if category name already exists
    db.get('SELECT id FROM forum_categories WHERE name = ?', [name], (err, existing) => {
      if (err) {
        console.error('Error checking existing category:', err);
        return res.redirect('/vendor/forum-categories?error=Failed to create category');
      }

      if (existing) {
        return res.redirect('/vendor/forum-categories?error=Category name already exists');
      }

      // Create new category
      db.run('INSERT INTO forum_categories (name, description, created_by) VALUES (?, ?, ?)', 
        [name, description || null, req.session.userId], function(err) {
        if (err) {
          console.error('Error creating forum category:', err);
          return res.redirect('/vendor/forum-categories?error=Failed to create category');
        }

        res.redirect('/vendor/forum-categories?success=Category created successfully');
      });
    });
  });
});

// Delete forum category
router.post('/forum-categories/:id/delete', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const categoryId = req.params.id;

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=not-vendor');
    }

    // Check if category exists and count threads
    db.get('SELECT COUNT(*) as thread_count FROM forum_threads WHERE category_id = ?', 
      [categoryId], (err, result) => {
      if (err) {
        console.error('Error checking thread count:', err);
        return res.redirect('/vendor/forum-categories?error=Failed to delete category');
      }

      if (result.thread_count > 0) {
        return res.redirect('/vendor/forum-categories?error=Cannot delete category with existing threads');
      }

      // Delete the category
      db.run('DELETE FROM forum_categories WHERE id = ?', [categoryId], function(err) {
        if (err) {
          console.error('Error deleting forum category:', err);
          return res.redirect('/vendor/forum-categories?error=Failed to delete category');
        }

        if (this.changes === 0) {
          return res.redirect('/vendor/forum-categories?error=Category not found');
        }

        res.redirect('/vendor/forum-categories?success=Category deleted successfully');
      });
    });
  });
});

// Product edit page
router.get('/products/:id/edit', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const productId = req.params.id;

  // Check if user is a vendor and owns this product
  db.get(`SELECT p.*, v.id as vendor_id FROM products p 
          JOIN vendors v ON p.vendor_id = v.id 
          WHERE p.id = ? AND v.user_id = ?`, [productId, req.session.userId], (err, product) => {
    if (err || !product) {
      return res.redirect('/vendor/products?error=Product not found or access denied');
    }

    // If it's a digital product, get digital details
    if (product.product_type === 'digital') {
      db.get('SELECT * FROM digital_product_details WHERE product_id = ?', [productId], (err, digitalDetails) => {
        if (err) {
          console.error('Error fetching digital details:', err);
        }

        res.render('pages/vendor-edit-product', {
          product: product,
          digitalDetails: digitalDetails || null,
          error: req.query.error,
          success: req.query.success,
          user: {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname,
            isVendor: true
          }
        });
      });
    } else {
      res.render('pages/vendor-edit-product', {
        product: product,
        digitalDetails: null,
        error: req.query.error,
        success: req.query.success,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: true
        }
      });
    }
  });
});

// Edit product
router.post('/products/:id/edit', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const productId = req.params.id;
  const { name, description, price, currency, category, stockQuantity, status } = req.body;

  // Check if user is a vendor and owns this product
  db.get(`SELECT p.*, v.id as vendor_id FROM products p 
          JOIN vendors v ON p.vendor_id = v.id 
          WHERE p.id = ? AND v.user_id = ?`, [productId, req.session.userId], (err, product) => {
    if (err || !product) {
      return res.redirect('/vendor/products?error=Product not found or access denied');
    }

    // Validation
    if (!name || !description || !price || !category) {
      return res.redirect('/vendor/products?error=Please fill in all required fields');
    }

    // Update product
    const updateQuery = `UPDATE products SET 
      name = ?, description = ?, price = ?, currency = ?, category = ?, status = ?
      ${product.product_type === 'physical' ? ', stock_quantity = ?' : ''}
      WHERE id = ?`;

    const params = product.product_type === 'physical' 
      ? [name, description, parseFloat(price), currency, category, status, parseInt(stockQuantity) || 0, productId]
      : [name, description, parseFloat(price), currency, category, status, productId];

    db.run(updateQuery, params, function(err) {
      if (err) {
        console.error('Error updating product:', err);
        return res.redirect('/vendor/products?error=Failed to update product');
      }

      res.redirect('/vendor/products?success=Product updated successfully');
    });
  });
});

// Delete product
router.post('/products/:id/delete', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const productId = req.params.id;

  // Check if user is a vendor and owns this product
  db.get(`SELECT p.*, v.id as vendor_id FROM products p 
          JOIN vendors v ON p.vendor_id = v.id 
          WHERE p.id = ? AND v.user_id = ?`, [productId, req.session.userId], (err, product) => {
    if (err || !product) {
      // Handle both AJAX and form requests
      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(404).json({ error: 'Product not found or access denied' });
      } else {
        return res.redirect('/vendor/products?error=Product not found or access denied');
      }
    }

    // Check if product has any pending orders
    db.get('SELECT COUNT(*) as order_count FROM orders WHERE product_id = ? AND status IN (?, ?)', 
      [productId, 'pending', 'processing'], (err, result) => {
      if (err) {
        console.error('Error checking orders:', err);
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
          return res.status(500).json({ error: 'Failed to check orders' });
        } else {
          return res.redirect('/vendor/products?error=Failed to check orders');
        }
      }

      if (result.order_count > 0) {
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
          return res.status(400).json({ error: 'Cannot delete product with pending orders' });
        } else {
          return res.redirect('/vendor/products?error=Cannot delete product with pending orders');
        }
      }

      // Delete digital product details if exists
      db.run('DELETE FROM digital_product_details WHERE product_id = ?', [productId], (err) => {
        if (err) {
          console.error('Error deleting digital product details:', err);
        }

        // Delete the product
        db.run('DELETE FROM products WHERE id = ?', [productId], function(err) {
          if (err) {
            console.error('Error deleting product:', err);
            if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
              return res.status(500).json({ error: 'Failed to delete product' });
            } else {
              return res.redirect('/vendor/products?error=Failed to delete product');
            }
          }

          // Handle both AJAX and form responses
          if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
            res.status(200).json({ success: 'Product deleted successfully' });
          } else {
            res.redirect('/vendor/products?success=Product deleted successfully');
          }
        });
      });
    });
  });
});

// Promote listings page
router.get('/promote-listings', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=not-vendor');
    }

    // Get vendor's products with promotion status
    db.all(`
      SELECT 
        p.*,
        CASE 
          WHEN pp.expires_at > datetime('now') THEN 1 
          ELSE 0 
        END as is_promoted,
        pp.expires_at as promotion_expires
      FROM products p
      LEFT JOIN promoted_products pp ON p.id = pp.product_id AND pp.expires_at > datetime('now')
      WHERE p.vendor_id = ?
      ORDER BY p.created_at DESC
    `, [vendor.id], (err, products) => {
      if (err) {
        console.error('Error fetching products for promotion:', err);
        return res.render('pages/vendor-promote-listings', { 
          products: [],
          error: 'Failed to load products',
          success: null,
          user: {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname,
            isVendor: true
          }
        });
      }

      res.render('pages/vendor-promote-listings', { 
        products: products || [],
        error: req.query.error,
        success: req.query.success,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: true
        }
      });
    });
  });
});

// Handle promotion order creation
router.post('/promote-listings/:id', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const productId = req.params.id;

  // Check if user is a vendor and owns this product
  db.get(`
    SELECT p.*, v.id as vendor_id 
    FROM products p 
    JOIN vendors v ON p.vendor_id = v.id 
    WHERE p.id = ? AND v.user_id = ? AND p.status = 'active'
  `, [productId, req.session.userId], (err, product) => {
    if (err || !product) {
      return res.redirect('/vendor/promote-listings?error=Product not found or access denied');
    }

    // Check if product is already promoted
    db.get('SELECT id FROM promoted_products WHERE product_id = ? AND expires_at > datetime(\'now\')', 
      [productId], (err, existing) => {
      if (err) {
        console.error('Error checking existing promotion:', err);
        return res.redirect('/vendor/promote-listings?error=Failed to check promotion status');
      }

      if (existing) {
        return res.redirect('/vendor/promote-listings?error=This product is already promoted');
      }

      // Set auto-decline date to 1 week from now
      const autoDeclineDate = new Date();
      autoDeclineDate.setDate(autoDeclineDate.getDate() + 7);

      // Create promotion order
      db.run(`
        INSERT INTO orders (
          buyer_id, vendor_id, product_id, quantity, 
          unit_price, total_price, currency, payment_method,
          status, auto_decline_at, created_at, special_instructions
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        req.session.userId,
        1, // System vendor ID
        'listing-promotion-' + productId,
        1,
        25,
        25,
        'USD',
        'XMR',
        'pending',
        autoDeclineDate.toISOString(),
        new Date().toISOString(),
        'LISTING_PROMOTION_FEE'
      ], function(err) {
        if (err) {
          console.error('Error creating promotion order:', err);
          return res.redirect('/vendor/promote-listings?error=Failed to create promotion order');
        }

        // Redirect to vendor fee order page
        res.redirect(`/vendor-fee-order/${this.lastID}`);
      });
    });
  });
});

// Clone product
router.post('/products/:id/clone', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const productId = req.params.id;

  // Check if user is a vendor and owns this product
  db.get(`SELECT p.*, v.id as vendor_id FROM products p 
          JOIN vendors v ON p.vendor_id = v.id 
          WHERE p.id = ? AND v.user_id = ?`, [productId, req.session.userId], (err, product) => {
    if (err || !product) {
      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
          return res.status(404).json({ error: 'Product not found or access denied' });
        } else {
          return res.redirect('/vendor/products?error=Product not found or access denied');
        }
    }

    // Clone the main product
    db.run(`INSERT INTO products (
      vendor_id, product_type, name, description, price, currency, category,
      stock_quantity, shipping_weight, shipping_dimensions, shipping_required, 
      status, image_urls
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      product.vendor_id, 
      product.product_type, 
      product.name + ' (Copy)', 
      product.description, 
      product.price, 
      product.currency, 
      product.category,
      product.stock_quantity, 
      product.shipping_weight, 
      product.shipping_dimensions, 
      product.shipping_required,
      'draft', // Set cloned products to draft by default
      product.image_urls
    ], function(err) {      if (err) {
        console.error('Error cloning product:', err);
        return res.status(500).json({ error: 'Failed to clone product' });
      }

      const newProductId = this.lastID;

      // If it's a digital product, clone the digital details too
      if (product.product_type === 'digital') {
        db.get('SELECT * FROM digital_product_details WHERE product_id = ?', [productId], (err, digitalDetails) => {
          if (err) {
            console.error('Error fetching digital details:', err);
            return res.status(200).json({ success: 'Product cloned successfully (without digital details)' });
          }

          if (digitalDetails) {
            db.run(`INSERT INTO digital_product_details (
              product_id, content_type, download_url, download_password,
              account_username, account_password, account_email,
              additional_info, instructions
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              newProductId, digitalDetails.content_type, digitalDetails.download_url,
              digitalDetails.download_password, digitalDetails.account_username,
              digitalDetails.account_password, digitalDetails.account_email,
              digitalDetails.additional_info, digitalDetails.instructions
            ], function(err) {
              if (err) {
                console.error('Error cloning digital details:', err);
              }
              if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
                res.status(200).json({ success: 'Product cloned successfully' });
              } else {
                res.redirect('/vendor/products?success=Product cloned successfully');
              }
            });
          } else {
            if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
              res.status(200).json({ success: 'Product cloned successfully' });
            } else {
              res.redirect('/vendor/products?success=Product cloned successfully');
            }
          }
        });
      } else {
        // Handle both AJAX and form responses
          if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
            res.status(200).json({ success: 'Product cloned successfully' });
          } else {
            res.redirect('/vendor/products?success=Product cloned successfully');
          }
      }
    });
  });
});

// Mark vendor order notifications as read
router.post('/orders/mark-read', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=Access denied - vendor account required');
    }

    // Update last_viewed_at for all pending orders for this vendor
    db.run(`
      UPDATE orders 
      SET last_viewed_at = ? 
      WHERE vendor_id = ? AND status = 'pending'
    `, [new Date().toISOString(), vendor.id], function(err) {
      if (err) {
        console.error('Error marking vendor orders as read:', err);
        return res.redirect('/vendor/orders?error=Failed to mark notifications as read');
      }

      res.redirect('/vendor/orders?success=Order notifications marked as read');
    });
  });
});

// Vendor forums main page
router.get('/forums', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=Access denied - vendor account required');
    }

    // Get vendor forum threads
    db.all(`
      SELECT 
        vft.*,
        (SELECT COUNT(*) FROM vendor_forum_posts WHERE thread_id = vft.id) as reply_count
      FROM vendor_forum_threads vft
      ORDER BY vft.is_pinned DESC, vft.last_reply_at DESC, vft.created_at DESC
    `, [], (err, threads) => {
      if (err) {
        console.error('Error fetching vendor forum threads:', err);
        threads = [];
      }

      res.render('pages/vendor-forums', {
        threads: threads || [],
        error: req.query.error,
        success: req.query.success,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: true
        }
      });
    });
  });
});

// Create new vendor forum thread
router.get('/forums/new-thread', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=Access denied - vendor account required');
    }

    res.render('pages/vendor-new-thread', {
      error: req.query.error,
      success: req.query.success,
      user: {
        id: req.session.userId,
        username: req.session.username,
        displayname: req.session.displayname,
        isVendor: true
      }
    });
  });
});

// Handle new vendor forum thread creation
router.post('/forums/new-thread', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const { title, content } = req.body;

  if (!title || !content) {
    return res.redirect('/vendor/forums/new-thread?error=Title and content are required');
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=Access denied - vendor account required');
    }

    const now = new Date().toISOString();

    db.run(`
      INSERT INTO vendor_forum_threads 
      (title, content, created_by, created_by_username, created_by_displayname, created_at, last_reply_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [title, content, req.session.userId, req.session.username, req.session.displayname, now, now], function(err) {
      if (err) {
        console.error('Error creating vendor forum thread:', err);
        return res.redirect('/vendor/forums/new-thread?error=Failed to create thread');
      }

      res.redirect(`/vendor/forums/thread/${this.lastID}?success=Thread created successfully`);
    });
  });
});

// View vendor forum thread
router.get('/forums/thread/:id', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const threadId = req.params.id;

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=Access denied - vendor account required');
    }

    // Get thread info
    db.get('SELECT * FROM vendor_forum_threads WHERE id = ?', [threadId], (err, thread) => {
      if (err || !thread) {
        return res.redirect('/vendor/forums?error=Thread not found');
      }

      // Get posts in this thread
      db.all(`
        SELECT * FROM vendor_forum_posts 
        WHERE thread_id = ? 
        ORDER BY created_at ASC
      `, [threadId], (err, posts) => {
        if (err) {
          console.error('Error fetching vendor forum posts:', err);
          posts = [];
        }

        res.render('pages/vendor-forum-thread', {
          thread: thread,
          posts: posts || [],
          error: req.query.error,
          success: req.query.success,
          user: {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname,
            isVendor: true
          }
        });
      });
    });
  });
});

// Add reply to vendor forum thread
router.post('/forums/thread/:id/reply', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const threadId = req.params.id;
  const { content } = req.body;

  if (!content) {
    return res.redirect(`/vendor/forums/thread/${threadId}?error=Reply content is required`);
  }

  // Check if user is a vendor
  db.get('SELECT id FROM vendors WHERE user_id = ?', [req.session.userId], (err, vendor) => {
    if (err || !vendor) {
      return res.redirect('/?error=Access denied - vendor account required');
    }

    // Check if thread exists and is not locked
    db.get('SELECT * FROM vendor_forum_threads WHERE id = ?', [threadId], (err, thread) => {
      if (err || !thread) {
        return res.redirect('/vendor/forums?error=Thread not found');
      }

      if (thread.is_locked === 1) {
        return res.redirect(`/vendor/forums/thread/${threadId}?error=This thread is locked`);
      }

      const now = new Date().toISOString();

      // Add the reply
      db.run(`
        INSERT INTO vendor_forum_posts 
        (thread_id, content, created_by, created_by_username, created_by_displayname, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [threadId, content, req.session.userId, req.session.username, req.session.displayname, now], function(err) {
        if (err) {
          console.error('Error adding vendor forum reply:', err);
          return res.redirect(`/vendor/forums/thread/${threadId}?error=Failed to add reply`);
        }

        // Update thread reply count and last reply time
        db.run(`
          UPDATE vendor_forum_threads 
          SET reply_count = reply_count + 1, last_reply_at = ?
          WHERE id = ?
        `, [now, threadId], (err) => {
          if (err) {
            console.error('Error updating vendor thread stats:', err);
          }
          res.redirect(`/vendor/forums/thread/${threadId}?success=Reply added successfully`);
        });
      });
    });
  });
});

// Accept order
router.post('/orders/:id/accept', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const orderId = req.params.id;
  const { response_message } = req.body;

  console.log(`Vendor ${req.session.userId} attempting to accept order ${orderId}`);

  // Check if user is a vendor and owns this order
  db.get(`
    SELECT o.*, v.id as vendor_id 
    FROM orders o 
    JOIN vendors v ON o.vendor_id = v.id 
    WHERE o.id = ? AND v.user_id = ? AND o.status = 'pending'
  `, [orderId, req.session.userId], (err, order) => {
    if (err) {
      console.error('Database error checking order ownership:', err);
      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(500).json({ error: 'Database error checking order' });
      } else {
        return res.redirect('/vendor/orders?error=Database error checking order');
      }
    }

    if (!order) {
      console.log(`Order ${orderId} not found or not accessible by vendor ${req.session.userId}`);
      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(404).json({ error: 'Order not found or access denied' });
      } else {
        return res.redirect('/vendor/orders?error=Order not found or access denied');
      }
    }

    console.log(`Found order ${orderId}, checking expiration...`);

    // Check if order hasn't auto-declined
    const now = new Date();
    const autoDeclineDate = new Date(order.auto_decline_at);

    if (now > autoDeclineDate) {
      console.log(`Order ${orderId} has expired (auto-decline date: ${order.auto_decline_at})`);
      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(400).json({ error: 'Order has expired and cannot be accepted' });
      } else {
        return res.redirect('/vendor/orders?error=Order has expired and cannot be accepted');
      }
    }

    console.log(`Accepting order ${orderId}...`);

    // Accept the order
    db.run(`
      UPDATE orders 
      SET status = 'accepted', vendor_response = ?, vendor_response_at = ? 
      WHERE id = ? AND status = 'pending'
    `, [response_message || 'Order accepted', new Date().toISOString(), orderId], function(err) {
      if (err) {
        console.error('Error accepting order:', err);
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
          return res.status(500).json({ error: 'Failed to accept order: ' + err.message });
        } else {
          return res.redirect('/vendor/orders?error=Failed to accept order: ' + err.message);
        }
      }

      if (this.changes === 0) {
        console.log(`No rows updated when accepting order ${orderId} - order may have been modified`);
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
          return res.status(400).json({ error: 'Order could not be accepted - it may have been modified' });
        } else {
          return res.redirect('/vendor/orders?error=Order could not be accepted - it may have been modified');
        }
      }

      console.log(`Order ${orderId} accepted successfully`);

      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        res.json({ success: 'Order accepted successfully' });
      } else {
        res.redirect('/vendor/orders?success=Order accepted successfully');
      }
    });
  });
});

// Decline order
router.post('/orders/:id/decline', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const orderId = req.params.id;
  const { response_message } = req.body;

  // Check if user is a vendor and owns this order
  db.get(`
    SELECT o.*, v.id as vendor_id 
    FROM orders o 
    JOIN vendors v ON o.vendor_id = v.id 
    WHERE o.id = ? AND v.user_id = ? AND o.status = 'pending'
  `, [orderId, req.session.userId], (err, order) => {
    if (err || !order) {
      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(404).json({ error: 'Order not found or access denied' });
      } else {
        return res.redirect('/vendor/orders?error=Order not found or access denied');
      }
    }

    // Decline the order
    db.run(`
      UPDATE orders 
      SET status = 'declined', vendor_response = ?, vendor_response_at = ? 
      WHERE id = ?
    `, [response_message || 'Order declined', new Date().toISOString(), orderId], function(err) {
      if (err) {
        console.error('Error declining order:', err);
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
          return res.status(500).json({ error: 'Failed to decline order' });
        } else {
          return res.redirect('/vendor/orders?error=Failed to decline order');
        }
      }

      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        res.json({ success: 'Order declined successfully' });
      } else {
        res.redirect('/vendor/orders?success=Order declined successfully');
      }
    });
  });
});

// Mark order as shipped
router.post('/orders/:id/ship', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const orderId = req.params.id;
  const { tracking_info } = req.body;

  // Check if user is a vendor and owns this order
  db.get(`
    SELECT o.*, v.id as vendor_id 
    FROM orders o 
    JOIN vendors v ON o.vendor_id = v.id 
    WHERE o.id = ? AND v.user_id = ? AND o.status = 'accepted'
  `, [orderId, req.session.userId], (err, order) => {
    if (err || !order) {
      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(404).json({ error: 'Order not found or access denied' });
      } else {
        return res.redirect('/vendor/orders?error=Order not found or access denied');
      }
    }

    // Check if 7 days have passed since acceptance (shipping deadline)
    const acceptedDate = new Date(order.vendor_response_at);
    const shippingDeadline = new Date(acceptedDate);
    shippingDeadline.setDate(shippingDeadline.getDate() + 7);
    
    if (new Date() > shippingDeadline) {
      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(400).json({ error: 'Shipping deadline has passed. Order may be subject to dispute.' });
      } else {
        return res.redirect('/vendor/orders?error=Shipping deadline has passed. Order may be subject to dispute.');
      }
    }

    // Set buyer dispute deadline (2 weeks from shipping)
    const disputeDeadline = new Date();
    disputeDeadline.setDate(disputeDeadline.getDate() + 14);

    // Mark order as shipped
    db.run(`
      UPDATE orders 
      SET status = 'shipped', 
          delivery_details = ?, 
          shipped_at = ?,
          buyer_dispute_deadline = ?
      WHERE id = ?
    `, [tracking_info || 'Order has been shipped', new Date().toISOString(), disputeDeadline.toISOString(), orderId], function(err) {
      if (err) {
        console.error('Error marking order as shipped:', err);
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
          return res.status(500).json({ error: 'Failed to mark order as shipped' });
        } else {
          return res.redirect('/vendor/orders?error=Failed to mark order as shipped');
        }
      }

      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        res.json({ success: 'Order marked as shipped successfully' });
      } else {
        res.redirect('/vendor/orders?success=Order marked as shipped successfully');
      }
    });
  });
});

// Mark order as completed (vendor can only do this if buyer doesn't respond within 2 weeks of shipping)
router.post('/orders/:id/complete', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const orderId = req.params.id;

  // Check if user is a vendor and owns this order
  db.get(`
    SELECT o.*, v.id as vendor_id 
    FROM orders o 
    JOIN vendors v ON o.vendor_id = v.id 
    WHERE o.id = ? AND v.user_id = ? AND o.status = 'shipped'
  `, [orderId, req.session.userId], (err, order) => {
    if (err || !order) {
      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(404).json({ error: 'Order not found or access denied' });
      } else {
        return res.redirect('/vendor/orders?error=Order not found or access denied');
      }
    }

    // Check if 2 weeks have passed since shipping (buyer response deadline)
    const buyerDeadline = new Date(order.buyer_dispute_deadline);
    
    if (new Date() < buyerDeadline) {
      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        return res.status(400).json({ error: 'Buyer still has time to mark as received or open dispute. Please wait until after the deadline.' });
      } else {
        return res.redirect('/vendor/orders?error=Buyer still has time to mark as received or open dispute. Please wait until after the deadline.');
      }
    }

    // Complete the order (auto-complete after buyer deadline)
    db.run(`
      UPDATE orders 
      SET status = 'completed', completed_at = ?, vendor_response = 'Auto-completed - buyer deadline expired'
      WHERE id = ?
    `, [new Date().toISOString(), orderId], function(err) {
      if (err) {
        console.error('Error completing order:', err);
        if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
          return res.status(500).json({ error: 'Failed to complete order' });
        } else {
          return res.redirect('/vendor/orders?error=Failed to complete order');
        }
      }

      if (req.xhr || req.headers.accept?.indexOf('json') > -1) {
        res.json({ success: 'Order completed successfully' });
      } else {
        res.redirect('/vendor/orders?success=Order completed successfully');
      }
    });
  });
});

module.exports = router;