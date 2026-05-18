// ============================================================
// routes/companies.js - 会社管理API
// ============================================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/connection');

// ============================================================
// 権限チェックヘルパー
// admin_exec のみ会社の追加・削除が可能
// admin_office・boss は参照のみ
// ============================================================

const isSystemAdmin = (role) => role === 'admin_exec';
const canManageCompany = (role) => ['admin_exec', 'admin_office'].includes(role);

// ============================================================
// GET /api/v1/companies
// 全会社一覧取得（認証済みユーザー全員参照可）
// ============================================================

router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        company_id,
        company_name,
        company_code,
        address,
        phone,
        email,
        is_active,
        is_master,
        created_at
      FROM companies
      WHERE is_active = TRUE
      ORDER BY is_master DESC, company_name ASC
    `);

    res.json({
      success: true,
      companies: result.rows
    });
  } catch (err) {
    console.error('会社一覧取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// GET /api/v1/companies/:company_id
// 会社詳細取得
// ============================================================

router.get('/:company_id', async (req, res) => {
  const { company_id } = req.params;

  try {
    const company = await pool.query(
      'SELECT * FROM companies WHERE company_id = $1',
      [company_id]
    );

    if (company.rows.length === 0) {
      return res.status(404).json({ success: false, error: '会社が見つかりません' });
    }

    // この会社の社員数も取得
    const members = await pool.query(
      'SELECT COUNT(*) FROM users WHERE company_id = $1 AND is_active = TRUE',
      [company_id]
    );

    // この会社と繋がっている会社一覧も取得
    const relations = await pool.query(`
      SELECT
        c.company_id,
        c.company_name,
        c.company_code,
        cr.relation_type,
        cr.is_active
      FROM company_relations cr
      JOIN companies c ON (
        CASE
          WHEN cr.company_id_a = $1 THEN cr.company_id_b = c.company_id
          WHEN cr.company_id_b = $1 THEN cr.company_id_a = c.company_id
        END
      )
      WHERE (cr.company_id_a = $1 OR cr.company_id_b = $1)
        AND cr.is_active = TRUE
    `, [company_id]);

    res.json({
      success: true,
      company: company.rows[0],
      member_count: parseInt(members.rows[0].count),
      related_companies: relations.rows
    });
  } catch (err) {
    console.error('会社詳細取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// POST /api/v1/companies
// 会社新規登録（admin_exec のみ）
// ============================================================

router.post('/', async (req, res) => {
  const { role } = req.user;

  if (!isSystemAdmin(role)) {
    return res.status(403).json({
      success: false,
      error: '会社の登録はシステム管理者のみ可能です'
    });
  }

  const { company_name, company_code, address, phone, email } = req.body;

  if (!company_name || !company_code) {
    return res.status(400).json({
      success: false,
      error: '会社名・会社コードは必須です'
    });
  }

  try {
    const company_id = uuidv4();

    const result = await pool.query(`
      INSERT INTO companies (
        company_id, company_name, company_code,
        address, phone, email, is_active, is_master
      ) VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE)
      RETURNING *
    `, [company_id, company_name, company_code, address || null, phone || null, email || null]);

    console.log(`✅ 会社登録: ${company_name} (${company_code})`);

    res.status(201).json({
      success: true,
      message: '会社を登録しました',
      company: result.rows[0]
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({
        success: false,
        error: 'この会社コードはすでに使用されています'
      });
    }
    console.error('会社登録エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// PUT /api/v1/companies/:company_id
// 会社情報更新（admin_exec のみ）
// ============================================================

router.put('/:company_id', async (req, res) => {
  const { role } = req.user;

  if (!isSystemAdmin(role)) {
    return res.status(403).json({
      success: false,
      error: '会社情報の更新はシステム管理者のみ可能です'
    });
  }

  const { company_id } = req.params;
  const { company_name, address, phone, email, is_active } = req.body;

  try {
    const result = await pool.query(`
      UPDATE companies SET
        company_name = COALESCE($1, company_name),
        address      = COALESCE($2, address),
        phone        = COALESCE($3, phone),
        email        = COALESCE($4, email),
        is_active    = COALESCE($5, is_active),
        updated_at   = CURRENT_TIMESTAMP
      WHERE company_id = $6
      RETURNING *
    `, [company_name, address, phone, email, is_active, company_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '会社が見つかりません' });
    }

    res.json({
      success: true,
      message: '会社情報を更新しました',
      company: result.rows[0]
    });
  } catch (err) {
    console.error('会社更新エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// POST /api/v1/companies/relations
// 会社間の繋がりを登録（admin_exec のみ）
// 例: J's ↔ 協力会社A を繋げる
// ============================================================

router.post('/relations/add', async (req, res) => {
  const { role } = req.user;

  if (!isSystemAdmin(role)) {
    return res.status(403).json({
      success: false,
      error: '会社間の関係設定はシステム管理者のみ可能です'
    });
  }

  const { company_id_a, company_id_b, relation_type } = req.body;

  if (!company_id_a || !company_id_b) {
    return res.status(400).json({
      success: false,
      error: '2つの会社IDが必要です'
    });
  }

  if (company_id_a === company_id_b) {
    return res.status(400).json({
      success: false,
      error: '同じ会社同士は登録できません'
    });
  }

  try {
    const relation_id = uuidv4();

    const result = await pool.query(`
      INSERT INTO company_relations (
        relation_id, company_id_a, company_id_b, relation_type, is_active
      ) VALUES ($1, $2, $3, $4, TRUE)
      ON CONFLICT (company_id_a, company_id_b) DO UPDATE
        SET is_active = TRUE, relation_type = $4
      RETURNING *
    `, [relation_id, company_id_a, company_id_b, relation_type || 'partner']);

    console.log(`✅ 会社間関係登録: ${company_id_a} ↔ ${company_id_b}`);

    res.status(201).json({
      success: true,
      message: '会社間の繋がりを登録しました',
      relation: result.rows[0]
    });
  } catch (err) {
    console.error('会社間関係登録エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// GET /api/v1/companies/relations/list
// 会社間の繋がり一覧取得
// ============================================================

router.get('/relations/list', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        cr.relation_id,
        cr.relation_type,
        cr.is_active,
        cr.created_at,
        a.company_id   AS company_a_id,
        a.company_name AS company_a_name,
        a.company_code AS company_a_code,
        b.company_id   AS company_b_id,
        b.company_name AS company_b_name,
        b.company_code AS company_b_code
      FROM company_relations cr
      JOIN companies a ON cr.company_id_a = a.company_id
      JOIN companies b ON cr.company_id_b = b.company_id
      WHERE cr.is_active = TRUE
      ORDER BY cr.created_at DESC
    `);

    res.json({
      success: true,
      relations: result.rows
    });
  } catch (err) {
    console.error('会社間関係一覧取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// PUT /api/v1/companies/relations/:relation_id/deactivate
// 会社間の繋がりを無効化（admin_exec のみ）
// ============================================================

router.put('/relations/:relation_id/deactivate', async (req, res) => {
  const { role } = req.user;

  if (!isSystemAdmin(role)) {
    return res.status(403).json({
      success: false,
      error: 'システム管理者のみ操作可能です'
    });
  }

  const { relation_id } = req.params;

  try {
    const result = await pool.query(`
      UPDATE company_relations
      SET is_active = FALSE
      WHERE relation_id = $1
      RETURNING *
    `, [relation_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '関係が見つかりません' });
    }

    res.json({
      success: true,
      message: '会社間の繋がりを無効化しました'
    });
  } catch (err) {
    console.error('会社間関係無効化エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

module.exports = router;