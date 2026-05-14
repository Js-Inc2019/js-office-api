// ============================================================
// db/connection.js - MySQL 接続管理（本番版）
// ============================================================

const mysql = require('mysql2/promise');

// MySQL コネクションプール作成
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'test_db',
  port: parseInt(process.env.DB_PORT || '3306'),
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),
  queueLimit: 0,
  timezone: '+09:00'
});

// テスト接続
pool.getConnection()
  .then(connection => {
    console.log('✅ MySQL 接続成功');
    console.log(`   ホスト: ${process.env.DB_HOST}`);
    console.log(`   データベース: ${process.env.DB_NAME}`);
    connection.release();
  })
  .catch(err => {
    console.error('❌ MySQL 接続エラー:');
    console.error(`   ${err.message}`);
    console.error('   環境変数を確認してください');
    process.exit(1);
  });

module.exports = pool;