const express = require("express");
const session = require("express-session");
const path = require("path");
const axios = require("axios");
const app = express();

// Database connection
const db = require("./database/db");

// View engine setup
app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

// Middleware
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));

// Session middleware
app.use(
  session({
    secret: "your-secret-key-change-this",
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false },
  }),
);

// Middleware to check for unread messages
const checkUnreadMessages = (req, res, next) => {
  if (req.session.userId) {
    // Get unread message count
    db.get(
      `
      SELECT COUNT(*) as unread_count 
      FROM messages m
      JOIN message_threads mt ON m.thread_id = mt.id
      WHERE (mt.participant1_id = ? OR mt.participant2_id = ?) 
      AND m.sender_id != ? 
      AND m.is_read = 0
    `,
      [req.session.userId, req.session.userId, req.session.userId],
      (err, result) => {
        if (err) {
          console.error("Error checking unread messages:", err);
          req.unreadMessageCount = 0;
        } else if (result) {
          req.unreadMessageCount = result.unread_count || 0;
        } else {
          req.unreadMessageCount = 0;
        }
        next();
      },
    );
  } else {
    next();
  }
};

// Middleware to check for order notifications
const checkOrderNotifications = (req, res, next) => {
  // Simple passthrough - just set default values without any database updates
  req.unreadMessageCount = 0;
  req.pendingVendorOrders = 0;
  req.orderUpdates = 0;
  next();
};

// Apply unread messages middleware to all routes
app.use(checkUnreadMessages);

// Apply order notifications middleware to all routes
app.use(checkOrderNotifications);

// Helper function to get standard render data
const getStandardRenderData = (req, additionalData = {}) => {
  return {
    user: req.session.userId
      ? {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: req.session.isVendor || false,
        }
      : null,
    unreadMessageCount: req.unreadMessageCount || 0,
    pendingVendorOrders: req.pendingVendorOrders || 0,
    orderUpdates: req.orderUpdates || 0,
    currentPath: req.path || req.url || "/",
    req: req,
    ...additionalData,
  };
};

// Middleware to add unread message count and server stats to all views
app.use((req, res, next) => {
  // Add current path to all views
  res.locals.currentPath = req.path || req.url || "/";
  res.locals.req = req;

  if (req.session.userId) {
    // Get unread message count
    db.get(
      `
      SELECT COUNT(*) as unread_count
      FROM messages m
      JOIN message_threads mt ON m.thread_id = mt.id
      WHERE (mt.participant1_id = ? OR mt.participant2_id = ?)
      AND m.sender_id != ?
      AND m.is_read = 0
    `,
      [req.session.userId, req.session.userId, req.session.userId],
      (err, result) => {
        if (err) {
          console.error("Error getting unread message count:", err);
          res.locals.unreadMessageCount = 0;
        } else {
          res.locals.unreadMessageCount = result ? result.unread_count : 0;
        }

        // Get server stats for footer
        getServerStats((stats) => {
          res.locals.stats = stats;
          next();
        });
      },
    );
  } else {
    res.locals.unreadMessageCount = 0;
    // Get server stats for footer
    getServerStats((stats) => {
      res.locals.stats = stats;
      next();
    });
  }
});

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session.userId) {
    // Check if user is banned
    db.get(
      "SELECT is_banned, ban_reason FROM users WHERE id = ?",
      [req.session.userId],
      (err, user) => {
        if (err) {
          console.error("Error checking ban status:", err);
          return res.redirect("/auth/login");
        }

        if (user && user.is_banned === 1) {
          return res.render("pages/banned", {
            banReason: user.ban_reason,
            user: null,
          });
        }

        next();
      },
    );
  } else {
    res.redirect("/auth/login");
  }
}

// Routes
const authRoutes = require("./routes/auth");
const userRoutes = require("./routes/users");
const vendorRoutes = require("./routes/vendor");
const adminRoutes = require("./routes/admin");
const supportRoutes = require("./routes/support");
const forumRoutes = require("./routes/forums");
const messageRoutes = require("./routes/messages");

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);
app.use("/vendor", vendorRoutes);
app.use("/forums", forumRoutes);
app.use("/support", supportRoutes);
app.use("/messages", messageRoutes);
app.use("/", userRoutes); // Users route now handles home page
app.use("/api", forumRoutes); // For banner API

// Profile route redirect
app.get("/profile", requireAuth, (req, res) => {
  res.redirect("/users/profile");
});

// Product detail page
app.get("/products/:id", (req, res) => {
  const productId = req.params.id;

  db.get(
    `
    SELECT 
      p.*,
      v.business_name as vendor_name,
      v.shipping_from,
      v.avatar as vendor_avatar,
      v.vacation_mode,
      v.is_trusted as vendor_is_trusted,
      v.country_flag as vendor_country_flag,
      u.displayname as vendor_displayname,
      u.username as vendor_username,
      u.is_trusted_vendor as user_is_trusted_vendor
    FROM products p
    JOIN vendors v ON p.vendor_id = v.id
    JOIN users u ON v.user_id = u.id
    WHERE p.id = ? AND p.status = 'active'
  `,
    [productId],
    (err, product) => {
      if (err || !product) {
        return res.status(404).render("pages/error", {
          error: "Product not found or unavailable",
          user: req.session.userId
            ? {
                id: req.session.userId,
                username: req.session.username,
                displayname: req.session.displayname,
                isVendor: req.session.isVendor || false,
              }
            : null,
        });
      }

      // Check if vendor is in vacation mode (but allow trusted vendors to be viewed)
      if (product.vacation_mode === 1 && product.vendor_is_trusted !== 1 && product.user_is_trusted_vendor !== 1) {
        return res.status(404).render("pages/error", {
          error: "Product temporarily unavailable - vendor is in vacation mode",
          user: req.session.userId
            ? {
                id: req.session.userId,
                username: req.session.username,
                displayname: req.session.displayname,
                isVendor: req.session.isVendor || false,
              }
            : null,
        });
      }

      // Parse images
      if (product.image_urls) {
        try {
          product.images = JSON.parse(product.image_urls);
        } catch (e) {
          product.images = [];
        }
      } else {
        product.images = [];
      }

      // Get vendor reviews
      db.all(
        `
      SELECT 
        vf.rating,
        vf.feedback_text,
        vf.created_at,
        u.displayname as buyer_name,
        u.username as buyer_username
      FROM vendor_feedback vf
      JOIN users u ON vf.buyer_id = u.id
      WHERE vf.vendor_id = ?
      ORDER BY vf.created_at DESC
      LIMIT 10
    `,
        [product.vendor_id],
        (err, vendorReviews) => {
          if (err) {
            console.error("Error fetching vendor reviews:", err);
            vendorReviews = [];
          }

          // Calculate average rating
          const avgRating =
            vendorReviews.length > 0
              ? vendorReviews.reduce((sum, review) => sum + review.rating, 0) /
                vendorReviews.length
              : 0;

          // Get digital product details if it's a digital product
          if (product.product_type === "digital") {
            db.get(
              "SELECT * FROM digital_product_details WHERE product_id = ?",
              [productId],
              (err, digitalDetails) => {
                getXMRPrice((xmrData) => {
                  res.render("pages/product-detail", {
                    product: product,
                    digitalDetails: digitalDetails || null,
                    vendorReviews: vendorReviews || [],
                    averageRating: avgRating,
                    xmrPrice: xmrData ? xmrData.price : null,
                    error: req.query.error,
                    success: req.query.success,
                    user: req.session.userId
                      ? {
                          id: req.session.userId,
                          username: req.session.username,
                          displayname: req.session.displayname,
                          isVendor: req.session.isVendor || false,
                        }
                      : null,
                  });
                });
              },
            );
          } else {
            getXMRPrice((xmrData) => {
              res.render("pages/product-detail", {
                product: product,
                digitalDetails: null,
                vendorReviews: vendorReviews || [],
                averageRating: avgRating,
                xmrPrice: xmrData ? xmrData.price : null,
                error: req.query.error,
                success: req.query.success,
                user: req.session.userId
                  ? {
                      id: req.session.userId,
                      username: req.session.username,
                      displayname: req.session.displayname,
                      isVendor: req.session.isVendor || false,
                    }
                  : null,
              });
            });
          }
        },
      );
    },
  );
});

// Vendor fee order page
app.get("/vendor-fee-order/:orderId", (req, res) => {
  if (!req.session.userId) {
    return res.redirect("/auth/login");
  }

  const orderId = req.params.orderId;

  // Get the order details
  db.get(
    "SELECT * FROM orders WHERE id = ? AND buyer_id = ?",
    [orderId, req.session.userId],
    (err, order) => {
      if (err || !order) {
        return res.redirect("/vendor/apply?error=Order not found");
      }

      // Check if this is a vendor fee order
      if (
        !order.special_instructions ||
        (!order.special_instructions.includes("VENDOR_APPLICATION_FEE") &&
          !order.special_instructions.includes(
            "DIGITAL_VENDOR_APPLICATION_FEE",
          ))
      ) {
        return res.redirect("/vendor/apply?error=Invalid order type");
      }

      getXMRPrice((xmrData) => {
        const xmrPrice = xmrData ? xmrData.price : null;
        const xmrAmount = xmrPrice
          ? ((order.total_price * 1.07) / xmrPrice).toFixed(6)
          : null;

        // Define service details
        let serviceDetails = {};
        if (order.special_instructions === "VENDOR_APPLICATION_FEE") {
          serviceDetails = {
            name: "Vendor Application Fee",
            description:
              "One-time fee to become a vendor on Kevin's Corner Marketplace",
            price: 300,
            currency: "USD",
            icon: "🏪",
          };
        } else if (
          order.special_instructions === "DIGITAL_VENDOR_APPLICATION_FEE"
        ) {
          serviceDetails = {
            name: "Digital Products Vendor License",
            description:
              "License to sell digital products only on Kevin's Corner Marketplace",
            price: 50,
            currency: "USD",
            icon: "💻",
          };
        } else if (
          order.special_instructions === "SEO_WEBSITE_SUBMISSION_SERVICE"
        ) {
          serviceDetails = {
            name: "SEO Website Submission Service",
            description:
              "Professional submission of your website to 50+ search engines and directories",
            price: 25,
            currency: "USD",
            icon: "🔍",
          };
        } else if (order.special_instructions === "FORUM_BANNER_AD_MONTHLY") {
          serviceDetails = {
            name: "Forum Banner Advertisement",
            description:
              "Monthly banner advertisement placement on Kevin's Corner forums",
            price: 100,
            currency: "USD",
            icon: "📢",
          };
        } else if (
          order.special_instructions === "SINGLE_VENDOR_STORE_MONTHLY"
        ) {
          serviceDetails = {
            name: "Single Vendor Store",
            description:
              "Monthly hosting of your own dedicated vendor store page",
            price: 25,
            currency: "USD",
            icon: "🏬",
          };
        } else if (order.special_instructions === "LISTING_PROMOTION_FEE") {
          serviceDetails = {
            name: "Listing Promotion",
            description:
              "Sticky your product listing to the top of its category for 30 days",
            price: 25,
            currency: "USD",
            icon: "🚀",
          };
        }

        res.render("pages/order", {
          product: {
            id: order.product_id,
            name: order.special_instructions.includes(
              "DIGITAL_VENDOR_APPLICATION_FEE",
            )
              ? "Digital Products Vendor License"
              : "Vendor Application Fee",
            description: order.special_instructions.includes(
              "DIGITAL_VENDOR_APPLICATION_FEE",
            )
              ? "License to sell digital products only on Kevin's Corner Marketplace"
              : "One-time fee to become a vendor on Kevin's Corner Marketplace",
            price: order.total_price,
            currency: order.currency,
            product_type: "digital",
          },
          vendor: {
            business_name: "Kevin's Corner Marketplace",
            user_id: 1,
          },
          quantity: 1,
          totalPrice: order.total_price,
          xmrPrice: xmrPrice,
          xmrAmount: xmrAmount,
          orderId: order.id,
          error: req.query.error,
          success: req.query.success,
          user: {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname,
            isVendor: req.session.isVendor || false,
          },
        });
      });
    },
  );
});

// Order page
app.get("/products/:id/order", requireAuth, (req, res) => {
  const productId = req.params.id;

  // Get product details with vendor info
  db.get(
    `
    SELECT 
      p.*,
      v.business_name as vendor_name,
      v.shipping_from,
      v.avatar as vendor_avatar,
      v.vacation_mode,
      v.id as vendor_id,
      v.is_trusted as vendor_is_trusted,
      u.displayname as vendor_displayname,
      u.username as vendor_username,
      u.is_trusted_vendor as user_is_trusted_vendor,
      ROUND(AVG(vf.rating), 1) as vendor_rating,
      COUNT(vf.rating) as rating_count
    FROM products p
    JOIN vendors v ON p.vendor_id = v.id
    JOIN users u ON v.user_id = u.id
    LEFT JOIN vendor_feedback vf ON v.id = vf.vendor_id
    WHERE p.id = ? AND p.status = 'active' AND v.vacation_mode = 0
    GROUP BY p.id, v.id
  `,
    [productId],
    (err, product) => {
      if (err || !product) {
        return res.status(404).render("pages/error", {
          error: "Product not found or unavailable",
          user: {
            id: req.session.userId,
            username: req.session.username,
            displayname: req.session.displayname,
            isVendor: req.session.isVendor || false,
          },
        });
      }

      // Parse images
      if (product.image_urls) {
        try {
          product.images = JSON.parse(product.image_urls);
        } catch (e) {
          product.images = [];
        }
      } else {
        product.images = [];
      }

      // Get vendor's latest feedback/reviews
      db.all(
        `
      SELECT 
        vf.rating,
        vf.feedback_text,
        vf.created_at,
        u.displayname as buyer_name,
        u.username as buyer_username
      FROM vendor_feedback vf
      JOIN users u ON vf.buyer_id = u.id
      WHERE vf.vendor_id = ?
      ORDER BY vf.created_at DESC
      LIMIT 5
    `,
        [product.vendor_id],
        (err, vendorFeedback) => {
          if (err) {
            console.error("Error fetching vendor feedback:", err);
            vendorFeedback = [];
          }

          getXMRPrice((xmrData) => {
            res.render("pages/order", {
              product: product,
              vendorFeedback: vendorFeedback || [],
              xmrPrice: xmrData ? xmrData.price : null,
              error: req.query.error,
              success: req.query.success,
              user: {
                id: req.session.userId,
                username: req.session.username,
                displayname: req.session.displayname,
                isVendor: req.session.isVendor || false,
              },
            });
          });
        },
      );
    },
  );
});

// Process vendor fee order
app.post("/vendor-fee-order/:orderId/process", requireAuth, (req, res) => {
  const orderId = req.params.orderId;
  const { paymentMethod = "XMR" } = req.body;

  // Get the vendor fee order
  db.get(
    `
    SELECT * FROM orders 
    WHERE id = ? AND buyer_id = ? AND special_instructions = 'VENDOR_APPLICATION_FEE' AND status = 'pending'
  `,
    [orderId, req.session.userId],
    (err, order) => {
      if (err || !order) {
        return res.redirect(
          `/vendor-fee-order/${orderId}?error=Order not found or already processed`,
        );
      }

      // Update order status to accepted (simulating payment)
      db.run(
        `
      UPDATE orders 
      SET status = 'accepted', vendor_response = 'Vendor application fee payment received', vendor_response_at = ? 
      WHERE id = ?
    `,
        [new Date().toISOString(), orderId],
        (err) => {
          if (err) {
            console.error("Error updating vendor fee order:", err);
            return res.redirect(
              `/vendor-fee-order/${orderId}?error=Failed to process payment`,
            );
          }

          // Make user a vendor
          db.run(
            "UPDATE users SET is_vendor = 1 WHERE id = ?",
            [req.session.userId],
            (err) => {
              if (err) {
                console.error("Error making user a vendor:", err);
                return res.redirect(
                  `/vendor-fee-order/${orderId}?error=Payment processed but vendor activation failed`,
                );
              }

              // Insert into vendors table
              db.run(
                "INSERT INTO vendors (user_id, business_name, business_description) VALUES (?, ?, ?)",
                [
                  req.session.userId,
                  req.session.displayname + "'s Store",
                  "Vendor activated via paid application",
                ],
                (err) => {
                  if (err) {
                    console.error("Error creating vendor record:", err);
                  }

                  // Update session
                  req.session.isVendor = true;

                  // Mark order as completed
                  db.run(
                    "UPDATE orders SET status = ?, completed_at = ? WHERE id = ?",
                    ["completed", new Date().toISOString(), orderId],
                    (err) => {
                      if (err) {
                        console.error(
                          "Error completing vendor fee order:",
                          err,
                        );
                      }

                      res.redirect(
                        "/vendor/profile?success=Payment successful! Your vendor account has been activated",
                      );
                    },
                  );
                },
              );
            },
          );
        },
      );
    },
  );
});

// Process order
app.post("/products/:id/order", requireAuth, (req, res) => {
  const productId = req.params.id;
  const { quantity = 1, paymentMethod = "XMR" } = req.body;

  // Get product and vendor details
  db.get(
    `
    SELECT 
      p.*,
      v.id as vendor_id,
      v.business_name as vendor_name
    FROM products p
    JOIN vendors v ON p.vendor_id = v.id
    WHERE p.id = ? AND p.status = 'active' AND v.vacation_mode = 0
  `,
    [productId],
    (err, product) => {
      if (err || !product) {
        return res.redirect(
          `/products/${productId}/order?error=Product not found or unavailable`,
        );
      }

      // Check if user is trying to buy their own product
      db.get(
        "SELECT id FROM vendors WHERE user_id = ?",
        [req.session.userId],
        (err, userVendor) => {
          if (userVendor && userVendor.id === product.vendor_id) {
            return res.redirect(
              `/products/${productId}/order?error=You cannot purchase your own products`,
            );
          }

          const totalPrice = parseFloat(product.price) * parseInt(quantity);

          // Set auto-decline date to 1 week from now
          const autoDeclineDate = new Date();
          autoDeclineDate.setDate(autoDeclineDate.getDate() + 7);

          // Create the order
          db.run(
            `
        INSERT INTO orders (
          buyer_id, vendor_id, product_id, quantity, 
          unit_price, total_price, currency, payment_method,
          status, auto_decline_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `,
            [
              req.session.userId,
              product.vendor_id,
              productId,
              quantity,
              product.price,
              totalPrice,
              product.currency || "USD",
              paymentMethod,
              autoDeclineDate.toISOString(),
              new Date().toISOString(),
            ],
            function (err) {
              if (err) {
                console.error("Error creating order:", err);
                return res.redirect(
                  `/products/${productId}/order?error=Failed to create order`,
                );
              }

              res.redirect(
                `/orders?success=Order placed successfully! Order ID: ${this.lastID}`,
              );
            },
          );
        },
      );
    },
  );
});

// Function to fetch XMR price from Kraken API
async function fetchXMRPrice() {
  try {
    console.log("Fetching XMR price from Kraken...");
    const response = await axios.get(
      "https://api.kraken.com/0/public/Ticker?pair=XMRUSD",
      {
        timeout: 10000, // 10 second timeout
        headers: {
          "User-Agent": "Kevin's Corner Market App",
        },
      },
    );

    console.log("Kraken API response status:", response.status);
    console.log(
      "Kraken API response data structure:",
      JSON.stringify(response.data, null, 2),
    );

    // Check if response has the expected structure
    if (!response.data) {
      throw new Error("No data in API response");
    }

    if (response.data.error && response.data.error.length > 0) {
      throw new Error("Kraken API error: " + response.data.error.join(", "));
    }

    if (!response.data.result) {
      throw new Error("No result object in API response");
    }

    // Try different possible response formats
    let priceData = null;
    let price = null;

    // Check for XMRUSD format
    if (response.data.result.XMRUSD) {
      priceData = response.data.result.XMRUSD;
    }
    // Check for XXMRZUSD format (alternative Kraken format)
    else if (response.data.result.XXMRZUSD) {
      priceData = response.data.result.XXMRZUSD;
    }
    // Check if there's only one pair in the result
    else {
      const keys = Object.keys(response.data.result);
      if (keys.length === 1) {
        priceData = response.data.result[keys[0]];
        console.log("Using alternative pair format:", keys[0]);
      }
    }

    if (!priceData) {
      throw new Error(
        "XMR price data not found in API response. Available pairs: " +
          Object.keys(response.data.result).join(", "),
      );
    }

    // Extract price from different possible formats
    if (priceData.c && Array.isArray(priceData.c) && priceData.c.length > 0) {
      price = parseFloat(priceData.c[0]); // Current price
    } else if (priceData.last) {
      price = parseFloat(priceData.last);
    } else if (priceData.price) {
      price = parseFloat(priceData.price);
    } else {
      throw new Error(
        "Price value not found in expected format. Available fields: " +
          Object.keys(priceData).join(", "),
      );
    }

    if (isNaN(price) || price <= 0) {
      throw new Error("Invalid price value: " + price);
    }

    // Update or insert the price in database
    db.run(
      `INSERT OR REPLACE INTO crypto_prices (symbol, price, currency, last_updated) 
       VALUES (?, ?, ?, ?)`,
      ["XMR", price, "USD", new Date().toISOString()],
      function (err) {
        if (err) {
          console.error("Error updating XMR price in database:", err);
        } else {
          console.log(`XMR price updated successfully: $${price.toFixed(2)}`);
        }
      },
    );

    return price;
  } catch (error) {
    console.error("Error fetching XMR price:", error.message);

    // Try to get the last known price from database as fallback
    db.get(
      "SELECT price, last_updated FROM crypto_prices WHERE symbol = ?",
      ["XMR"],
      (err, row) => {
        if (!err && row) {
          console.log(
            `Using cached XMR price: $${row.price} (last updated: ${row.last_updated})`,
          );
        } else {
          console.log("No cached XMR price available");
        }
      },
    );

    return null;
  }
}

// Function to get XMR price from database
function getXMRPrice(callback) {
  db.get(
    "SELECT price, last_updated FROM crypto_prices WHERE symbol = ?",
    ["XMR"],
    (err, row) => {
      if (err) {
        console.error("Error fetching XMR price from database:", err);
        callback(null);
      } else {
        callback(row);
      }
    },
  );
}

// Function to get server stats
function getServerStats(callback) {
  const stats = {};

  db.get("SELECT COUNT(*) as userCount FROM users", [], (err, userResult) => {
    stats.userCount = err ? 0 : userResult.userCount;

    db.get(
      "SELECT COUNT(*) as vendorCount FROM users WHERE is_vendor = 1",
      [],
      (err, vendorResult) => {
        stats.vendorCount = err ? 0 : vendorResult.vendorCount;

        db.get(
          "SELECT MIN(created_at) as firstUser FROM users",
          [],
          (err, dateResult) => {
            if (err || !dateResult.firstUser) {
              stats.daysSinceCreation = 0;
            } else {
              const firstUserDate = new Date(dateResult.firstUser);
              const currentDate = new Date();
              const timeDifference =
                currentDate.getTime() - firstUserDate.getTime();
              stats.daysSinceCreation = Math.max(
                0,
                Math.floor(timeDifference / (1000 * 3600 * 24)),
              );
            }
            callback(stats);
          },
        );
      },
    );
  });
}

// Function to check and handle expired orders
function checkExpiredOrders() {
  console.log("Checking for expired orders...");

  // Find orders that are still pending and past their auto-decline date
  const now = new Date();

  // First check if auto_decline_at column exists
  db.all("PRAGMA table_info(orders)", (err, columns) => {
    if (err) {
      console.error("Error checking orders table structure:", err);
      return;
    }

    const hasAutoDeclineAt = columns.some(
      (col) => col.name === "auto_decline_at",
    );

    if (!hasAutoDeclineAt) {
      console.log(
        "auto_decline_at column not found, skipping expired orders check",
      );
      return;
    }

    // Check pending orders for auto-decline
    db.all(
      `
      SELECT o.*, u.displayname as buyer_name, v.business_name as vendor_name
      FROM orders o
      JOIN users u ON o.buyer_id = u.id
      JOIN vendors v ON o.vendor_id = v.id
      WHERE o.status = 'pending' 
      AND o.auto_decline_at IS NOT NULL 
      AND o.auto_decline_at < ?
    `,
      [now.toISOString()],
      (err, expiredOrders) => {
        if (err) {
          console.error("Error checking expired orders:", err);
          return;
        }

        if (expiredOrders && expiredOrders.length > 0) {
          console.log(
            `Found ${expiredOrders.length} expired orders to auto-decline`,
          );

          expiredOrders.forEach((order) => {
            db.run(
              `
            UPDATE orders 
            SET status = 'auto_declined', vendor_response = 'Order automatically declined - no vendor response within 7 days', vendor_response_at = ? 
            WHERE id = ?
          `,
              [now.toISOString(), order.id],
              (err) => {
                if (err) {
                  console.error(`Error auto-declining order ${order.id}:`, err);
                } else {
                  console.log(
                    `Auto-declined order ${order.id} for buyer ${order.buyer_name}`,
                  );
                }
              },
            );
          });
        } else {
          console.log("No expired orders found");
        }
      },
    );

    // Check shipped orders for auto-completion (buyer deadline expired)
    db.all(
      `
      SELECT o.*, u.displayname as buyer_name, v.business_name as vendor_name
      FROM orders o
      JOIN users u ON o.buyer_id = u.id
      JOIN vendors v ON o.vendor_id = v.id
      WHERE o.status = 'shipped' 
      AND o.buyer_dispute_deadline IS NOT NULL 
      AND o.buyer_dispute_deadline < ?
    `,
      [now.toISOString()],
      (err, shippedExpiredOrders) => {
        if (err) {
          console.error("Error checking shipped expired orders:", err);
          return;
        }

        if (shippedExpiredOrders && shippedExpiredOrders.length > 0) {
          console.log(
            `Found ${shippedExpiredOrders.length} shipped orders past buyer deadline - auto-completing`,
          );

          shippedExpiredOrders.forEach((order) => {
            db.run(
              `
            UPDATE orders 
            SET status = 'completed', completed_at = ?, vendor_response = 'Auto-completed - buyer response deadline expired'
            WHERE id = ?
          `,
              [now.toISOString(), order.id],
              (err) => {
                if (err) {
                  console.error(
                    `Error auto-completing order ${order.id}:`,
                    err,
                  );
                } else {
                  console.log(
                    `Auto-completed order ${order.id} - buyer deadline expired`,
                  );
                }
              },
            );
          });
        } else {
          console.log("No shipped orders past buyer deadline found");
        }
      },
    );
  });
}

// Function to check and set inactive ve// Set vendors to vacation mode
function checkInactiveVendors() {
  console.log("Checking for inactive vendors...");

  // Find vendors who haven't logged in for 2 weeks (14 days)
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  db.all(
    `
    SELECT u.id as user_id, u.username, u.last_login, v.id as vendor_id, v.vacation_mode
    FROM users u
    JOIN vendors v ON u.id = v.user_id
    WHERE u.is_vendor = 1 
    AND (u.last_login IS NULL OR u.last_login < ?)
    AND v.vacation_mode = 0
  `,
    [twoWeeksAgo.toISOString()],
    (err, inactiveVendors) => {
      if (err) {
        console.error("Error checking inactive vendors:", err);
        return;
      }

      if (inactiveVendors && inactiveVendors.length > 0) {
        console.log(
          `Found ${inactiveVendors.length} inactive vendors to set to vacation mode`,
        );

        inactiveVendors.forEach((vendor) => {
          db.run(
            "UPDATE vendors SET vacation_mode = 1 WHERE user_id = ?",
            [vendor.user_id],
            (err) => {
              if (err) {
                console.error(
                  `Error setting vendor ${vendor.username} to vacation mode:`,
                  err,
                );
              } else {
                console.log(
                  `Set vendor ${vendor.username} to vacation mode due to inactivity`,
                );
              }
            },
          );
        });
      } else {
        console.log("No inactive vendors found");
      }
    },
  );
}

// Function to delete messages older than 2 weeks
function deleteOldMessages() {
  console.log("Checking for messages older than 2 weeks...");

  // Calculate date 2 weeks ago
  const twoWeeksAgo = new Date();
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

  // Delete messages older than 2 weeks
  db.run(
    `
    DELETE FROM messages 
    WHERE created_at < ?
  `,
    [twoWeeksAgo.toISOString()],
    function (err) {
      if (err) {
        console.error("Error deleting old messages:", err);
        return;
      }

      if (this.changes > 0) {
        console.log(`Deleted ${this.changes} old messages`);

        // Clean up empty message threads (threads with no messages)
        db.run(
          `
        DELETE FROM message_threads 
        WHERE id NOT IN (SELECT DISTINCT thread_id FROM messages)
      `,
          function (err) {
            if (err) {
              console.error("Error deleting empty message threads:", err);
            } else if (this.changes > 0) {
              console.log(`Deleted ${this.changes} empty message threads`);
            }
          },
        );
      } else {
        console.log("No old messages found to delete");
      }
    },
  );
}

// Run the inactive vendor check every hour
setInterval(checkInactiveVendors, 60 * 60 * 1000); // 1 hour in milliseconds

// Run the expired orders check every hour
// Function to check for expired orders
function checkExpiredOrders() {
  console.log("Checking for expired orders...");

  db.all(
    `
    SELECT * FROM orders 
    WHERE status = 'shipped' 
    AND shipped_at IS NOT NULL 
    AND datetime(shipped_at, '+14 days') < datetime('now')
  `,
    [],
    (err, expiredOrders) => {
      if (err) {
        console.error("Error checking expired orders:", err);
        return;
      }

      if (expiredOrders && expiredOrders.length > 0) {
        console.log(
          `Found ${expiredOrders.length} expired orders to auto-complete`,
        );
        expiredOrders.forEach((order) => {
          db.run(
            'UPDATE orders SET status = "completed" WHERE id = ?',
            [order.id],
            (err) => {
              if (err) {
                console.error(
                  `Error completing expired order ${order.id}:`,
                  err,
                );
              } else {
                console.log(`Auto-completed expired order ${order.id}`);
              }
            },
          );
        });
      } else {
        console.log("No expired orders found");
      }
    },
  );
}

setInterval(checkExpiredOrders, 60 * 60 * 1000); // 1 hour in milliseconds

// Run the old messages cleanup once daily (every 24 hours)
setInterval(deleteOldMessages, 24 * 60 * 60 * 1000); // 24 hours in milliseconds

// Run initial checks on server start
setTimeout(checkInactiveVendors, 5000); // Wait 5 seconds after server start
setTimeout(checkExpiredOrders, 7000); // Wait 7 seconds after server start

// Fetch XMR price every 2 hours (7200000 milliseconds)
setInterval(fetchXMRPrice, 2 * 60 * 60 * 1000);

// Fetch XMR price on server start
setTimeout(fetchXMRPrice, 3000); // Wait 3 seconds after server start

// Rules page
app.get("/rules", (req, res) => {
  res.render("pages/rules", getStandardRenderData(req));
});

// Stats page route (moved from home)
app.get("/stats", (req, res) => {
  getServerStats((stats) => {
    getXMRPrice((xmrData) => {
      res.render(
        "pages/index",
        getStandardRenderData(req, {
          stats: stats,
          xmrPrice: xmrData ? xmrData.price : null,
          xmrLastUpdated: xmrData ? xmrData.last_updated : null,
          error: req.query.error || null,
          success: req.query.success || null,
        }),
      );
    });
  });
});

// Home page route
app.get("/", (req, res) => {
  const productType = req.query.type;
  const category = req.query.category;
  const priceRange = req.query.priceRange;

  let categoryFilter = "";
  let typeFilter = "";
  let priceFilter = "";

  if (category && category !== "all") {
    categoryFilter = "AND p.category = ?";
  }

  if (productType && productType !== "all") {
    typeFilter = "AND p.product_type = ?";
  }

  if (priceRange && priceRange !== "all") {
    switch (priceRange) {
      case "0-25":
        priceFilter = "AND CAST(p.price AS REAL) < 25";
        break;
      case "25-50":
        priceFilter =
          "AND CAST(p.price AS REAL) >= 25 AND CAST(p.price AS REAL) <= 50";
        break;
      case "50-100":
        priceFilter =
          "AND CAST(p.price AS REAL) >= 50 AND CAST(p.price AS REAL) <= 100";
        break;
      case "100-250":
        priceFilter =
          "AND CAST(p.price AS REAL) >= 100 AND CAST(p.price AS REAL) <= 250";
        break;
      case "250-500":
        priceFilter =
          "AND CAST(p.price AS REAL) >= 250 AND CAST(p.price AS REAL) <= 500";
        break;
      case "500+":
        priceFilter = "AND CAST(p.price AS REAL) > 500";
        break;
    }
  }

  let query = `
    SELECT 
      p.*,
      v.business_name as vendor_name,
      v.avatar as vendor_avatar,
      v.country_flag as vendor_country_flag,
      v.shipping_from,
      v.shipping_to,
      v.is_trusted as vendor_is_trusted,
      u.displayname as vendor_displayname,
      u.username as vendor_username,
      u.is_trusted_vendor as user_is_trusted_vendor,
      ROUND(AVG(CASE WHEN vf.rating IS NOT NULL THEN vf.rating END), 1) as vendor_rating,
      COUNT(CASE WHEN vf.rating IS NOT NULL THEN 1 END) as rating_count,
      v.id as vendor_id
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
    LIMIT 50
  `;

  let params = [];
  if (category && category !== "all") {
    params.push(category);
  }
  if (productType && productType !== "all") {
    params.push(productType);
  }

  // Centralized rendering function to ensure consistent data
  const renderHomePage = (finalProducts) => {
    getServerStats((stats) => {
      getXMRPrice((xmrData) => {
        res.render(
          "pages/home",
          getStandardRenderData(req, {
            products: finalProducts || [],
            stats: stats,
            xmrPrice: xmrData ? xmrData.price : null,
            xmrLastUpdated: xmrData ? xmrData.last_updated : null,
            selectedCategory: category || "all",
            selectedType: productType || "all",
            selectedPriceRange: priceRange || "all",
            error: req.query.error || null,
            success: req.query.success || null,
          }),
        );
      });
    });
  };

  db.all(query, params, (err, products) => {
    if (err) {
      console.error("Error fetching products:", err);
      return renderHomePage([]);
    }

    if (!products || products.length === 0) {
      return renderHomePage([]);
    }

    // Parse image URLs for products
    products = products.map((product) => {
      if (product.image_urls) {
        try {
          product.images = JSON.parse(product.image_urls);
        } catch (e) {
          product.images = [];
        }
      } else {
        product.images = [];
      }
      return product;
    });

    // Fetch latest feedback for each vendor
    const productPromises = products.map((product) => {
      return new Promise((resolve) => {
        db.all(
          `
          SELECT 
            vf.feedback_text as comment, 
            vf.rating, 
            vf.created_at,
            u.displayname as buyer_name,
            u.username as buyer_username
          FROM vendor_feedback vf
          JOIN users u ON vf.buyer_id = u.id
          WHERE vf.vendor_id = ?
          ORDER BY vf.created_at DESC
          LIMIT 3
        `,
          [product.vendor_id],
          (err, feedback) => {
            if (err) {
              console.error("Error fetching vendor feedback:", err);
              product.latestFeedback = [];
            } else {
              product.latestFeedback = feedback || [];
            }
            resolve(product);
          },
        );
      });
    });

    Promise.all(productPromises)
      .then((updatedProducts) => {
        renderHomePage(updatedProducts);
      })
      .catch((err) => {
        console.error("Error in Promise.all:", err);
        renderHomePage(products);
      });
  });
});

// Import error handler
const errorHandler = require("./utils/errorHandler");

// 404 Error Handler - Must be after all other routes
app.use((req, res, next) => {
  res.status(404).render("pages/404", getStandardRenderData(req));
});

// Global error handler - Must be last
app.use(errorHandler.expressErrorHandler);

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

// Display banner after all initialization is complete
setTimeout(() => {
  // ASCII Art Banner
  console.log(
    "\x1b[32m%s\x1b[0m",
    `
  ██╗     ██╗██╗   ██╗███████╗
  ██║     ██║██║   ██║██╔════╝
  ██║     ██║██║   ██║█████╗  
  ██║     ██║╚██╗ ██╔╝██╔══╝  
  ███████╗██║ ╚████╔╝ ███████╗
  ╚══════╝╚═╝  ╚═══╝  ╚══════╝
  `,
  );
  console.log("\x1b[36m%s\x1b[0m", "🌟 Kevin's Corner Marketplace 🌟");
  console.log(
    "\x1b[33m%s\x1b[0m",
    `🚀 Server running on http://localhost:${PORT}`,
  );
  console.log(
    "\x1b[35m%s\x1b[0m",
    "📊 Status: LIVE and ready for connections!",
  );
  console.log("\x1b[37m%s\x1b[0m", "═".repeat(50));
}, 10000); // Display after 10 seconds to ensure all initialization is complete
