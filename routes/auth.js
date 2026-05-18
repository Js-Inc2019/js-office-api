// ============================================================
// routes/auth.js - 認証ルート
// 全ユーザーPIN認証・company_id・role対応
// ============================================================

const express = require('express');
const router  = express.Router();
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');
const pool    = require('../db/connection');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// ============================================================
// POST /api/v1/auth/register - ユーザー登録
// ============================================================

router.post('/register', async (req, res) => {
  try {
    const { name, phone_number, email, pin, device_name, device_type, os_type } = req.body;

    if (!name || !pin || !device_name || !device_type) {
      return res.status(400).json({
        error: '必須フィールドが不足しています',
        code: 'MISSING_FIELDS',
        required: ['name', 'pin', 'device_name', 'device_type']
      });
    }

    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({
        error: 'PINは4〜6桁の数字である必要があります',
        code: 'INVALID_PIN_FORMAT'
      });
    }

    const validDeviceTypes = ['smartphone', 'tablet', 'pc'];
    if (!validDeviceTypes.includes(device_type)) {
      return res.status(400).json({
        error: 'device_typeはsmartphone, tablet, pcのいずれかである必要があります',
        code: 'INVALID_DEVICE_TYPE'
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const user_id  = uuidv4();
      const pin_hash = await bcrypt.hash(pin, parseInt(process.env.BCRYPT_ROUNDS) || 10);

      await client.query(
        `INSERT INTO users (user_id, name, phone_number, email, role, pin_hash, is_active, company_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'company_js_001')`,
        [user_id, name, phone_number || null, email || null, 'worker', pin_hash, true]
      );

      const device_id = uuidv4();

      await client.query(
        `INSERT INTO devices (device_id, user_id, device_name, device_type, os_type, is_primary, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [device_id, user_id, device_name, device_type, os_type || null, true, true]
      );

      await client.query('COMMIT');

      const token = jwt.sign(
        {
          user_id:    user_id,
          name:       name,
          device_id:  device_id,
          role:       'worker',
          company_id: 'company_js_001'
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRATION || '24h' }
      );

      res.status(201).json({
        success:    true,
        message:    'ユーザーとデバイスを登録しました',
        token:      token,
        user_id:    user_id,
        name:       name,
        role:       'worker',
        company_id: 'company_js_001'
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('ユーザー登録エラー:', error);
    res.status(500).json({
      error:   'ユーザー登録に失敗しました',
      code:    'REGISTER_ERROR',
      message: error.message
    });
  }
});

// ============================================================
// POST /api/v1/auth/verify-pin - PIN認証
// 全ユーザーのPINを照合する
// ============================================================

router.post('/verify-pin', async (req, res) => {
  try {
    const { pin, device_name, device_type, os_type } = req.body;

    if (!pin) {
      return res.status(400).json({
        error: 'PINが必要です',
        code:  'MISSING_PIN'
      });
    }

    // 全アクティブユーザーを取得
    const userResult = await pool.query(
      `SELECT user_id, name, company, company_id, role, pin_hash, is_active
       FROM users
       WHERE is_active = true`
    );

    if (!userResult.rows || userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'ユーザーが見つかりません',
        code:  'USER_NOT_FOUND'
      });
    }

    // 全ユーザーのPINを照合
    let matchedUser = null;
    for (const u of userResult.rows) {
      const isMatch = await bcrypt.compare(pin, u.pin_hash);
      if (isMatch) {
        matchedUser = u;
        break;
      }
    }

    if (!matchedUser) {
      return res.status(401).json({
        error: 'PINが間違っています',
        code:  'INVALID_PIN'
      });
    }

    console.log(`✅ ログイン成功: ${matchedUser.name} (${matchedUser.role})`);

    // デバイスを登録
    const device_id = uuidv4();
    await pool.query(
      `INSERT INTO devices (device_id, user_id, device_name, device_type, os_type, is_primary, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        device_id,
        matchedUser.user_id,
        device_name  || 'unknown',
        device_type  || 'smartphone',
        os_type      || null,
        true,
        true
      ]
    );

    // JWTトークン生成（company_id・role含む）
    const token = jwt.sign(
      {
        user_id:    matchedUser.user_id,
        name:       matchedUser.name,
        company:    matchedUser.company,
        company_id: matchedUser.company_id,
        role:       matchedUser.role,
        device_id:  device_id
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION || '24h' }
    );

    res.status(200).json({
      success:    true,
      token:      token,
      user_id:    matchedUser.user_id,
      name:       matchedUser.name,
      role:       matchedUser.role,
      company_id: matchedUser.company_id,
      expires_in: process.env.JWT_EXPIRATION || '24h'
    });

  } catch (error) {
    console.error('PIN認証エラー:', error);
    res.status(500).json({
      error: 'PIN認証に失敗しました',
      code:  'PIN_VERIFY_ERROR'
    });
  }
});

// ============================================================
// POST /api/v1/auth/verify-token - トークン検証
// ============================================================

router.post('/verify-token', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'トークンが必要です',
      code:  'NO_TOKEN'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'トークンの有効期限が切れました',
          code:  'TOKEN_EXPIRED'
        });
      }
      return res.status(403).json({
        error: 'トークンが無効です',
        code:  'INVALID_TOKEN'
      });
    }

    res.status(200).json({
      success: true,
      user:    user
    });
  });
});

// ============================================================
// POST /api/v1/auth/logout - ログアウト
// ============================================================

router.post('/logout', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ログアウトしました'
  });
});

// ============================================================
// POST /api/v1/auth/change-pin - PIN変更
// ============================================================

router.post('/change-pin', async (req, res) => {
  try {
    const { device_id, old_pin, new_pin } = req.body;

    if (!device_id || !old_pin || !new_pin) {
      return res.status(400).json({
        error: '必須フィールドが不足しています',
        code:  'MISSING_FIELDS'
      });
    }

    if (!/^\d{4,6}$/.test(new_pin)) {
      return res.status(400).json({
        error: 'PINは4〜6桁の数字である必要があります',
        code:  'INVALID_PIN_FORMAT'
      });
    }

    const result = await pool.query(
      `SELECT u.user_id, u.pin_hash
       FROM users u
       JOIN devices d ON u.user_id = d.user_id
       WHERE d.device_id = $1`,
      [device_id]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: 'ユーザーが見つかりません',
        code:  'USER_NOT_FOUND'
      });
    }

    const user     = result.rows[0];
    const pinMatch = await bcrypt.compare(old_pin, user.pin_hash);

    if (!pinMatch) {
      return res.status(401).json({
        error: '現在のPINが正しくありません',
        code:  'INVALID_PIN'
      });
    }

    const newPinHash = await bcrypt.hash(new_pin, parseInt(process.env.BCRYPT_ROUNDS) || 10);

    await pool.query(
      `UPDATE users SET pin_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [newPinHash, user.user_id]
    );

    res.status(200).json({
      success: true,
      message: 'PINを変更しました'
    });

  } catch (error) {
    console.error('PIN変更エラー:', error);
    res.status(500).json({
      error: 'PIN変更に失敗しました',
      code:  'PIN_CHANGE_ERROR'
    });
  }
});

module.exports = router;