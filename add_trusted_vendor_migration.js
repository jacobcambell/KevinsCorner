
const db = require('./database/db');

console.log('Adding trusted vendor columns...');

// Add is_trusted_vendor column to users table
db.run(`ALTER TABLE users ADD COLUMN is_trusted_vendor INTEGER DEFAULT 0`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding is_trusted_vendor to users:', err.message);
  } else {
    console.log('✓ Added is_trusted_vendor column to users table');
  }
});

// Add is_trusted column to vendors table  
db.run(`ALTER TABLE vendors ADD COLUMN is_trusted INTEGER DEFAULT 0`, (err) => {
  if (err && !err.message.includes('duplicate column name')) {
    console.error('Error adding is_trusted to vendors:', err.message);
  } else {
    console.log('✓ Added is_trusted column to vendors table');
  }
});

console.log('Migration completed!');
