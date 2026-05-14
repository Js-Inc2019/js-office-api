// ============================================================
// routes/auth.js - 認証ルート (PostgreSQL対応)
// ============================================================

const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const pool = require('../db/connection');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

// ============================================================
// PIN 認証 → JWT トークン発行
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

    // PostgreSQL で device_id からユーザーを検索
    const result = await pool.query(
      'SELECT user_id, name, company, role, pin_hash FROM users WHERE device_id = $1 AND is_active = TRUE',
      [device_id]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(401).json({
        error: 'デバイスが登録されていません',
        code: 'DEVICE_NOT_REGISTERED'
      });
    }

    const user = result.rows[0];

    // PIN を検証
    const pinMatch = await bcrypt.compare(pin, user.pin_hash);

    if (!pinMatch) {
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
// トークン確認
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
// ============================================================

router.post('/logout', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'ログアウトしました'
  });
});

// ============================================================
// PIN 変更
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

    // device_id からユーザーを検索
    const result = await pool.query(
      'SELECT user_id, pin_hash FROM users WHERE device_id = $1',
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
      'UPDATE users SET pin_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2',
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