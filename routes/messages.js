
const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Helper function to get unread message count for a user
function getUnreadMessageCount(userId, callback) {
  db.get(`
    SELECT COUNT(*) as unread_count
    FROM messages m
    JOIN message_threads mt ON m.thread_id = mt.id
    WHERE (mt.participant1_id = ? OR mt.participant2_id = ?)
    AND m.sender_id != ?
    AND m.is_read = 0
  `, [userId, userId, userId], (err, result) => {
    if (err) {
      console.error('Error getting unread message count:', err);
      callback(0);
    } else {
      callback(result ? result.unread_count : 0);
    }
  });
}

// PIN verification page for message center
router.get('/verify-pin', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  res.render('pages/message-pin-verify', {
    user: {
      id: req.session.userId,
      username: req.session.username,
      displayname: req.session.displayname,
      isVendor: req.session.isVendor || false
    },
    error: req.query.error
  });
});

// Handle PIN verification
router.post('/verify-pin', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const { pin } = req.body;

  if (!pin) {
    return res.redirect('/messages/verify-pin?error=PIN is required');
  }

  // Get user's PIN from database
  const bcrypt = require('bcrypt');
  db.get('SELECT pin FROM users WHERE id = ?', [req.session.userId], async (err, user) => {
    if (err || !user) {
      return res.redirect('/messages/verify-pin?error=Database error');
    }

    try {
      const isValidPin = await bcrypt.compare(pin, user.pin);
      if (!isValidPin) {
        return res.redirect('/messages/verify-pin?error=Invalid PIN');
      }

      // PIN verified, set session flag and redirect to message center
      req.session.pinVerifiedForMessages = true;
      req.session.pinVerificationTime = Date.now();
      res.redirect('/messages');
    } catch (error) {
      console.error('Error verifying PIN:', error);
      res.redirect('/messages/verify-pin?error=PIN verification failed');
    }
  });
});

// Message center - view all conversations
router.get('/', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if PIN has been verified recently (within 1 hour)
  const currentTime = Date.now();
  const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
  
  if (!req.session.pinVerifiedForMessages || 
      !req.session.pinVerificationTime || 
      (currentTime - req.session.pinVerificationTime) > oneHour) {
    return res.redirect('/messages/verify-pin');
  }

  // Get all threads where user is a participant
  db.all(`
    SELECT 
      mt.*,
      CASE 
        WHEN mt.participant1_id = ? THEN mt.participant2_displayname
        ELSE mt.participant1_displayname
      END as other_participant,
      CASE 
        WHEN mt.participant1_id = ? THEN mt.participant2_id
        ELSE mt.participant1_id
      END as other_participant_id,
      (SELECT content FROM messages WHERE thread_id = mt.id ORDER BY created_at DESC LIMIT 1) as last_message,
      (SELECT COUNT(*) FROM messages WHERE thread_id = mt.id AND sender_id != ? AND is_read = 0) as unread_count
    FROM message_threads mt
    WHERE mt.participant1_id = ? OR mt.participant2_id = ?
    ORDER BY mt.last_message_at DESC
  `, [req.session.userId, req.session.userId, req.session.userId, req.session.userId, req.session.userId], (err, threads) => {
    if (err) {
      console.error('Error fetching message threads:', err);
      threads = [];
    }

    res.render('pages/message-center', {
      threads: threads || [],
      user: {
        id: req.session.userId,
        username: req.session.username,
        displayname: req.session.displayname,
        isVendor: req.session.isVendor || false
      },
      error: req.query.error,
      success: req.query.success
    });
  });
});

// Start new conversation
router.post('/new', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const { recipient_displayname, message_content, pin } = req.body;

  if (!recipient_displayname || !message_content) {
    return res.redirect('/messages?error=Please provide recipient and message content');
  }

  if (!pin) {
    return res.redirect('/messages?error=PIN is required to send messages');
  }

  // Verify PIN
  const bcrypt = require('bcrypt');
  
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT pin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) reject(err);
        else resolve(user);
      });
    });

    if (!user) {
      return res.redirect('/messages?error=User not found');
    }

    const isValidPin = await bcrypt.compare(pin, user.pin);
    if (!isValidPin) {
      return res.redirect('/messages?error=Invalid PIN');
    }
  } catch (error) {
    console.error('Error verifying PIN:', error);
    return res.redirect('/messages?error=PIN verification failed');
  }

  // Find recipient by displayname
  db.get('SELECT id, displayname FROM users WHERE displayname = ?', [recipient_displayname], (err, recipient) => {
    if (err || !recipient) {
      return res.redirect('/messages?error=User not found');
    }

    if (recipient.id === req.session.userId) {
      return res.redirect('/messages?error=Cannot send message to yourself');
    }

    // Check if thread already exists between these users
    db.get(`
      SELECT id FROM message_threads 
      WHERE (participant1_id = ? AND participant2_id = ?) 
      OR (participant1_id = ? AND participant2_id = ?)
    `, [req.session.userId, recipient.id, recipient.id, req.session.userId], (err, existingThread) => {
      if (err) {
        console.error('Error checking existing thread:', err);
        return res.redirect('/messages?error=Database error');
      }

      if (existingThread) {
        // Thread exists, add message to it
        db.run(`
          INSERT INTO messages (thread_id, sender_id, sender_displayname, content)
          VALUES (?, ?, ?, ?)
        `, [existingThread.id, req.session.userId, req.session.displayname, message_content], function(err) {
          if (err) {
            console.error('Error sending message:', err);
            return res.redirect('/messages?error=Failed to send message');
          }

          // Update thread last message time
          db.run('UPDATE message_threads SET last_message_at = ? WHERE id = ?', 
            [new Date().toISOString(), existingThread.id], (err) => {
            if (err) console.error('Error updating thread timestamp:', err);
            res.redirect(`/messages/thread/${existingThread.id}?success=message_sent`);
          });
        });
      } else {
        // Create new thread
        db.run(`
          INSERT INTO message_threads (participant1_id, participant1_displayname, participant2_id, participant2_displayname)
          VALUES (?, ?, ?, ?)
        `, [req.session.userId, req.session.displayname, recipient.id, recipient.displayname], function(err) {
          if (err) {
            console.error('Error creating thread:', err);
            return res.redirect('/messages?error=Failed to create conversation');
          }

          const threadId = this.lastID;

          // Add first message
          db.run(`
            INSERT INTO messages (thread_id, sender_id, sender_displayname, content)
            VALUES (?, ?, ?, ?)
          `, [threadId, req.session.userId, req.session.displayname, message_content], function(err) {
            if (err) {
              console.error('Error sending first message:', err);
              return res.redirect('/messages?error=Failed to send message');
            }

            res.redirect(`/messages/thread/${threadId}?success=message_sent`);
          });
        });
      }
    });
  });
});

// View specific thread
router.get('/thread/:id', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  // Check if PIN has been verified recently (within 1 hour)
  const currentTime = Date.now();
  const oneHour = 60 * 60 * 1000; // 1 hour in milliseconds
  
  if (!req.session.pinVerifiedForMessages || 
      !req.session.pinVerificationTime || 
      (currentTime - req.session.pinVerificationTime) > oneHour) {
    return res.redirect('/messages/verify-pin');
  }

  const threadId = req.params.id;

  // Verify user is participant in this thread
  db.get(`
    SELECT * FROM message_threads 
    WHERE id = ? AND (participant1_id = ? OR participant2_id = ?)
  `, [threadId, req.session.userId, req.session.userId], (err, thread) => {
    if (err || !thread) {
      return res.redirect('/messages?error=Thread not found or access denied');
    }

    // Get all messages in thread
    db.all(`
      SELECT * FROM messages 
      WHERE thread_id = ? 
      ORDER BY created_at ASC
    `, [threadId], (err, messages) => {
      if (err) {
        console.error('Error fetching messages:', err);
        messages = [];
      }

      // Mark messages as read for current user
      db.run('UPDATE messages SET is_read = 1 WHERE thread_id = ? AND sender_id != ?', 
        [threadId, req.session.userId], (err) => {
        if (err) console.error('Error marking messages as read:', err);
      });

      // Determine other participant
      const otherParticipant = thread.participant1_id === req.session.userId 
        ? { id: thread.participant2_id, displayname: thread.participant2_displayname }
        : { id: thread.participant1_id, displayname: thread.participant1_displayname };

      res.render('pages/message-thread', {
        thread: thread,
        messages: messages || [],
        otherParticipant: otherParticipant,
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname,
          isVendor: req.session.isVendor || false
        },
        error: req.query.error,
        success: req.query.success
      });
    });
  });
});

// Send message to existing thread
router.post('/thread/:id/reply', async (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const threadId = req.params.id;
  const { message_content, pin } = req.body;

  if (!message_content || typeof message_content !== 'string' || message_content.trim().length === 0) {
    return res.redirect(`/messages/thread/${threadId}?error=Message cannot be empty`);
  }

  if (!pin) {
    return res.redirect(`/messages/thread/${threadId}?error=PIN is required to send messages`);
  }

  // Verify PIN
  const bcrypt = require('bcrypt');
  
  try {
    const user = await new Promise((resolve, reject) => {
      db.get('SELECT pin FROM users WHERE id = ?', [req.session.userId], (err, user) => {
        if (err) reject(err);
        else resolve(user);
      });
    });

    if (!user) {
      return res.redirect(`/messages/thread/${threadId}?error=User not found`);
    }

    const isValidPin = await bcrypt.compare(pin, user.pin);
    if (!isValidPin) {
      return res.redirect(`/messages/thread/${threadId}?error=Invalid PIN`);
    }
  } catch (error) {
    console.error('Error verifying PIN:', error);
    return res.redirect(`/messages/thread/${threadId}?error=PIN verification failed`);
  }

  // Verify user is participant in this thread
  db.get(`
    SELECT * FROM message_threads 
    WHERE id = ? AND (participant1_id = ? OR participant2_id = ?)
  `, [threadId, req.session.userId, req.session.userId], (err, thread) => {
    if (err || !thread) {
      return res.redirect('/messages?error=Thread not found or access denied');
    }

    // Add message
    db.run(`
      INSERT INTO messages (thread_id, sender_id, sender_displayname, content)
      VALUES (?, ?, ?, ?)
    `, [threadId, req.session.userId, req.session.displayname, message_content.trim()], function(err) {
      if (err) {
        console.error('Error sending message:', err);
        return res.redirect(`/messages/thread/${threadId}?error=Failed to send message`);
      }

      // Update thread last message time
      db.run('UPDATE message_threads SET last_message_at = ? WHERE id = ?', 
        [new Date().toISOString(), threadId], (err) => {
        if (err) console.error('Error updating thread timestamp:', err);
        res.redirect(`/messages/thread/${threadId}?success=message_sent`);
      });
    });
  });
});

// Delete a specific message (user can only delete their own messages)
router.post('/message/:id/delete', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const messageId = req.params.id;

  // Get the message and verify ownership
  db.get('SELECT * FROM messages WHERE id = ? AND sender_id = ?', 
    [messageId, req.session.userId], (err, message) => {
    if (err || !message) {
      return res.redirect('/messages?error=Message not found or access denied');
    }

    const threadId = message.thread_id;

    // Delete the message
    db.run('DELETE FROM messages WHERE id = ?', [messageId], function(err) {
      if (err) {
        console.error('Error deleting message:', err);
        return res.redirect(`/messages/thread/${threadId}?error=Failed to delete message`);
      }

      // Update thread's last_message_at if this was the last message
      db.get('SELECT MAX(created_at) as last_message FROM messages WHERE thread_id = ?', 
        [threadId], (err, result) => {
        if (!err && result && result.last_message) {
          db.run('UPDATE message_threads SET last_message_at = ? WHERE id = ?', 
            [result.last_message, threadId], (err) => {
            if (err) console.error('Error updating thread timestamp:', err);
          });
        }
        
        res.redirect(`/messages/thread/${threadId}?success=Message deleted successfully`);
      });
    });
  });
});

// Delete entire conversation (user must be a participant)
router.post('/thread/:id/delete', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }

  const threadId = req.params.id;

  // Verify user is participant in this thread
  db.get(`
    SELECT * FROM message_threads 
    WHERE id = ? AND (participant1_id = ? OR participant2_id = ?)
  `, [threadId, req.session.userId, req.session.userId], (err, thread) => {
    if (err || !thread) {
      return res.redirect('/messages?error=Thread not found or access denied');
    }

    // Delete all messages in the thread first
    db.run('DELETE FROM messages WHERE thread_id = ?', [threadId], function(err) {
      if (err) {
        console.error('Error deleting messages:', err);
        return res.redirect(`/messages/thread/${threadId}?error=Failed to delete conversation`);
      }

      // Delete the thread itself
      db.run('DELETE FROM message_threads WHERE id = ?', [threadId], function(err) {
        if (err) {
          console.error('Error deleting thread:', err);
          return res.redirect(`/messages/thread/${threadId}?error=Failed to delete conversation`);
        }

        res.redirect('/messages?success=Conversation deleted successfully');
      });
    });
  });
});

module.exports = router;
module.exports.getUnreadMessageCount = getUnreadMessageCount;
