// ============================================================
// db/connection.js - PostgreSQL 接続管理（Heroku 環境対応）
// ============================================================

const { Pool } = require('pg');

// Heroku の DATABASE_URL から接続情報を自動取得
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// テスト接続
pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL 接続成功');
    client.release();
  })
  .catch(err => {
    console.error('❌ PostgreSQL 接続エラー:');
    console.error(`   ${err.message}`);
    console.error('   環境変数を確認してください');
  });

module.exports = pool;