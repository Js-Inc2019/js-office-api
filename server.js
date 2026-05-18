// ============================================================
// J's Inc. 勤務管理システム - バックエンド API
// server.js - メインサーバー
// ============================================================

const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ============================================================
// PostgreSQL 接続
// ============================================================

const pool = require('./db/connection');

console.log('ℹ️  PostgreSQL 接続初期化完了');

// ============================================================
// DB接続確認のみ（スキーマ自動実行・DROP TABLE は廃止）
// ※ テーブル変更は migrate_v2.js で手動実行すること
// ============================================================

(async () => {
  try {
    const client = await pool.connect();
    const result = await client.query('SELECT COUNT(*) FROM users');
    console.log(`✅ DB接続確認完了 - ユーザー数: ${result.rows[0].count}`);
    client.release();
  } catch (err) {
    console.error('❌ DB接続確認エラー:', err.message);
  }
})();

// ============================================================
// ミドルウェア・ルートのインポート
// ============================================================

const { authenticateToken } = require('./middleware/auth');
const authRoutes      = require('./routes/auth');
const reportRoutes    = require('./routes/reports');
const revisionRoutes  = require('./routes/revisions');
const auditRoutes     = require('./routes/audit');
const companyRoutes   = require('./routes/companies');
const siteRoutes      = require('./routes/sites');
const shareRoutes     = require('./routes/shares');

// ============================================================
// Express アプリ初期化
// ============================================================

const app = express();

// ============================================================
// グローバルミドルウェア
// ============================================================

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS || '*',
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// ============================================================
// ヘルスチェック
// ============================================================

app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
    database: 'connected'
  });
});

// ============================================================
// API ルート
// ============================================================

// 既存ルート
app.use('/api/v1/auth',        authRoutes);
app.use('/api/v1/reports',     authenticateToken, reportRoutes);
app.use('/api/v1/revisions',   authenticateToken, revisionRoutes);
app.use('/api/v1/audit-logs',  authenticateToken, auditRoutes);

// 新規ルート（v2拡張）
app.use('/api/v1/companies',   authenticateToken, companyRoutes);
app.use('/api/v1/sites',       authenticateToken, siteRoutes);
app.use('/api/v1/shares',      authenticateToken, shareRoutes);

console.log('✅ API ルートが有効化されました（v2拡張含む）');

// ============================================================
// エラーハンドリング
// ============================================================

app.use((req, res) => {
  res.status(404).json({
    error: 'エンドポイントが見つかりません',
    path: req.path,
    method: req.method
  });
});

// ============================================================
// サーバー起動
// ============================================================

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  console.log(`
  ========================================
  J's Inc. 勤務管理システム API v2.0.0
  ========================================
  サーバー起動: http://${HOST}:${PORT}
  環境: ${process.env.NODE_ENV || 'development'}
  ========================================
  `);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

module.exports = { app };