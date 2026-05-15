// ============================================================
// routes/auth.js - 認証ルート (PostgreSQL対応)
// 拡張版：ユーザー登録・デバイス管理・複数認証対応
// ============================================================

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../db/connection');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// ============================================================
// ユーザー登録エンドポイント
// POST /api/v1/auth/register
// ============================================================

router.post('/register', async (req, res) => {
  try {
    const { name, phone_number, email, pin, device_name, device_type, os_type } = req.body;

    // バリデーション
    if (!name || !pin || !device_name || !device_type) {
      return res.status(400).json({
        error: '必須フィールドが不足しています',
        code: 'MISSING_FIELDS',
        required: ['name', 'pin', 'device_name', 'device_type']
      });
    }

    // PIN のバリデーション（4〜6桁）
    if (!/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({
        error: 'PIN は 4〜6 桁の数字である必要があります',
        code: 'INVALID_PIN_FORMAT'
      });
    }

    // device_type のバリデーション
    const validDeviceTypes = ['smartphone', 'tablet', 'pc'];
    if (!validDeviceTypes.includes(device_type)) {
      return res.status(400).json({
        error: 'device_type は smartphone, tablet, pc のいずれかである必要があります',
        code: 'INVALID_DEVICE_TYPE'
      });
    }

    // トランザクション開始
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // ユーザーIDを生成
       const user_id = uuidv4();
      
      // PIN をハッシュ化
      const pin_hash = await bcrypt.hash(pin, parseInt(process.env.BCRYPT_ROUNDS) || 10);

      // users テーブルに挿入
      await client.query(
        `INSERT INTO users (user_id, name, phone_number, email, role, pin_hash, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [user_id, name, phone_number || null, email || null, 'worker', pin_hash, true]
      );

      // デバイスIDを生成
      const device_id =  uuidv4();

      // devices テーブルに挿入
      await client.query(
        `INSERT INTO devices (device_id, user_id, device_name, device_type, os_type, is_primary, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [device_id, user_id, device_name, device_type, os_type || null, true, true]
      );

      await client.query('COMMIT');

      // JWT トークンを生成
      const token = jwt.sign(
        {
          user_id: user_id,
          name: name,
          device_id: device_id,
          role: 'worker'
        },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRATION || '24h' }
      );

      res.status(201).json({
        success: true,
        message: 'ユーザーとデバイスを登録しました',
        token: token,
        user: {
          user_id: user_id,
          name: name,
          phone_number: phone_number || null,
          email: email || null,
          role: 'worker'
        },
        device: {
          device_id: device_id,
          device_name: device_name,
          device_type: device_type
        },
        expires_in: process.env.JWT_EXPIRATION || '24h'
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
      error: 'ユーザー登録に失敗しました',
      code: 'REGISTER_ERROR',
      message: error.message
    });
  }
});

// ============================================================
// PIN 認証 → JWT トークン発行
// ============================================================
router.post('/verify-pin', async (req, res) => {
  try {
    const { pin, device_name, device_type, os_type } = req.body;

    if (!pin) {
      return res.status(400).json({
        error: 'PIN が必須です',
        code: 'MISSING_PIN'
      });
    }

    // PIN からユーザーを検索（最初のアクティブなユーザー）
    const userResult = await pool.query(
      `SELECT user_id, name, company, role, pin_hash, is_active FROM users WHERE is_active = true LIMIT 1`
    );

    if (!userResult.rows || userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'ユーザーが見つかりません',
        code: 'USER_NOT_FOUND'
      });
    }

    const user = userResult.rows[0];

    // PIN を検証
    const pinMatch = await bcrypt.compare(pin, user.pin_hash);

    if (!pinMatch) {
      return res.status(401).json({
        error: 'PINが間違っています',
        code: 'INVALID_PIN'
      });
    }

    // デバイスID を生成
    const device_id = require('uuid').v4();

    // devices テーブルに挿入
    await pool.query(
      `INSERT INTO devices (device_id, user_id, device_name, device_type, os_type, is_primary, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [device_id, user.user_id, device_name || 'unknown', device_type || 'smartphone', os_type || null, true, true]
    );

    // JWT トークンを生成
    const token = jwt.sign(
      {
        user_id: user.user_id,
        name: user.name,
        company: user.company,
        role: user.role,
        device_id: device_id
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRATION || '24h' }
    );

    res.status(200).json({
      success: true,
      token: token,
      user_id: user.user_id,
      expires_in: process.env.JWT_EXPIRATION || '24h'
    });

  } catch (error) {
    console.error('PIN認証エラー:', error);
    res.status(500).json({
      error: 'PIN認証に失敗しました',
      code: 'PIN_VERIFY_ERROR'
    });
  }
});


// ============================================================
// トークン検証
// POST /api/v1/auth/verify-token
// ============================================================

router.post('/verify-token', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'トークンが必須です',
      code: 'NO_TOKEN'
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({
          error: 'トークンの有効期限が切れました',
          code: 'TOKEN_EXPIRED'
        });
      }
      return res.status(403).json({
        error: 'トークンが無効です',
        code: 'INVALID_TOKEN'
      });
    }

    res.status(200).json({
      success: true,
      user: user
    });
  });
});

// ============================================================
// ログアウト
// POST /api/v1/auth/logout
// ============================================================

router.post('/logout', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ログアウトしました'
  });
});

// ============================================================
// PIN 変更
// POST /api/v1/auth/change-pin
// ============================================================

router.post('/change-pin', async (req, res) => {
  try {
    const { device_id, old_pin, new_pin } = req.body;

    if (!device_id || !old_pin || !new_pin) {
      return res.status(400).json({
        error: '必須フィールドが不足しています',
        code: 'MISSING_FIELDS'
      });
    }

    // 新しい PIN のバリデーション
    if (!/^\d{4,6}$/.test(new_pin)) {
      return res.status(400).json({
        error: 'PIN は 4〜6 桁の数字である必要があります',
        code: 'INVALID_PIN_FORMAT'
      });
    }

    // device_id からユーザーを取得
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
        code: 'USER_NOT_FOUND'
      });
    }

    const user = result.rows[0];

    // 現在の PIN を検証
    const pinMatch = await bcrypt.compare(old_pin, user.pin_hash);

    if (!pinMatch) {
      return res.status(401).json({
        error: '現在の PIN が正しくありません',
        code: 'INVALID_PIN'
      });
    }

    // 新しい PIN をハッシュ化
    const newPinHash = await bcrypt.hash(new_pin, parseInt(process.env.BCRYPT_ROUNDS) || 10);

    // PIN を更新
    await pool.query(
      `UPDATE users SET pin_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2`,
      [newPinHash, user.user_id]
    );

    res.status(200).json({
      success: true,
      message: 'PIN を変更しました'
    });

  } catch (error) {
    console.error('PIN 変更エラー:', error);
    res.status(500).json({
      error: 'PIN 変更に失敗しました',
      code: 'PIN_CHANGE_ERROR'
    });
  }
});

// ============================================================
// エクスポート
// ============================================================

module.exports = router;