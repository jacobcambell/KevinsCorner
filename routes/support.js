
const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Support contact page
router.get('/contact', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }
  
  res.render('pages/support-contact', { 
    user: {
      id: req.session.userId,
      username: req.session.username,
      displayname: req.session.displayname
    },
    error: req.query.error,
    success: req.query.success
  });
});

// Handle support message submission
router.post('/contact', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }
  
  const { subject, message } = req.body;
  
  if (!subject || !message) {
    return res.redirect('/support/contact?error=Please fill in all fields');
  }
  
  db.run(`INSERT INTO support_messages (user_id, username, displayname, subject, message) 
          VALUES (?, ?, ?, ?, ?)`, 
    [req.session.userId, req.session.username, req.session.displayname, subject, message], 
    function(err) {
      if (err) {
        console.error('Error submitting support message:', err);
        return res.redirect('/support/contact?error=Failed to send message');
      }
      
      res.redirect('/support/contact?success=Message sent successfully! Admin will respond soon.');
    }
  );
});

// View user's support messages
router.get('/messages', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }
  
  db.all('SELECT * FROM support_messages WHERE user_id = ? ORDER BY last_activity DESC', 
    [req.session.userId], (err, messages) => {
    if (err) {
      console.error('Error fetching support messages:', err);
      return res.render('pages/support-messages', { 
        messages: [],
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
      return res.render('pages/support-messages', { 
        messages: [],
        user: {
          id: req.session.userId,
          username: req.session.username,
          displayname: req.session.displayname
        }
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
          res.render('pages/support-messages', { 
            messages: messagesWithReplies,
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

// Reply to a support message
router.post('/messages/:id/reply', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }
  
  const messageId = req.params.id;
  const { reply_text } = req.body;
  
  if (!reply_text) {
    return res.redirect('/support/messages?error=Reply cannot be empty');
  }
  
  // Verify the message belongs to the user
  db.get('SELECT * FROM support_messages WHERE id = ? AND user_id = ?', 
    [messageId, req.session.userId], (err, message) => {
    if (err || !message) {
      return res.redirect('/support/messages?error=Message not found');
    }
    
    // Add the reply
    db.run(`INSERT INTO support_message_replies 
            (message_id, sender_type, sender_id, sender_name, reply_text) 
            VALUES (?, ?, ?, ?, ?)`,
      [messageId, 'user', req.session.userId, req.session.displayname, reply_text],
      function(err) {
        if (err) {
          console.error('Error adding reply:', err);
          return res.redirect('/support/messages?error=Failed to send reply');
        }
        
        // Update message status and last activity
        db.run('UPDATE support_messages SET status = ?, last_activity = ? WHERE id = ?',
          ['open', new Date().toISOString(), messageId], (err) => {
          if (err) {
            console.error('Error updating message status:', err);
          }
          res.redirect('/support/messages?success=Reply sent successfully');
        });
      }
    );
  });
});

// Delete a support message (user can only delete their own messages)
router.post('/messages/:id/delete', (req, res) => {
  if (!req.session.userId) {
    return res.redirect('/auth/login');
  }
  
  const messageId = req.params.id;
  
  // Verify the message belongs to the user
  db.get('SELECT * FROM support_messages WHERE id = ? AND user_id = ?', 
    [messageId, req.session.userId], (err, message) => {
    if (err || !message) {
      return res.redirect('/support/messages?error=Message not found or access denied');
    }
    
    // Delete all replies first
    db.run('DELETE FROM support_message_replies WHERE message_id = ?', [messageId], (err) => {
      if (err) {
        console.error('Error deleting message replies:', err);
        return res.redirect('/support/messages?error=Failed to delete message');
      }
      
      // Delete the main message
      db.run('DELETE FROM support_messages WHERE id = ?', [messageId], (err) => {
        if (err) {
          console.error('Error deleting support message:', err);
          return res.redirect('/support/messages?error=Failed to delete message');
        }
        
        res.redirect('/support/messages?success=Message deleted successfully');
      });
    });
  });
});

module.exports = router;
