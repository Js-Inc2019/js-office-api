// ============================================================
// db/connection.js - PostgreSQL 接続管理（Heroku 環境対応）
// ============================================================

const { Pool } = require('pg');

// Heroku の DATABASE_URL から接続情報を自動取得
// または手動で環境変数から設定
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  // フォールバック設定
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

// テスト接続
pool.connect()
  .then(client => {
    console.log('✅ PostgreSQL 接続成功');
    console.log(`   ホスト: ${client._clientConfig.host || 'Heroku'}`);
    console.log(`   データベース: ${client._clientConfig.database}`);
    client.release();
  })
  .catch(err => {
    console.error('❌ PostgreSQL 接続エラー:');
    console.error(`   ${err.message}`);
    console.error('   環境変数を確認してください');
    // 本番環境では exit しない（起動を続ける）
    // process.exit(1);
  });

module.exports = pool;