
const db = require('./database/db');

console.log('=== DEBUGGING USER-ORDER RELATIONSHIPS ===');

// Check all users first
db.all('SELECT * FROM users ORDER BY id', [], (err, users) => {
  if (err) {
    console.error('Error fetching users:', err);
    return;
  }
  
  console.log('\n--- ALL USERS ---');
  users.forEach(user => {
    console.log(`- User ID: ${user.id}, Username: ${user.username}, Display: ${user.displayname}, Is Vendor: ${user.is_vendor}`);
  });
  
  // Check all vendors
  db.all('SELECT * FROM vendors ORDER BY id', [], (err, vendors) => {
    if (err) {
      console.error('Error fetching vendors:', err);
      return;
    }
    
    console.log('\n--- ALL VENDORS ---');
    vendors.forEach(vendor => {
      console.log(`- Vendor ID: ${vendor.id}, User ID: ${vendor.user_id}, Business: ${vendor.business_name}`);
    });
    
    // Check all orders with detailed info
    db.all(`
      SELECT 
        o.*,
        buyer.username as buyer_username,
        buyer.displayname as buyer_displayname,
        vendor_user.username as vendor_username,
        vendor_user.displayname as vendor_displayname,
        v.business_name,
        p.name as product_name
      FROM orders o
      LEFT JOIN users buyer ON o.buyer_id = buyer.id
      LEFT JOIN vendors v ON o.vendor_id = v.id
      LEFT JOIN users vendor_user ON v.user_id = vendor_user.id
      LEFT JOIN products p ON o.product_id = p.id
      ORDER BY o.id
    `, [], (err, orders) => {
      if (err) {
        console.error('Error fetching orders:', err);
        return;
      }
      
      console.log('\n--- ALL ORDERS WITH RELATIONSHIPS ---');
      if (orders.length > 0) {
        orders.forEach(order => {
          console.log(`Order ID: ${order.id}`);
          console.log(`  Buyer: ID=${order.buyer_id}, Username=${order.buyer_username}, Display=${order.buyer_displayname}`);
          console.log(`  Vendor: ID=${order.vendor_id}, User_ID=${order.vendor_user ? vendor_user.id : 'N/A'}, Username=${order.vendor_username}, Business=${order.business_name}`);
          console.log(`  Product: ${order.product_name || order.product_id}`);
          console.log(`  Status: ${order.status}`);
          console.log(`  Created: ${order.created_at}`);
          console.log('---');
        });
      } else {
        console.log('No orders found in database');
      }
      
      // Now test the exact query that's failing
      console.log('\n--- TESTING BUYER QUERY FOR USER 1 ---');
      db.all(`
        SELECT 
          o.*,
          COALESCE(p.name, 'Product #' || o.product_id) as product_name,
          COALESCE(p.product_type, 'unknown') as product_type,
          COALESCE(p.description, '') as product_description,
          COALESCE(v.business_name, 'Unknown Vendor') as vendor_name,
          COALESCE(u.displayname, 'Unknown Vendor') as vendor_displayname
        FROM orders o
        LEFT JOIN products p ON o.product_id = p.id
        LEFT JOIN vendors v ON o.vendor_id = v.id
        LEFT JOIN users u ON v.user_id = u.id
        WHERE o.buyer_id = ?
        ORDER BY o.created_at DESC
      `, [1], (err, buyerOrders) => {
        if (err) {
          console.error('Error in buyer query:', err);
        } else {
          console.log(`Found ${buyerOrders.length} orders for buyer ID 1`);
          buyerOrders.forEach(order => {
            console.log(`  - Order ${order.id}: ${order.product_name}, Status: ${order.status}`);
          });
        }
        
        console.log('\n=== DEBUG COMPLETE ===');
        process.exit(0);
      });
    });
  });
});
