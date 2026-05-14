// ============================================================
// db/connection.js - MySQL 接続管理（スタブ）
// ============================================================

// 開発段階ではダミー接続を返す
class MockPool {
  async getConnection() {
    return new MockConnection();
  }
}

class MockConnection {
  async query(sql, params) {
    console.log(`[Mock Query] ${sql}`);
    return [[], []];
  }

  async release() {
    // ダミー実装
  }
}

const pool = new MockPool();

console.log('✅ Mock データベース接続（開発用）');

module.exports = pool;
