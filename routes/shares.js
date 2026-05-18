// ============================================================
// routes/shares.js - 会社間報告API
// ============================================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const pool = require('../db/connection');

// ============================================================
// ハッシュ生成ヘルパー（改ざん検知用）
// ============================================================

const generateHash = (data) => {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
};

// ============================================================
// 会社間の繋がりチェックヘルパー
// ============================================================

const checkRelation = async (company_id_a, company_id_b) => {
  const result = await pool.query(`
    SELECT relation_id FROM company_relations
    WHERE (
      (company_id_a = $1 AND company_id_b = $2) OR
      (company_id_a = $2 AND company_id_b = $1)
    ) AND is_active = TRUE
  `, [company_id_a, company_id_b]);
  return result.rows.length > 0;
};

// ============================================================
// POST /api/v1/shares/send
// 日報を他社に送信する
// 職長（boss）・事務（admin_office・admin_exec）のみ可能
// 職人（worker）は自社職長にのみ報告可（このAPIは使えない）
// ============================================================

router.post('/send', async (req, res) => {
  console.log('shares/send called:', JSON.stringify(req.body));
  // report_idがUUID形式でない場合はworker_nameで検索
  let actualReportId = req.body.report_id;
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(actualReportId);
  if (!isUUID) {
    const latest = await pool.query('SELECT report_id FROM reports ORDER BY created_at DESC LIMIT 1');
    if (latest.rows.length > 0) actualReportId = latest.rows[0].report_id;
  }
  req.body.report_id = actualReportId;
  const { role, company_id, user_id } = req.user;

  // 職人は使用不可
  if (role === 'worker') {
    return res.status(403).json({
      success: false,
      error: '職人は他社への報告はできません。自社職長に報告してください。'
    });
  }

  const { report_id, receiver_company_id, share_type, memo } = req.body;

  if (!report_id || !receiver_company_id) {
    return res.status(400).json({
      success: false,
      error: '日報IDと送信先会社IDは必須です'
    });
  }

  try {
    // 日報の存在確認
    const report = await pool.query(
      'SELECT * FROM reports WHERE report_id = $1',
      [report_id]
    );

    if (report.rows.length === 0) {
      return res.status(404).json({ success: false, error: '日報が見つかりません' });
    }

    // 自社の日報かチェック（admin_execは全社可）
    if (role !== 'admin_exec' && report.rows[0].user_id !== user_id) {
      // 自社の日報かどうかを確認
      const reportUser = await pool.query(
        'SELECT company_id FROM users WHERE user_id = $1',
        [report.rows[0].user_id]
      );
      if (reportUser.rows[0]?.company_id !== company_id) {
        return res.status(403).json({
          success: false,
          error: '他社の日報は送信できません'
        });
      }
    }

    // 自社に送信しようとしていないかチェック
    if (company_id === receiver_company_id) {
      return res.status(400).json({
        success: false,
        error: '自社への送信はできません'
      });
    }

    // 会社間の繋がりチェック
    const hasRelation = await checkRelation(company_id, receiver_company_id);
    if (!hasRelation) {
      return res.status(403).json({
        success: false,
        error: 'この会社との繋がりがありません。管理者に確認してください。'
      });
    }

    // ハッシュ生成（改ざん検知の基準値）
    const reportData = report.rows[0];
    const content_hash = generateHash(reportData);

    // report_sharesに記録
    const share_id = uuidv4();
    const shareResult = await pool.query(`
      INSERT INTO report_shares (
        share_id,
        report_id,
        sender_company_id,
        sender_user_id,
        receiver_company_id,
        share_type,
        content_hash,
        share_status,
        sent_at,
        memo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'sent', CURRENT_TIMESTAMP, $8)
      RETURNING *
    `, [
      share_id,
      report_id,
      company_id,
      user_id,
      receiver_company_id,
      share_type || 'in_app',
      content_hash,
      memo || null
    ]);

    // reportsのcontent_hashも更新
    await pool.query(
      'UPDATE reports SET content_hash = $1 WHERE report_id = $2',
      [content_hash, report_id]
    );

    // 受信側へのプッシュ通知を登録
    const receiverUsers = await pool.query(
      `SELECT u.user_id FROM users u
       WHERE u.company_id = $1
         AND u.role IN ('boss', 'admin_office', 'admin_exec')
         AND u.is_active = TRUE`,
      [receiver_company_id]
    );

    for (const receiver of receiverUsers.rows) {
      await pool.query(`
        INSERT INTO push_notifications (
          push_id, user_id, type, title, body, data, is_sent
        ) VALUES ($1, $2, 'report_shared', $3, $4, $5, FALSE)
      `, [
        uuidv4(),
        receiver.user_id,
        '日報が届きました',
        `${reportData.worker_name}さんの日報が届きました`,
        JSON.stringify({ share_id, report_id })
      ]);
    }

    console.log(`✅ 日報送信: ${report_id} → 会社: ${receiver_company_id}`);

    res.status(201).json({
      success: true,
      message: '日報を送信しました',
      share: shareResult.rows[0]
    });
  } catch (err) {
    console.error('日報送信エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// GET /api/v1/shares/inbox
// 受信した日報一覧
// ============================================================

router.get('/inbox', async (req, res) => {
  const { company_id, role } = req.user;

  if (role === 'worker') {
    return res.status(403).json({
      success: false,
      error: '権限がありません'
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        rs.share_id,
        rs.report_id,
        rs.share_type,
        rs.share_status,
        rs.content_hash,
        rs.sent_at,
        rs.received_at,
        rs.read_at,
        rs.memo,
        sc.company_name AS sender_company_name,
        sc.company_code AS sender_company_code,
        r.worker_name,
        r.report_date,
        r.site_name,
        r.work_content,
        r.content_hash AS current_hash
      FROM report_shares rs
      JOIN companies sc ON rs.sender_company_id = sc.company_id
      JOIN reports r ON rs.report_id = r.report_id
      WHERE rs.receiver_company_id = $1
      ORDER BY rs.sent_at DESC
    `, [company_id]);

    // 改ざん検知：送信時のハッシュと現在のハッシュを比較
    const shares = result.rows.map(row => ({
      ...row,
      is_tampered: row.content_hash !== row.current_hash
    }));

    res.json({
      success: true,
      shares
    });
  } catch (err) {
    console.error('受信日報一覧取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// GET /api/v1/shares/outbox
// 送信した日報一覧
// ============================================================

router.get('/outbox', async (req, res) => {
  const { company_id, role } = req.user;

  if (role === 'worker') {
    return res.status(403).json({
      success: false,
      error: '権限がありません'
    });
  }

  try {
    const result = await pool.query(`
      SELECT
        rs.share_id,
        rs.report_id,
        rs.share_type,
        rs.share_status,
        rs.content_hash,
        rs.sent_at,
        rs.received_at,
        rs.read_at,
        rs.memo,
        rc.company_name AS receiver_company_name,
        rc.company_code AS receiver_company_code,
        r.worker_name,
        r.report_date,
        r.site_name,
        r.work_content
      FROM report_shares rs
      JOIN companies rc ON rs.receiver_company_id = rc.company_id
      JOIN reports r ON rs.report_id = r.report_id
      WHERE rs.sender_company_id = $1
      ORDER BY rs.sent_at DESC
    `, [company_id]);

    res.json({
      success: true,
      shares: result.rows
    });
  } catch (err) {
    console.error('送信日報一覧取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// PUT /api/v1/shares/:share_id/read
// 既読にする
// ============================================================

router.put('/:share_id/read', async (req, res) => {
  const { company_id } = req.user;
  const { share_id } = req.params;

  try {
    const result = await pool.query(`
      UPDATE report_shares
      SET
        share_status = 'read',
        read_at = CURRENT_TIMESTAMP
      WHERE share_id = $1
        AND receiver_company_id = $2
      RETURNING *
    `, [share_id, company_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '共有データが見つかりません' });
    }

    res.json({
      success: true,
      message: '既読にしました'
    });
  } catch (err) {
    console.error('既読更新エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// POST /api/v1/shares/check-tamper
// 改ざん検知チェック（手動実行）
// ============================================================

router.post('/check-tamper', async (req, res) => {
  const { role } = req.user;

  if (!['admin_exec', 'admin_office', 'boss'].includes(role)) {
    return res.status(403).json({ success: false, error: '権限がありません' });
  }

  const { share_id } = req.body;

  try {
    const share = await pool.query(
      'SELECT * FROM report_shares WHERE share_id = $1',
      [share_id]
    );

    if (share.rows.length === 0) {
      return res.status(404).json({ success: false, error: '共有データが見つかりません' });
    }

    const report = await pool.query(
      'SELECT * FROM reports WHERE report_id = $1',
      [share.rows[0].report_id]
    );

    const currentHash = generateHash(report.rows[0]);
    const originalHash = share.rows[0].content_hash;
    const isTampered = currentHash !== originalHash;

    if (isTampered) {
      // 改ざん検知ログを記録
      await pool.query(`
        UPDATE report_shares SET share_status = 'tampered' WHERE share_id = $1
      `, [share_id]);

      // 通知を登録
      const notification_id = uuidv4();
      await pool.query(`
        INSERT INTO tamper_notifications (
          notification_id, share_id, report_id,
          notified_user_id, hash_before, hash_after
        ) VALUES ($1, $2, $3, $4, $5, $6)
      `, [
        notification_id,
        share_id,
        share.rows[0].report_id,
        req.user.user_id,
        originalHash,
        currentHash
      ]);

      console.log(`⚠️ 改ざん検知: share_id=${share_id}`);
    }

    res.json({
      success: true,
      is_tampered: isTampered,
      original_hash: originalHash,
      current_hash: currentHash,
      message: isTampered ? '⚠️ データが改ざんされています！' : '✅ データは正常です'
    });
  } catch (err) {
    console.error('改ざんチェックエラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// GET /api/v1/shares/notifications
// 改ざん通知一覧
// ============================================================

router.get('/notifications', async (req, res) => {
  const { user_id } = req.user;

  try {
    const result = await pool.query(`
      SELECT
        tn.*,
        r.worker_name,
        r.report_date,
        r.site_name
      FROM tamper_notifications tn
      JOIN reports r ON tn.report_id = r.report_id
      WHERE tn.notified_user_id = $1
      ORDER BY tn.created_at DESC
    `, [user_id]);

    res.json({
      success: true,
      notifications: result.rows
    });
  } catch (err) {
    console.error('改ざん通知一覧取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

module.exports = router;