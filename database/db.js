const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'marketplace.db');

// Enhanced database connection with error handling
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Critical: Error opening database:', err.message);
    console.error('Database path:', dbPath);
    process.exit(1); // Exit if can't connect to database
  } else {
    console.log('Connected to SQLite database');
    console.log('Database path:', dbPath);

    // Set database pragmas for better performance and error handling
    db.run('PRAGMA foreign_keys = ON');
    db.run('PRAGMA journal_mode = WAL');
    db.run('PRAGMA synchronous = NORMAL');
    db.run('PRAGMA cache_size = 1000');
    db.run('PRAGMA temp_store = MEMORY');
  }
});

// Handle database errors
db.on('error', (err) => {
  console.error('Database error occurred:', err);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT. Gracefully closing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  console.log('Received SIGTERM. Gracefully closing database connection...');
  db.close((err) => {
    if (err) {
      console.error('Error closing database:', err.message);
    } else {
      console.log('Database connection closed.');
    }
    process.exit(0);
  });
});

// Create tables if they don't exist
db.serialize(() => {
  if (true) {
    console.log("Setting up database tables");

    // Create tables if they don't exist
    db.run(
      `
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        displayname TEXT NOT NULL,
        pin TEXT NOT NULL,
        password TEXT NOT NULL,
        created_at TIMESTAMP
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating users table:", err);
        } else {
          // Check if displayname column exists, if not add it
          db.all("PRAGMA table_info(users)", (err, columns) => {
            if (err) {
              console.error("Error checking table structure:", err);
              return;
            }

            const hasDisplayname = columns.some(
              (col) => col.name === "displayname",
            );
            const hasPin = columns.some((col) => col.name === "pin");
            const hasPassword = columns.some((col) => col.name === "password");

            if (!hasDisplayname) {
              db.run(
                "ALTER TABLE users ADD COLUMN displayname TEXT DEFAULT ''",
                (err) => {
                  if (err) {
                    console.error("Error adding displayname column:", err);
                  } else {
                    console.log("Added displayname column to users table");
                  }
                },
              );
            }

            if (!hasPin) {
              db.run(
                "ALTER TABLE users ADD COLUMN pin TEXT DEFAULT ''",
                (err) => {
                  if (err) {
                    console.error("Error adding pin column:", err);
                  } else {
                    console.log("Added pin column to users table");
                  }
                },
              );
            }

            if (!hasPassword) {
              db.run(
                "ALTER TABLE users ADD COLUMN password TEXT DEFAULT ''",
                (err) => {
                  if (err) {
                    console.error("Error adding password column:", err);
                  } else {
                    console.log("Added password column to users table");
                  }
                },
              );
            }

            // Remove email column if it exists
            const hasEmail = columns.some((col) => col.name === "email");
            if (hasEmail) {
              db.serialize(() => {
                db.run(
                  "CREATE TABLE users_new (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL UNIQUE, displayname TEXT NOT NULL, pin TEXT NOT NULL, password TEXT NOT NULL, created_at TIMESTAMP)",
                );
                db.run(
                  "INSERT INTO users_new (id, username, displayname, pin, password, created_at) SELECT id, username, displayname, pin, password, created_at FROM users",
                );
                db.run("DROP TABLE users");
                db.run("ALTER TABLE users_new RENAME TO users");
                console.log("Removed email column from users table");
              });
            }
          });
        }
      },
    );

    // Check if is_vendor column exists in users table, if not add it
    db.all("PRAGMA table_info(users)", (err, columns) => {
      if (err) {
        console.error("Error checking users table structure:", err);
        return;
      }

      const hasIsVendor = columns.some((col) => col.name === "is_vendor");
      const hasIsBanned = columns.some((col) => col.name === "is_banned");
      const hasBanReason = columns.some((col) => col.name === "ban_reason");

      if (!hasIsVendor) {
        db.run(
          "ALTER TABLE users ADD COLUMN is_vendor INTEGER DEFAULT 0",
          (err) => {
            if (err) {
              console.error("Error adding is_vendor column:", err);
            } else {
              console.log("Added is_vendor column to users table");
            }
          },
        );
      }

      if (!hasIsBanned) {
        db.run(
          "ALTER TABLE users ADD COLUMN is_banned INTEGER DEFAULT 0",
          (err) => {
            if (err) {
              console.error("Error adding is_banned column:", err);
            } else {
              console.log("Added is_banned column to users table");
            }
          },
        );
      }

      if (!hasBanReason) {
        db.run(
          "ALTER TABLE users ADD COLUMN ban_reason TEXT DEFAULT NULL",
          (err) => {
            if (err) {
              console.error("Error adding ban_reason column:", err);
            } else {
              console.log("Added ban_reason column to users table");
            }
          },
        );
      }

      const hasPublicKey = columns.some((col) => col.name === "public_key");
      const hasTwoFactorEnabled = columns.some(
        (col) => col.name === "two_factor_enabled",
      );
      const hasLastLogin = columns.some((col) => col.name === "last_login");

      if (!hasPublicKey) {
        db.run(
          "ALTER TABLE users ADD COLUMN public_key TEXT DEFAULT NULL",
          (err) => {
            if (err) {
              console.error("Error adding public_key column:", err);
            } else {
              console.log("Added public_key column to users table");
            }
          },
        );
      }

      if (!hasTwoFactorEnabled) {
        db.run(
          "ALTER TABLE users ADD COLUMN two_factor_enabled INTEGER DEFAULT 0",
          (err) => {
            if (err) {
              console.error("Error adding two_factor_enabled column:", err);
            } else {
              console.log("Added two_factor_enabled column to users table");
            }
          },
        );
      }

      if (!hasLastLogin) {
        db.run("ALTER TABLE users ADD COLUMN last_login TIMESTAMP", (err) => {
          if (err) {
            console.error("Error adding last_login column:", err);
          } else {
            console.log("Added last_login column to users table");
            // Update existing users to have current timestamp as last login
            db.run(
              "UPDATE users SET last_login = datetime('now') WHERE last_login IS NULL",
              (err) => {
                if (err) {
                  console.error(
                    "Error updating existing users last_login:",
                    err,
                  );
                } else {
                  console.log(
                    "Updated existing users with last_login timestamp",
                  );
                }
              },
            );
          }
        });
      }

      db.run(
        `ALTER TABLE users ADD COLUMN preferred_currency TEXT DEFAULT 'USD'`,
        (err) => {
          if (err && !err.message.includes("duplicate column name")) {
            console.error("Error adding preferred_currency column:", err);
          }
        },
      );

      // Add is_trusted_vendor column to users table
      db.run(
        `ALTER TABLE users ADD COLUMN is_trusted_vendor INTEGER DEFAULT 0`,
        (err) => {
          if (err && !err.message.includes("duplicate column name")) {
            console.error("Error adding is_trusted_vendor column:", err);
          } else if (!err) {
            console.log("Added is_trusted_vendor column to users table");
          }
        },
      );
    });

    // Create vendor_applications table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS vendor_applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        business_name TEXT NOT NULL,
        contact_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL,
        business_address TEXT NOT NULL,
        business_type TEXT NOT NULL,
        years_in_business TEXT,
        product_categories TEXT NOT NULL,
        business_description TEXT NOT NULL,
        website TEXT,
        social_media TEXT,
        agree_marketing INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP,
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating vendor_applications table:", err);
        } else {
          console.log("Vendor applications table ready");
        }
      },
    );

    // Create vendor invite codes table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS vendor_invite_codes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        is_used INTEGER DEFAULT 0,
        used_by INTEGER,
        created_by INTEGER,
        created_at TIMESTAMP,
        used_at TIMESTAMP,
        FOREIGN KEY (used_by) REFERENCES users(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating vendor_invite_codes table:", err);
        } else {
          console.log("Vendor invite codes table ready");
        }
      },
    );

    // Create vendors table for approved vendors
    db.run(
      `
    CREATE TABLE IF NOT EXISTS vendors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE NOT NULL,
      business_name TEXT NOT NULL,
      business_description TEXT,
      shipping_from TEXT,
      shipping_to TEXT,
      vacation_mode INTEGER DEFAULT 0,
      avatar TEXT,
      vendor_type TEXT DEFAULT 'full',
      created_at DATETIME,
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    )
  `,
      (err) => {
        if (err) {
          console.error("Error creating vendors table:", err);
        } else {
          console.log("Vendors table ready");

          // Add avatar column if it doesn't exist (for existing databases)
          db.run(`ALTER TABLE vendors ADD COLUMN avatar TEXT`, (err) => {
            if (err && !err.message.includes("duplicate column name")) {
              console.error("Error adding avatar column:", err);
            }
          });

          // Add vendor_type column if it doesn't exist
          db.run(`ALTER TABLE vendors ADD COLUMN vendor_type TEXT DEFAULT 'full'`, (err) => {
            if (err && !err.message.includes("duplicate column name")) {
              console.error("Error adding vendor_type column:", err);
            } else {
              console.log("Added vendor_type column to vendors table");
            }
          });

          // Add country_flag column if it doesn't exist
          db.run(`ALTER TABLE vendors ADD COLUMN country_flag TEXT`, (err) => {
            if (err && !err.message.includes("duplicate column name")) {
              console.error("Error adding country_flag column:", err);
            } else {
              console.log("Added country_flag column to vendors table");
            }
          });

          // Add is_trusted column if it doesn't exist
          db.run(`ALTER TABLE vendors ADD COLUMN is_trusted INTEGER DEFAULT 0`, (err) => {
            if (err && !err.message.includes("duplicate column name")) {
              console.error("Error adding is_trusted column:", err);
            } else {
              console.log("Added is_trusted column to vendors table");
            }
          });
        }
      },
    );

    // Create support messages table (main threads)
    db.run(
      `
      CREATE TABLE IF NOT EXISTS support_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        displayname TEXT NOT NULL,
        subject TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT DEFAULT 'open',
        admin_response TEXT,
        created_at TIMESTAMP,
        responded_at TIMESTAMP,
        last_activity TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating support_messages table:", err);
        } else {
          console.log("Support messages table ready");

          db.serialize(() => {
            // Check table structure
            db.all("PRAGMA table_info(support_messages)", (err, columns) => {
              if (err) {
                console.error(
                  "Error checking support_messages table structure:",
                  err,
                );
                return;
              }

              const hasAdminResponse = columns.some(
                (col) => col.name === "admin_response",
              );
              const hasRespondedAt = columns.some(
                (col) => col.name === "responded_at",
              );
              const hasLastActivity = columns.some(
                (col) => col.name === "last_activity",
              );

              // Add last_activity column if missing
              if (!hasLastActivity) {
                db.run(
                  "ALTER TABLE support_messages ADD COLUMN last_activity TIMESTAMP",
                  (err) => {
                    if (err) {
                      console.error("Error adding last_activity column:", err);
                    } else {
                      console.log(
                        "Added last_activity column to support_messages table",
                      );
                      // Update existing records to have last_activity = created_at
                      db.run(
                        "UPDATE support_messages SET last_activity = created_at WHERE last_activity IS NULL",
                        (err) => {
                          if (err) {
                            console.error(
                              "Error updating last_activity for existing records:",
                              err,
                            );
                          } else {
                            console.log(
                              "Updated existing records with last_activity",
                            );
                          }
                        },
                      );
                    }
                  },
                );
              }

              // Migrate old admin responses if they exist
              if (hasAdminResponse || hasRespondedAt) {
                db.all(
                  "SELECT * FROM support_messages WHERE admin_response IS NOT NULL",
                  [],
                  (err, oldMessages) => {
                    if (err) {
                      console.error("Error querying old admin responses:", err);
                      return;
                    }
                    if (!oldMessages || oldMessages.length === 0) {
                      console.log("No old admin responses to migrate");
                      return;
                    }

                    console.log(
                      `Migrating ${oldMessages.length} old admin responses...`,
                    );
                    oldMessages.forEach((msg) => {
                      if (msg.admin_response) {
                        db.run(
                          `INSERT INTO support_message_replies 
                       (message_id, sender_type, sender_id, sender_name, reply_text, created_at) 
                       VALUES (?, ?, ?, ?, ?, ?)`,
                          [
                            msg.id,
                            "admin",
                            1,
                            "admin",
                            msg.admin_response,
                            msg.responded_at || new Date().toISOString(),
                          ],
                          (err) => {
                            if (err) {
                              console.error(
                                "Error migrating admin response:",
                                err,
                              );
                            } else {
                              db.run(
                                "UPDATE support_messages SET status = ?, last_activity = ? WHERE id = ?",
                                [
                                  "responded",
                                  msg.responded_at || new Date().toISOString(),
                                  msg.id,
                                ],
                                (err) => {
                                  if (err) {
                                    console.error(
                                      "Error updating support message status:",
                                      err,
                                    );
                                  }
                                },
                              );
                            }
                          },
                        );
                      }
                    });
                  },
                );
              }
            });
          });
        }
      },
    );

    // Create support message replies table (for threading)
    db.run(
      `
      CREATE TABLE IF NOT EXISTS support_message_replies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id INTEGER NOT NULL,
        sender_type TEXT NOT NULL, -- 'user' or 'admin'
        sender_id INTEGER NOT NULL,
        sender_name TEXT NOT NULL,
        reply_text TEXT NOT NULL,
        created_at TIMESTAMP,
        FOREIGN KEY (message_id) REFERENCES support_messages (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating support_message_replies table:", err);
        } else {
          console.log("Support message replies table ready");
        }
      },
    );

    // Create 2FA challenges table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS twofa_challenges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        challenge_text TEXT NOT NULL,
        encrypted_challenge TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        used INTEGER DEFAULT 0,
        created_at TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating twofa_challenges table:", err);
        } else {
          console.log("2FA challenges table ready");
        }
      },
    );

    // Create message threads table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS message_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        participant1_id INTEGER NOT NULL,
        participant1_displayname TEXT NOT NULL,
        participant2_id INTEGER NOT NULL,
        participant2_displayname TEXT NOT NULL,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP,
        FOREIGN KEY (participant1_id) REFERENCES users (id),
        FOREIGN KEY (participant2_id) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating message_threads table:", err);
        } else {
          console.log("Message threads table ready");
        }
      },
    );

    // Create messages table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        sender_id INTEGER NOT NULL,
        sender_displayname TEXT NOT NULL,
        content TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES message_threads (id),
        FOREIGN KEY (sender_id) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating messages table:", err);
        } else {
          console.log("Messages table ready");
        }
      },
    );

    // Create products table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor_id INTEGER NOT NULL,
        product_type TEXT NOT NULL CHECK (product_type IN ('physical', 'digital')),
        name TEXT NOT NULL,
        description TEXT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        currency TEXT DEFAULT 'USD',
        category TEXT NOT NULL,
        stock_quantity INTEGER DEFAULT 0,
        digital_file_url TEXT,
        download_limit INTEGER,
        shipping_weight DECIMAL(8,2),
        shipping_dimensions TEXT,
        shipping_required INTEGER DEFAULT 0,
        image_urls TEXT, -- JSON array of image URLs
        status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft')),
        created_at TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (vendor_id) REFERENCES vendors (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating products table:", err);
        } else {
          console.log("Products table ready");

          // Check if image_urls column exists, if not add it
          db.all("PRAGMA table_info(products)", (err, columns) => {
            if (err) {
              console.error("Error checking products table structure:", err);
              return;
            }

            const hasImageUrls = columns.some(
              (col) => col.name === "image_urls",
            );

            if (!hasImageUrls) {
              db.run(
                "ALTER TABLE products ADD COLUMN image_urls TEXT",
                (err) => {
                  if (err)
                    console.error("Error adding image_urls column:", err);
                  else console.log("Added image_urls column to products table");
                },
              );
            }
          });
        }
      },
    );

    // Create digital product details table for dynamic content
    db.run(
      `
      CREATE TABLE IF NOT EXISTS digital_product_details (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        product_id INTEGER NOT NULL,
        content_type TEXT NOT NULL CHECK (content_type IN ('download_link', 'account_info', 'text_content')),
        download_url TEXT,
        download_password TEXT,
        account_username TEXT,
        account_password TEXT,
        account_email TEXT,
        additional_info TEXT,
        instructions TEXT,
        created_at TIMESTAMP,
        FOREIGN KEY (product_id) REFERENCES products (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating digital_product_details table:", err);
        } else {
          console.log("Digital product details table ready");
        }
      },
    );

    // Create orders table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        buyer_id INTEGER NOT NULL,
        vendor_id INTEGER NOT NULL,
        product_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        currency TEXT DEFAULT 'USD',
        status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'completed', 'cancelled', 'refunded', 'auto_declined')),
        payment_method TEXT,
        transaction_id TEXT,
        digital_content_delivered INTEGER DEFAULT 0,
        delivery_details TEXT,
        vendor_response TEXT,
        vendor_response_at TIMESTAMP,
        auto_decline_at TIMESTAMP,
        created_at TIMESTAMP,
        completed_at TIMESTAMP,
        FOREIGN KEY (buyer_id) REFERENCES users (id),
        FOREIGN KEY (vendor_id) REFERENCES vendors (id),
        FOREIGN KEY (product_id) REFERENCES products (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating orders table:", err);
        } else {
          console.log("Orders table ready");

          // Add new columns for vendor response system
          db.all("PRAGMA table_info(orders)", (err, columns) => {
            if (err) {
              console.error("Error checking orders table structure:", err);
              return;
            }

            const hasVendorResponse = columns.some(
              (col) => col.name === "vendor_response",
            );
            const hasVendorResponseAt = columns.some(
              (col) => col.name === "vendor_response_at",
            );
            const hasAutoDeclineAt = columns.some(
              (col) => col.name === "auto_decline_at",
            );

            if (!hasVendorResponse) {
              db.run(
                "ALTER TABLE orders ADD COLUMN vendor_response TEXT",
                (err) => {
                  if (err)
                    console.error("Error adding vendor_response column:", err);
                  else
                    console.log("Added vendor_response column to orders table");
                },
              );
            }

            if (!hasVendorResponseAt) {
              db.run(
                "ALTER TABLE orders ADD COLUMN vendor_response_at TIMESTAMP",
                (err) => {
                  if (err)
                    console.error(
                      "Error adding vendor_response_at column:",
                      err,
                    );
                  else
                    console.log(
                      "Added vendor_response_at column to orders table",
                    );
                },
              );
            }

            if (!hasAutoDeclineAt) {
              db.run(
                "ALTER TABLE orders ADD COLUMN auto_decline_at TIMESTAMP",
                (err) => {
                  if (err)
                    console.error("Error adding auto_decline_at column:", err);
                  else
                    console.log("Added auto_decline_at column to orders table");
                },
              );
            }
          });

          // Add vendor_id and vendor info columns to orders table if they don't exist
          db.all("PRAGMA table_info(orders)", (err, columns) => {
            if (err) {
              console.error("Error checking orders table structure:", err);
              return;
            }

            const columnNames = columns.map((col) => col.name);
            const missingColumns = [];

            if (!columnNames.includes("vendor_id")) {
              missingColumns.push("vendor_id INTEGER");
            }
            if (!columnNames.includes("vendor_username")) {
              missingColumns.push("vendor_username TEXT");
            }
            if (!columnNames.includes("vendor_displayname")) {
              missingColumns.push("vendor_displayname TEXT");
            }
            if (!columnNames.includes("dispute_resolution")) {
              missingColumns.push("dispute_resolution TEXT");
            }
            if (!columnNames.includes("resolution_notes")) {
              missingColumns.push("resolution_notes TEXT");
            }
            if (!columnNames.includes("resolved_at")) {
              missingColumns.push("resolved_at TIMESTAMP");
            }
            if (!columnNames.includes("resolved_by")) {
              missingColumns.push("resolved_by INTEGER");
            }

            // Add order_number column if it doesn't exist
            if (!columnNames.includes("order_number")) {
              missingColumns.push("order_number TEXT");
            }

            // Add buyer and vendor info columns if they don't exist
            if (!columnNames.includes("buyer_username")) {
              missingColumns.push("buyer_username TEXT");
            }
            if (!columnNames.includes("buyer_displayname")) {
              missingColumns.push("buyer_displayname TEXT");
            }

            // Add missing columns
            missingColumns.forEach((column, index) => {
              db.run(`ALTER TABLE orders ADD COLUMN ${column}`, (err) => {
                if (err) {
                  console.error(
                    `Error adding column ${column} to orders table:`,
                    err,
                  );
                } else {
                  console.log(`Added column ${column} to orders table`);

                  // If we just added order_number, populate it for existing orders
                  if (column.includes("order_number")) {
                    db.run(
                      `UPDATE orders SET order_number = 'ORD-' || id WHERE order_number IS NULL`,
                      (err) => {
                        if (err) {
                          console.error(
                            "Error updating existing order numbers:",
                            err,
                          );
                        } else {
                          console.log(
                            "Updated existing orders with order numbers",
                          );
                        }
                      },
                    );
                  }

                  // Populate buyer and vendor info for existing orders
                  if (
                    column.includes("buyer_username") ||
                    column.includes("buyer_displayname") ||
                    column.includes("vendor_username") ||
                    column.includes("vendor_displayname")
                  ) {
                    db.run(
                      `UPDATE orders SET 
                        buyer_username = (SELECT username FROM users WHERE id = orders.buyer_id),
                        buyer_displayname = (SELECT displayname FROM users WHERE id = orders.buyer_id),
                        vendor_username = (SELECT username FROM users WHERE id = orders.vendor_id),
                        vendor_displayname = (SELECT displayname FROM users WHERE id = orders.vendor_id)
                        WHERE buyer_username IS NULL OR vendor_username IS NULL`,
                      (err) => {
                        if (err) {
                          console.error(
                            "Error updating existing order user info:",
                            err,
                          );
                        } else {
                          console.log(
                            "Updated existing orders with user information",
                          );
                        }
                      },
                    );
                  }
                }
              });
            });
          });

          // Force recreation of orders table with correct constraint
                console.log('Checking orders table constraint...');

                // Always recreate the table to ensure proper constraint
                console.log('Recreating orders table with correct constraint...');

                db.serialize(() => {
                  // Create new table with updated constraint and all columns
                  db.run(`CREATE TABLE IF NOT EXISTS orders_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    buyer_id INTEGER NOT NULL,
                    vendor_id INTEGER NOT NULL,
                    product_id INTEGER NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 1,
                    unit_price DECIMAL(10,2),
                    total_price DECIMAL(10, 2) NOT NULL,
                    currency TEXT DEFAULT 'USD',
                    shipping_address TEXT,
                    special_instructions TEXT,
                    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'auto_declined', 'processing', 'shipped', 'completed', 'received', 'disputed', 'cancelled', 'refunded')),
                    payment_method TEXT,
                    transaction_id TEXT,
                    digital_content_delivered INTEGER DEFAULT 0,
                    delivery_details TEXT,
                    order_number TEXT UNIQUE,
                    vendor_response TEXT,
                    vendor_response_at TIMESTAMP,
                    auto_decline_at TIMESTAMP,
                    created_at TIMESTAMP,
                    completed_at TIMESTAMP,
                    buyer_username TEXT,
                    buyer_displayname TEXT,
                    vendor_username TEXT,
                    vendor_displayname TEXT,
                    received_at TIMESTAMP,
                    disputed_at TIMESTAMP,
                    dispute_reason TEXT,
                    feedback_given INTEGER DEFAULT 0,
                    dispute_resolution TEXT,
                    resolution_notes TEXT,
                    resolved_at TIMESTAMP,
                    resolved_by INTEGER,
                    last_viewed_at TIMESTAMP,
                    shipped_at TIMESTAMP,
                    buyer_dispute_deadline TIMESTAMP,
                    FOREIGN KEY (buyer_id) REFERENCES users (id),
                    FOREIGN KEY (vendor_id) REFERENCES vendors (id),
                    FOREIGN KEY (product_id) REFERENCES products (id)
                  )`, (err) => {
                    if (err) {
                      console.error('Error creating new orders table:', err);
                      return;
                    }

                    // Check if we need to migrate data
                    db.all("SELECT name FROM sqlite_master WHERE type='table' AND name='orders'", (err, tables) => {
                      if (err) {
                        console.error('Error checking for existing orders table:', err);
                        return;
                      }

                      if (tables.length > 0) {
                        // First check which columns exist in the original table
                        db.all("PRAGMA table_info(orders)", (err, columns) => {
                          if (err) {
                            console.error('Error checking orders table columns:', err);
                            return;
                          }

                          const columnNames = columns.map(col => col.name);
                          console.log('Existing columns in orders table:', columnNames);

                          // Build dynamic SELECT query based on existing columns
                          const selectColumns = [];
                          const insertColumns = [];

                          // Core columns that should always exist
                          const coreColumns = [
                            'id', 'buyer_id', 'vendor_id', 'product_id', 'quantity',
                            'total_price', 'status', 'created_at'
                          ];

                          // Optional columns with defaults
                          const optionalColumns = [
                            { name: 'unit_price', default: 'NULL' },
                            { name: 'currency', default: "'USD'" },
                            { name: 'order_number', default: "'ORD-' || id" },
                            { name: 'vendor_response', default: 'NULL' },
                            { name: 'vendor_response_at', default: 'NULL' },
                            { name: 'auto_decline_at', default: 'NULL' },
                            { name: 'buyer_username', default: 'NULL' },
                            { name: 'buyer_displayname', default: 'NULL' },
                            { name: 'vendor_username', default: 'NULL' },
                            { name: 'vendor_displayname', default: 'NULL' },
                            { name: 'completed_at', default: 'NULL' },
                            { name: 'received_at', default: 'NULL' },
                            { name: 'disputed_at', default: 'NULL' },
                            { name: 'dispute_reason', default: 'NULL' },
                            { name: 'feedback_given', default: '0' },
                            { name: 'dispute_resolution', default: 'NULL' },
                            { name: 'resolution_notes', default: 'NULL' },
                            { name: 'resolved_at', default: 'NULL' },
                            { name: 'resolved_by', default: 'NULL' }
                          ];

                          // Add core columns
                          coreColumns.forEach(col => {
                            if (columnNames.includes(col)) {
                              selectColumns.push(col);
                              insertColumns.push(col);
                            }
                          });

                          // Add optional columns
                          optionalColumns.forEach(col => {
                            insertColumns.push(col.name);
                            if (columnNames.includes(col.name)) {
                              if (col.name === 'currency'){
                                selectColumns.push(`COALESCE(${col.name}, 'USD') as ${col.name}`);
                              } else if (col.name === 'order_number') {
                                selectColumns.push(`COALESCE(${col.name}, 'ORD-' || id) as ${col.name}`);
                              } else if (col.name === 'feedback_given') {
                                selectColumns.push(`COALESCE(${col.name}, 0) as ${col.name}`);
                              } else {
                                selectColumns.push(col.name);
                              }
                            } else {
                              selectColumns.push(`${col.default} as ${col.name}`);
                            }
                          });

                          const insertQuery = `INSERT OR IGNORE INTO orders_new (${insertColumns.join(', ')}) 
                                             SELECT ${selectColumns.join(', ')} FROM orders`;

                          console.log('Migration query:', insertQuery);

                          // Copy data from old table
                          db.run(insertQuery, (err) => {
                            if (err) {
                              console.error('Error copying orders data:', err);
                              return;
                            }

                            console.log('Data copied successfully, dropping old table...');

                            // Drop old table and rename new one
                            db.run("DROP TABLE orders", (err) => {
                              if (err) {
                                console.error('Error dropping old orders table:', err);
                                return;
                              }

                              db.run("ALTER TABLE orders_new RENAME TO orders", (err) => {
                                if (err) {
                                  console.error('Error renaming orders table:', err);
                                } else {
                                  console.log('Orders table recreated with correct status constraint successfully');
                                }
                              });
                            });
                          });
                        });
                      } else {
                        // No existing table, just rename the new one
                        db.run("ALTER TABLE orders_new RENAME TO orders", (err) => {
                          if (err) {
                            console.error('Error renaming new orders table:', err);
                          } else {
                            console.log('New orders table created successfully');
                          }
                        });
                      }
                    });
                  });
                });
        }
      },
    );

    // Create cryptocurrency prices table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS crypto_prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL UNIQUE,
        price DECIMAL(15,8) NOT NULL,
        currency TEXT DEFAULT 'USD',
        last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating crypto_prices table:", err);
        } else {
          console.log("Crypto prices table ready");
        }
      },
    );

    // Create forum categories table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS forum_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating forum_categories table:", err);
        } else {
          console.log("Forum categories table ready");

          // Insert default "News" category if it doesn't exist
          db.get(
            "SELECT id FROM forum_categories WHERE name = ?",
            ["News"],
            (err, row) => {
              if (!err && !row) {
                // Create admin user if doesn't exist for the default category
                db.get(
                  "SELECT id FROM users WHERE username = ?",
                  ["admin"],
                  (err, adminUser) => {
                    const adminId = adminUser ? adminUser.id : 1; // fallback to id 1 if admin doesn't exist
                    db.run(
                      "INSERT INTO forum_categories (name, description, created_by) VALUES (?, ?, ?)",
                      ["News", "Official news and announcements", adminId],
                      (err) => {
                        if (err) {
                          console.error(
                            "Error creating default News category:",
                            err,
                          );
                        } else {
                          console.log("Created default News forum category");
                        }
                      },
                    );
                  },
                );
              }
            },
          );
        }
      },
    );

    // Create forum threads table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS forum_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        created_by_username TEXT NOT NULL,
        created_by_displayname TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        is_locked INTEGER DEFAULT 0,
        reply_count INTEGER DEFAULT 0,
        last_reply_at TIMESTAMP,
        created_at TIMESTAMP,
        FOREIGN KEY (category_id) REFERENCES forum_categories (id),
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating forum_threads table:", err);
        } else {
          console.log("Forum threads table ready");
        }
      },
    );

    // Create forum posts table (replies to threads)
    db.run(
      `
      CREATE TABLE IF NOT EXISTS forum_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        created_by_username TEXT NOT NULL,
        created_by_displayname TEXT NOT NULL,
        created_at TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES forum_threads (id),
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating forum_posts table:", err);
        } else {
          console.log("Forum posts table ready");
        }
      },
    );

    // Create website directory table for URL search
    db.run(
      `
      CREATE TABLE IF NOT EXISTS website_directory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        keywords TEXT NOT NULL,
        description TEXTTEXT,
        created_by INTEGER NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating website_directory table:", err);
        } else {
          console.log("Website directory table ready");
        }
      },
    );

    // Create vendor feedback table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS vendor_feedback (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        order_id INTEGER NOT NULL,
        vendor_id INTEGER NOT NULL,
        buyer_id INTEGER NOT NULL,
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        feedback_text TEXT,
        created_at TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders (id),
        FOREIGN KEY (vendor_id) REFERENCES vendors (id),
        FOREIGN KEY (buyer_id) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating vendor_feedback table:", err);
        } else {
          console.log("Vendor feedback table ready");
        }
      },
    );

    // Create forum banners table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS forum_banners (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        image_url TEXT,
        link_url TEXT,
        is_active INTEGER DEFAULT 1,
        display_order INTEGER DEFAULT 0,
        created_by INTEGER NOT NULL,
        created_at TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating forum_banners table:", err);
        } else {
          console.log("Forum banners table ready");
        }
      },
    );

    // Create vendor forum threads table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS vendor_forum_threads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        created_by_username TEXT NOT NULL,
        created_by_displayname TEXT NOT NULL,
        is_pinned INTEGER DEFAULT 0,
        is_locked INTEGER DEFAULT 0,
        reply_count INTEGER DEFAULT 0,
        last_reply_at TIMESTAMP,
        created_at TIMESTAMP,
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating vendor_forum_threads table:", err);
        } else {
          console.log("Vendor forum threads table ready");
        }
      },
    );

    // Create vendor forum posts table
    db.run(
      `
      CREATE TABLE IF NOT EXISTS vendor_forum_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        content TEXT NOT NULL,
        created_by INTEGER NOT NULL,
        created_by_username TEXT NOT NULL,
        created_by_displayname TEXT NOT NULL,
        created_at TIMESTAMP,
        FOREIGN KEY (thread_id) REFERENCES vendor_forum_threads (id),
        FOREIGN KEY (created_by) REFERENCES users (id)
      )
    `,
      (err) => {
        if (err) {
          console.error("Error creating vendor_forum_posts table:", err);
        } else {
          console.log("Vendor forum posts table ready");
        }
      },
    );

    // Create vendor applications table
    db.run(`CREATE TABLE IF NOT EXISTS vendor_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_name TEXT NOT NULL,
    contact_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    business_address TEXT NOT NULL,
    business_type TEXT NOT NULL,
    years_in_business TEXT,
    product_categories TEXT NOT NULL,
    business_description TEXT NOT NULL,
    website TEXT,
    social_media TEXT,
    agree_marketing INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending',
    created_at TIMESTAMP,
    reviewed_at TIMESTAMP,
    reviewed_by INTEGER
  )
`, (err) => {
    if (err) {
      console.error('Error creating vendor_applications table:', err);
    } else {
      console.log('Vendor applications table ready');
    }
  });

  // Create promoted products table
  db.run(`CREATE TABLE IF NOT EXISTS promoted_products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL,
    vendor_id INTEGER NOT NULL,
    order_id INTEGER,
    category TEXT NOT NULL,
    created_at TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    FOREIGN KEY (product_id) REFERENCES products(id),
    FOREIGN KEY (vendor_id) REFERENCES vendors(id),
    FOREIGN KEY (order_id) REFERENCES orders(id)
  )`, (err) => {
    if (err) {
      console.error('Error creating promoted products table:', err);
    } else {
      console.log('Promoted products table ready');
    }
  });
  }
});

module.exports = db;