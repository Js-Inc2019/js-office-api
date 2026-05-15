const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

const pool = new Pool({
  connectionString: 'postgresql://postgres:password@js-office-api-prod-9ae070ebc5ba.herokuapp.com:5432/js_awake_db',
  ssl: { rejectUnauthorized: false },
});

async function seedUser() {
  try {
    console.log('デフォルトユーザーを作成中...');

    const user_id = uuidv4();
    const pin_hash = await bcrypt.hash('1234', 10);

    await pool.query(
      `INSERT INTO users (user_id, name, company, role, pin_hash, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [user_id, 'テスト太郎', 'J\'s Inc.', 'worker', pin_hash, true]
    );

    console.log('✅ デフォルトユーザーを作成しました');
    console.log('ユーザーID:', user_id);
    console.log('名前: テスト太郎');
    console.log('PIN: 1234');

    process.exit(0);
  } catch (error) {
    console.error('エラー詳細:', error);
    console.error('メッセージ:', error.message);
    process.exit(1);
  }
}

seedUser();