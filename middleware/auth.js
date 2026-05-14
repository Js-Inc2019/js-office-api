// ============================================================
// middleware/auth.js - 認証・認可ミドルウェア
// ============================================================

const jwt = require('jsonwebtoken');
require('dotenv').config();

// ============================================================
// JWT トークン認証
// ============================================================

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: '認証トークンが必要です',
      code: 'NO_TOKEN'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'トークンの有効期限が切れました',
          code: 'TOKEN_EXPIRED',
          expiredAt: err.expiredAt
        });
      }
      return res.status(403).json({
        error: 'トークンが無効です',
        code: 'INVALID_TOKEN'
      });
    }

    req.user = user;
    next();
  });
};

// ============================================================
// ロールベースアクセス制御（RBAC）
// ============================================================

const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'ユーザー情報がありません',
        code: 'NO_USER'
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: 'このアクションを実行する権限がありません',
        code: 'FORBIDDEN',
        required_role: allowedRoles,
        user_role: req.user.role
      });
    }

    next();
  };
};

// ============================================================
// ロール定義
// ============================================================

const ROLES = {
  WORKER: 'worker',
  BOSS: 'boss',
  ADMIN_OFFICE: 'admin_office',
  ADMIN_EXEC: 'admin_exec'
};

// ============================================================
// ロールごとのアクセス制御リスト
// ============================================================

const ACL = {
  'view_reports': [ROLES.BOSS, ROLES.ADMIN_OFFICE, ROLES.ADMIN_EXEC],
  'edit_own_report': [ROLES.WORKER, ROLES.BOSS],
  'request_revision': [ROLES.BOSS, ROLES.ADMIN_OFFICE, ROLES.ADMIN_EXEC],
  'approve_revision': [ROLES.BOSS, ROLES.ADMIN_OFFICE],
  'view_monthly_summary': [ROLES.BOSS, ROLES.ADMIN_OFFICE, ROLES.ADMIN_EXEC],
  'export_csv': [ROLES.ADMIN_OFFICE, ROLES.ADMIN_EXEC],
  'view_audit_logs': [ROLES.ADMIN_OFFICE, ROLES.ADMIN_EXEC],
  'manage_users': [ROLES.ADMIN_EXEC],
  'manage_settings': [ROLES.ADMIN_EXEC]
};

// ============================================================
// アクション権限チェック
// ============================================================

const checkPermission = (action) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'ユーザー情報がありません',
        code: 'NO_USER'
      });
    }

    const allowedRoles = ACL[action] || [];
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        error: `「${action}」を実行する権限がありません`,
        code: 'PERMISSION_DENIED',
        action: action,
        user_role: req.user.role
      });
    }

    next();
  };
};

// ============================================================
// デバイス ID 検証
// ============================================================

const verifyDeviceId = (req, res, next) => {
  const deviceId = req.body.device_id || req.query.device_id;

  if (!deviceId) {
    return res.status(400).json({
      error: 'デバイスIDが必要です',
      code: 'MISSING_DEVICE_ID'
    });
  }

  req.deviceId = deviceId;
  next();
};

// ============================================================
// エクスポート
// ============================================================

module.exports = {
  authenticateToken,
  requireRole,
  checkPermission,
  verifyDeviceId,
  ROLES,
  ACL
};