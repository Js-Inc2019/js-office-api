const pool = require('./connection');

async function seedUsers() {
  try {
    const pinHash = '$2a$10$YR20H2pjh3KVHqkr/LmDcer8sqfVINTM78Z3S3z0xeB5JYt8T507e';
    
    const result = await pool.query(
      `INSERT INTO users (device_id, name, company, role, pin_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING user_id, device_id, name`,
      ['test-device-001', 'Test User', 'J\'s Inc', 'admin', pinHash, true]
    );
    
    console.log('User created:', result.rows[0]);
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

seedUsers();