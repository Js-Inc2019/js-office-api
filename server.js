// ============================================================
// J's Inc. 勤務管理システム - バックエンド API
// server.js - メインサーバー
// ============================================================

const express = require('express');
const cors = require('cors');
require('dotenv').config();

// ルートのインポート
const authRoutes = require('./routes/auth');
const reportRoutes = require('./routes/reports');
const revisionRoutes = require('./routes/revisions');
const auditRoutes = require('./routes/audit');

// ミドルウェアのインポート
const { authenticateToken } = require('./middleware/auth');

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
    version: '1.0.0'
  });
});

// ============================================================
// API ルート（← app.listen() の BEFORE！）
// ============================================================

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/reports', authenticateToken, reportRoutes);
app.use('/api/v1/revisions', authenticateToken, revisionRoutes);
app.use('/api/v1/audit-logs', authenticateToken, auditRoutes);

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
// サーバー起動（← 最後！）
// ============================================================

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || 'localhost';

const server = app.listen(PORT, HOST, () => {
  console.log(`
  ========================================
  J's Inc. 勤務管理システム API
  ========================================
  サーバー起動: http://${HOST}:${PORT}
  環境: ${process.env.NODE_ENV || 'development'}
  ========================================
  `);
});

module.exports = { app };