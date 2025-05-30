const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const db = require('../database/db');
const openpgp = require('openpgp');

// Centralized time utility
const timeUtils = {
  now: () => new Date().toISOString()
};

// Function to send welcome message to new users
function sendWelcomeMessage(userId, displayname) {
  // Find admin user (assuming admin has username 'admin')
  db.get('SELECT id, displayname FROM users WHERE username = ?', ['admin'], (err, admin) => {
    if (err || !admin) {
      console.error('Error finding admin user for welcome message:', err);
      return;
    }

    const welcomeContent = `Welcome to our marketplace, ${displayname}! 

We're excited to have you join our community. Here are some things you can do:

• Browse products from our verified vendors
• Create your own vendor account to start selling
• Join discussions in our community forums
• Use our secure messaging system to communicate with other users

If you have any questions or need help getting started, don't hesitate to reach out to our support team.

Happy shopping!
- The Marketplace Team`;

    // Check if thread already exists between admin and new user
    db.get(`
      SELECT id FROM message_threads 
      WHERE (participant1_id = ? AND participant2_id = ?) 
         OR (participant1_id = ? AND participant2_id = ?)
    `, [admin.id, userId, userId, admin.id], (err, existingThread) => {
      if (err) {
        console.error('Error checking for existing thread:', err);
        return;
      }

      if (existingThread) {
        // Use existing thread
        insertWelcomeMessage(existingThread.id, admin.id, admin.displayname, welcomeContent);
      } else {
        // Create new thread
        db.run(`
          INSERT INTO message_threads 
          (participant1_id, participant1_displayname, participant2_id, participant2_displayname, last_message_at)
          VALUES (?, ?, ?, ?, ?)
        `, [admin.id, admin.displayname, userId, displayname, timeUtils.now()], function(err) {
          if (err) {
            console.error('Error creating welcome message thread:', err);
            return;
          }

          insertWelcomeMessage(this.lastID, admin.id, admin.displayname, welcomeContent);
        });
      }
    });
  });
}

// Helper function to insert the welcome message
function insertWelcomeMessage(threadId, senderId, senderDisplayname, content) {
  db.run(`
    INSERT INTO messages 
    (thread_id, sender_id, sender_displayname, content, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, [threadId, senderId, senderDisplayname, content, timeUtils.now()], (err) => {
    if (err) {
      console.error('Error inserting welcome message:', err);
    } else {
      console.log('Welcome message sent successfully to new user');

      // Update thread last message time
      db.run(`
        UPDATE message_threads 
        SET last_message_at = ? 
        WHERE id = ?
      `, [timeUtils.now(), threadId], (err) => {
        if (err) {
          console.error('Error updating thread timestamp:', err);
        }
      });
    }
  });
}

// Helper function to encrypt challenge with user's public key
async function encryptChallenge(publicKeyArmored, message) {
  try {
    console.log('Attempting to read public key...');

    // Validate the public key format
    if (!publicKeyArmored.includes('-----BEGIN PGP PUBLIC KEY BLOCK-----')) {
      throw new Error('Public key must be in armored format (BEGIN PGP PUBLIC KEY BLOCK)');
    }

    const publicKey = await openpgp.readKey({ armoredKey: publicKeyArmored });
    console.log('Public key read successfully, key ID:', publicKey.getKeyID().toHex());

    const encrypted = await openpgp.encrypt({
      message: await openpgp.createMessage({ text: message }),
      encryptionKeys: publicKey
    });

    console.log('Encryption successful');
    return encrypted;
  } catch (error) {
    console.error('PGP encryption error details:', error);
    throw new Error('Failed to encrypt challenge: ' + error.message);
  }
}

// Login page
router.get('/login', (req, res) => {
  res.render('pages/login', { error: null });
});

// Registration page
router.get('/register', (req, res) => {
  res.render('pages/register', { error: null });
});

// Handle login
router.post('/login', (req, res) => {
  const { username, password, challengeResponse, challengeId } = req.body;

  db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
    if (err) {
      return res.render('pages/login', { error: 'Database error' });
    }

    if (!user) {
      return res.render('pages/login', { error: 'Invalid username or password' });
    }

    // Check if 2FA is enabled and this is a challenge response
    if (user.two_factor_enabled === 1 && user.public_key && challengeResponse && challengeId) {
      // For 2FA challenge responses, we've already validated the password in the initial request
      // Just verify the challenge response
        // Verify the challenge response
      db.get('SELECT * FROM twofa_challenges WHERE id = ? AND user_id = ? AND used = 0 AND expires_at > datetime("now")', 
        [challengeId, user.id], (err, challenge) => {
        if (err || !challenge) {
          return res.render('pages/login', { 
            error: 'Invalid or expired challenge. Please try again.',
            show2FA: false
          });
        }

        // Check if the decrypted message matches
        if (challengeResponse.trim() === challenge.challenge_text.trim()) {
            // Mark challenge as used
          db.run('UPDATE twofa_challenges SET used = 1 WHERE id = ?', [challengeId], (err) => {
            if (err) {
              console.error('Error marking challenge as used:', err);
            }
          });

          // Login successful - update last login
          db.run('UPDATE users SET last_login = ? WHERE id = ?', [user.id], (err) => {
            if (err) {
              console.error('Error updating last login:', err);
            }
          });

          req.session.userId = user.id;
          req.session.username = user.username;
          req.session.displayname = user.displayname;

          // Redirect vendors to their orders page
          if (user.is_vendor === 1) {
            res.redirect('/vendor/orders');
          } else {
            res.redirect('/');
          }
        } else {
          return res.render('pages/login', { 
            error: 'Incorrect decryption. Please try again.',
            show2FA: false
          });
        }
      });
    } else if (user.two_factor_enabled === 1 && user.public_key && !challengeResponse) {
      // Initial login with 2FA enabled - validate password first, then create challenge
      if (!password) {
        return res.render('pages/login', { error: 'Password is required' });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.render('pages/login', { error: 'Invalid username or password' });
      }
        // Generate 2FA challenge with real PGP encryption
      const crypto = require('crypto');
      const challengeText = crypto.randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

      // Check if user has a valid public key
      if (!user.public_key || user.public_key.trim() === '') {
        return res.render('pages/login', { error: 'No public key found. Please add your PGP public key in your profile settings first.' });
      }

      console.log('User public key (first 100 chars):', user.public_key.substring(0, 100));
      console.log('Challenge text to encrypt:', challengeText);

      // Encrypt challenge with user's public key
      encryptChallenge(user.public_key, challengeText)
        .then(encryptedChallenge => {
          console.log('Successfully encrypted challenge (first 200 chars):', encryptedChallenge.substring(0, 200));

          db.run('INSERT INTO twofa_challenges (user_id, challenge_text, encrypted_challenge, expires_at) VALUES (?, ?, ?, ?)',
            [user.id, challengeText, encryptedChallenge, expiresAt.toISOString()], function(err) {
            if (err) {
              console.error('Error creating 2FA challenge:', err);
              return res.render('pages/login', { error: 'Failed to create 2FA challenge' });
            }

            return res.render('pages/login', { 
              show2FA: true,
              challengeId: this.lastID,
              encryptedChallenge: encryptedChallenge,
              username: username,
              error: null
            });
          });
        })
        .catch(err => {
          console.error('Error encrypting challenge:', err);
          console.error('Error details:', err.message);

          // Fallback: if encryption fails, ask user to check their public key
          return res.render('pages/login', { 
            error: `PGP encryption failed: ${err.message}. Please verify your public key is valid and properly formatted in your profile settings.` 
          });
        });
    } else {
      // No 2FA, regular login - validate password first
      if (!password) {
        return res.render('pages/login', { error: 'Password is required' });
      }

      const isValidPassword = await bcrypt.compare(password, user.password);
      if (!isValidPassword) {
        return res.render('pages/login', { error: 'Invalid username or password' });
      }

      // Login successful - update last login
      db.run('UPDATE users SET last_login = ? WHERE id = ?', [user.id], (err) => {
        if (err) {
          console.error('Error updating last login:', err);
        }
      });

      req.session.userId = user.id;
      req.session.username = user.username;
      req.session.displayname = user.displayname;

      // Redirect vendors to their orders page
      if (user.is_vendor === 1) {
        res.redirect('/vendor/orders');
      } else {
        res.redirect('/');
      }
    }
  });
});

// Handle registration
router.post('/register', async (req, res) => {
  const { username, displayname, pin, confirmPin, password, confirmPassword } = req.body;

  // Check if all fields are provided
  if (!username || !displayname || !pin || !confirmPin || !password || !confirmPassword) {
    return res.render('pages/register', { error: 'All fields are required' });
  }

  // Convert username and displayname to lowercase
  const lowercaseUsername = username.toLowerCase();
  const lowercaseDisplayname = displayname.toLowerCase();

  if (password !== confirmPassword) {
    return res.render('pages/register', { error: 'Passwords do not match' });
  }

  if (pin !== confirmPin) {
    return res.render('pages/register', { error: 'PINs do not match' });
  }

  if (password.length < 6) {
    return res.render('pages/register', { error: 'Password must be at least 6 characters' });
  }

  if (pin.length < 4) {
    return res.render('pages/register', { error: 'PIN must be at least 4 characters' });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const hashedPin = await bcrypt.hash(pin, 10);

    db.run(
      'INSERT INTO users (username, displayname, pin, password, created_at, last_login) VALUES (?, ?, ?, ?, ?, ?)',
      [lowercaseUsername, lowercaseDisplayname, hashedPin, hashedPassword, timeUtils.now(), timeUtils.now()],
      function(err) {
        if (err) {
          console.error('Database error during registration:', err);
          if (err.message.includes('UNIQUE constraint failed')) {
            return res.render('pages/register', { error: 'Username already exists' });
          }
          return res.render('pages/register', { error: `Registration failed: ${err.message}` });
        }

        req.session.userId = this.lastID;
        req.session.username = lowercaseUsername;
        req.session.displayname = lowercaseDisplayname;

        // Send welcome message to new user
        sendWelcomeMessage(this.lastID, lowercaseDisplayname);

        res.redirect('/');
      });
  } catch (error) {
    console.error('Error during registration:', error);
    res.render('pages/register', { error: `Registration failed: ${error.message}` });
  }
});

// Logout (both GET and POST)
router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }
    res.redirect('/auth/login');
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error('Session destruction error:', err);
    }
    res.redirect('/auth/login');
  });
});

module.exports = router;