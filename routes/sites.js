// ============================================================
// routes/sites.js - 現場管理API
// ============================================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/connection');

// ============================================================
// GET /api/v1/sites
// 現場一覧取得（自分の会社の現場のみ）
// ============================================================

router.get('/', async (req, res) => {
  const { company_id } = req.user;

  try {
    const result = await pool.query(`
      SELECT
        s.site_id,
        s.company_id,
        s.site_name,
        s.site_code,
        s.address,
        s.start_date,
        s.end_date,
        s.is_active,
        s.created_at,
        c.company_name
      FROM sites s
      JOIN companies c ON s.company_id = c.company_id
      WHERE s.company_id = $1
        AND s.is_active = TRUE
      ORDER BY s.created_at DESC
    `, [company_id]);

    res.json({
      success: true,
      sites: result.rows
    });
  } catch (err) {
    console.error('現場一覧取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// GET /api/v1/sites/all
// 全会社の現場一覧（admin_exec・admin_office のみ）
// ============================================================

router.get('/all', async (req, res) => {
  const { role } = req.user;

  if (!['admin_exec', 'admin_office'].includes(role)) {
    return res.status(403).json({
      success: false,
      error: '権限がありません'
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        s.site_id,
        s.company_id,
        s.site_name,
        s.site_code,
        s.address,
        s.start_date,
        s.end_date,
        s.is_active,
        s.created_at,
        c.company_name,
        c.company_code
      FROM sites s
      JOIN companies c ON s.company_id = c.company_id
      WHERE s.is_active = TRUE
      ORDER BY c.company_name ASC, s.created_at DESC
    `);

    res.json({
      success: true,
      sites: result.rows
    });
  } catch (err) {
    console.error('全現場一覧取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// GET /api/v1/sites/:site_id
// 現場詳細取得
// ============================================================

router.get('/:site_id', async (req, res) => {
  const { site_id } = req.params;
  const { company_id, role } = req.user;

  try {
    const result = await pool.query(`
      SELECT
        s.*,
        c.company_name,
        c.company_code
      FROM sites s
      JOIN companies c ON s.company_id = c.company_id
      WHERE s.site_id = $1
    `, [site_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '現場が見つかりません' });
    }

    const site = result.rows[0];

    // admin_exec以外は自社の現場のみ参照可
    if (role !== 'admin_exec' && site.company_id !== company_id) {
      return res.status(403).json({ success: false, error: '権限がありません' });
    }

    // この現場の日報数も取得
    const reportCount = await pool.query(
      'SELECT COUNT(*) FROM reports WHERE site_id = $1',
      [site_id]
    );

    res.json({
      success: true,
      site,
      report_count: parseInt(reportCount.rows[0].count)
    });
  } catch (err) {
    console.error('現場詳細取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// POST /api/v1/sites
// 現場新規登録（admin_exec・admin_office・boss が可能）
// ============================================================

router.post('/', async (req, res) => {
  const { role, company_id } = req.user;

  if (!['admin_exec', 'admin_office', 'boss'].includes(role)) {
    return res.status(403).json({
      success: false,
      error: '現場の登録は職長・事務・管理者のみ可能です'
    });
  }

  const { site_name, site_code, address, start_date, end_date } = req.body;

  if (!site_name) {
    return res.status(400).json({
      success: false,
      error: '現場名は必須です'
    });
  }

  try {
    const site_id = uuidv4();

    const result = await pool.query(`
      INSERT INTO sites (
        site_id, company_id, site_name, site_code,
        address, start_date, end_date, is_active
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE)
      RETURNING *
    `, [
      site_id,
      company_id,
      site_name,
      site_code || null,
      address || null,
      start_date || null,
      end_date || null
    ]);

    console.log(`✅ 現場登録: ${site_name} (会社: ${company_id})`);

    res.status(201).json({
      success: true,
      message: '現場を登録しました',
      site: result.rows[0]
    });
  } catch (err) {
    console.error('現場登録エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// PUT /api/v1/sites/:site_id
// 現場情報更新（admin_exec・admin_office・boss が可能）
// ============================================================

router.put('/:site_id', async (req, res) => {
  const { role, company_id } = req.user;
  const { site_id } = req.params;

  if (!['admin_exec', 'admin_office', 'boss'].includes(role)) {
    return res.status(403).json({
      success: false,
      error: '権限がありません'
    });
  }

  try {
    // 自社の現場かチェック
    const existing = await pool.query(
      'SELECT * FROM sites WHERE site_id = $1',
      [site_id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: '現場が見つかりません' });
    }

    if (role !== 'admin_exec' && existing.rows[0].company_id !== company_id) {
      return res.status(403).json({ success: false, error: '他社の現場は編集できません' });
    }

    const { site_name, site_code, address, start_date, end_date, is_active } = req.body;

    const result = await pool.query(`
      UPDATE sites SET
        site_name  = COALESCE($1, site_name),
        site_code  = COALESCE($2, site_code),
        address    = COALESCE($3, address),
        start_date = COALESCE($4, start_date),
        end_date   = COALESCE($5, end_date),
        is_active  = COALESCE($6, is_active),
        updated_at = CURRENT_TIMESTAMP
      WHERE site_id = $7
      RETURNING *
    `, [site_name, site_code, address, start_date, end_date, is_active, site_id]);

    res.json({
      success: true,
      message: '現場情報を更新しました',
      site: result.rows[0]
    });
  } catch (err) {
    console.error('現場更新エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// DELETE /api/v1/sites/:site_id
// 現場を無効化（論理削除）
// ============================================================

router.delete('/:site_id', async (req, res) => {
  const { role, company_id } = req.user;
  const { site_id } = req.params;

  if (!['admin_exec', 'admin_office'].includes(role)) {
    return res.status(403).json({
      success: false,
      error: '現場の削除は事務・管理者のみ可能です'
    });
  }

  try {
    const existing = await pool.query(
      'SELECT * FROM sites WHERE site_id = $1',
      [site_id]
    );

    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, error: '現場が見つかりません' });
    }

    if (role !== 'admin_exec' && existing.rows[0].company_id !== company_id) {
      return res.status(403).json({ success: false, error: '他社の現場は削除できません' });
    }

    await pool.query(
      'UPDATE sites SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE site_id = $1',
      [site_id]
    );

    res.json({
      success: true,
      message: '現場を無効化しました'
    });
  } catch (err) {
    console.error('現場削除エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

module.exports = router;