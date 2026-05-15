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
      const user_id = `user_${uuidv4()}`;
      
      // PIN をハッシュ化
      const pin_hash = await bcrypt.hash(pin, parseInt(process.env.BCRYPT_ROUNDS) || 10);

      // users テーブルに挿入
      await client.query(
        `INSERT INTO users (user_id, name, phone_number, email, role, pin_hash, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [user_id, name, phone_number || null, email || null, 'worker', pin_hash, true]
      );

      // デバイスIDを生成
      const device_id = `device_${uuidv4()}`;

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
// PIN 認証 + JWT トークン発行
// POST /api/v1/auth/verify-pin
// ============================================================

router.post('/verify-pin', async (req, res) => {
  try {
    const { pin, device_id } = req.body;

    if (!pin || !device_id) {
      return res.status(400).json({
        error: 'PIN とデバイスID が必須です',
        code: 'MISSING_FIELDS'
      });
    }

    // device_id からユーザー情報を取得
    const deviceResult = await pool.query(
      `SELECT d.user_id, u.name, u.company, u.role, u.pin_hash, u.is_active
       FROM devices d
       JOIN users u ON d.user_id = u.user_id
       WHERE d.device_id = $1 AND d.is_active = TRUE`,
      [device_id]
    );

    if (!deviceResult.rows || deviceResult.rows.length === 0) {
      return res.status(401).json({
        error: 'デバイスが登録されていません',
        code: 'DEVICE_NOT_REGISTERED'
      });
    }

    const user = deviceResult.rows[0];

    // ユーザーが有効か確認
    if (!user.is_active) {
      return res.status(401).json({
        error: 'ユーザーが無効です',
        code: 'USER_INACTIVE'
      });
    }

    // PIN を検証
    const pinMatch = await bcrypt.compare(pin, user.pin_hash);

    if (!pinMatch) {
      // 認証ログを記録（失敗）
      await pool.query(
        `INSERT INTO authentication_logs (auth_log_id, device_id, user_id, auth_method, auth_status, timestamp)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
        [uuidv4(), device_id, user.user_id, 'pin', 'failed']
      );

      return res.status(401).json({
        error: 'PIN が正しくありません',
        code: 'INVALID_PIN'
      });
    }

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

    // 認証ログを記録（成功）
    await pool.query(
      `INSERT INTO authentication_logs (auth_log_id, device_id, user_id, auth_method, auth_status, timestamp)
       VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
      [uuidv4(), device_id, user.user_id, 'pin', 'success']
    );

    // デバイスの最終使用時刻を更新
    await pool.query(
      `UPDATE devices SET last_used_at = CURRENT_TIMESTAMP WHERE device_id = $1`,
      [device_id]
    );

    res.status(200).json({
      success: true,
      token: token,
      user: {
        user_id: user.user_id,
        name: user.name,
        company: user.company,
        role: user.role
      },
      expires_in: process.env.JWT_EXPIRATION || '24h'
    });

  } catch (error) {
    console.error('PIN 認証エラー:', error);
    res.status(500).json({
      error: 'PIN 認証に失敗しました',
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