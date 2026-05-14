// ============================================================
// routes/reports.js - 日報関連エンドポイント
// ============================================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/connection');
const { checkPermission } = require('../middleware/auth');
require('dotenv').config();

// ============================================================
// 1. 日報を送信
// ============================================================

router.post('/submit', async (req, res) => {
  try {
    const {
      device_id,
      worker_name,
      worker_company,
      report_date,
      clock_in_time,
      transport_type,
      parking_fee,
      parking_photo_url,
      site_photo_url,
      gps_address,
      site_name,
      memo,
      weather,
      temperature
    } = req.body;

    // バリデーション
    if (!device_id || !worker_name || !report_date || !clock_in_time) {
      return res.status(400).json({
        error: '必須フィールドが不足しています',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    const connection = await pool.getConnection();
    const reportId = `rpt_${uuidv4().substring(0, 16)}`;

    try {
      // 既存の日報がないか確認
      const [existing] = await connection.query(
        'SELECT report_id FROM reports WHERE device_id = ? AND report_date = ?',
        [device_id, report_date]
      );

      if (existing && existing.length > 0) {
        // 既存の日報を更新
        await connection.query(
          `UPDATE reports SET 
            clock_in_time = ?, transport_type = ?, parking_fee = ?,
            parking_photo_url = ?, site_photo_url = ?, gps_address = ?,
            site_name = ?, memo = ?, weather = ?, temperature = ?,
            is_sent = TRUE, updated_at = NOW()
           WHERE device_id = ? AND report_date = ?`,
          [
            clock_in_time, transport_type, parking_fee,
            parking_photo_url, site_photo_url, gps_address,
            site_name, memo, weather, temperature,
            device_id, report_date
          ]
        );

        // 監査ログに記録
        await logAuditAction(connection, req.user.user_id, req.user.name, req.user.role, 'update', 'reports', existing[0].report_id, req.ip);

        await connection.release();

        return res.status(200).json({
          success: true,
          report_id: existing[0].report_id,
          message: '日報を更新しました'
        });
      }

      // 新規日報を作成
      await connection.query(
        `INSERT INTO reports 
         (report_id, device_id, worker_name, worker_company, report_date, clock_in_time,
          transport_type, parking_fee, parking_photo_url, site_photo_url, gps_address,
          site_name, memo, weather, temperature, is_sent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, NOW())`,
        [
          reportId, device_id, worker_name, worker_company, report_date, clock_in_time,
          transport_type, parking_fee, parking_photo_url, site_photo_url, gps_address,
          site_name, memo, weather, temperature
        ]
      );

      // 監査ログに記録
      await logAuditAction(connection, req.user.user_id, req.user.name, req.user.role, 'create', 'reports', reportId, req.ip);

      await connection.release();

      res.status(201).json({
        success: true,
        report_id: reportId,
        message: '日報を送信しました'
      });

    } catch (error) {
      await connection.release();
      throw error;
    }

  } catch (error) {
    console.error('日報送信エラー:', error);
    res.status(500).json({
      error: '日報送信に失敗しました',
      code: 'SUBMIT_ERROR'
    });
  }
});

// ============================================================
// 2. 修正依頼を取得（職人用）
// ============================================================

router.get('/revision-requests/:device_id', async (req, res) => {
  try {
    const { device_id } = req.params;

    const connection = await pool.getConnection();

    const [revisions] = await connection.query(
      `SELECT r.revision_id, r.report_id, r.revision_reason, r.revision_comment, 
              r.requested_at, r.response_deadline, r.approval_status,
              rpt.report_date
       FROM revisions r
       JOIN reports rpt ON r.report_id = rpt.report_id
       WHERE rpt.device_id = ? AND r.approval_status = 'pending'
       ORDER BY r.requested_at DESC`,
      [device_id]
    );

    await connection.release();

    res.status(200).json({
      success: true,
      revisions: revisions.map(r => ({
        revision_id: r.revision_id,
        report_id: r.report_id,
        report_date: r.report_date,
        reasons: JSON.parse(r.revision_reason),
        comment: r.revision_comment,
        requested_at: r.requested_at,
        deadline: r.response_deadline,
        status: r.approval_status
      }))
    });

  } catch (error) {
    console.error('修正依頼取得エラー:', error);
    res.status(500).json({
      error: '修正依頼の取得に失敗しました',
      code: 'REVISION_REQUEST_ERROR'
    });
  }
});

// ============================================================
// 3. 修正後の日報を再提出
// ============================================================

router.put('/resubmit/:report_id', async (req, res) => {
  try {
    const { report_id } = req.params;
    const { updates } = req.body;

    const connection = await pool.getConnection();

    // 日報を更新
    const updateFields = [];
    const updateValues = [];

    for (const [key, value] of Object.entries(updates)) {
      updateFields.push(`${key} = ?`);
      updateValues.push(value);
    }

    updateValues.push(report_id);

    await connection.query(
      `UPDATE reports SET ${updateFields.join(', ')}, updated_at = NOW() WHERE report_id = ?`,
      updateValues
    );

    // 修正依頼を完了状態に（親方の承認待ちに）
    await connection.query(
      `UPDATE revisions SET resubmitted_at = NOW(), resubmitted_data = JSON_SET(resubmitted_data, '$', ?)
       WHERE report_id = ? AND approval_status = 'pending'`,
      [JSON.stringify(updates), report_id]
    );

    // 監査ログに記録
    await logAuditAction(connection, req.user.user_id, req.user.name, req.user.role, 'update', 'reports', report_id, req.ip);

    await connection.release();

    res.status(200).json({
      success: true,
      message: '日報を再提出しました'
    });

  } catch (error) {
    console.error('再提出エラー:', error);
    res.status(500).json({
      error: '再提出に失敗しました',
      code: 'RESUBMIT_ERROR'
    });
  }
});

// ============================================================
// 4. 月次勤務実績を取得（事務用）
// ============================================================

router.get('/monthly-summary', checkPermission('view_monthly_summary'), async (req, res) => {
  try {
    const { year, month, worker_id } = req.query;

    if (!year || !month) {
      return res.status(400).json({
        error: '年月が必要です',
        code: 'MISSING_YEAR_MONTH'
      });
    }

    const connection = await pool.getConnection();

    // 月の開始日と終了日を計算
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDate = new Date(year, month, 0).toISOString().split('T')[0];

    // SQL クエリを構築
    let whereClause = 'WHERE YEAR(r.report_date) = ? AND MONTH(r.report_date) = ?';
    let params = [year, month];

    if (worker_id && worker_id !== 'all') {
      whereClause += ' AND r.worker_name = ?';
      params.push(worker_id);
    }

    // 月次サマリーを取得
    const [summary] = await connection.query(
      `SELECT 
        r.worker_name,
        r.worker_company,
        COUNT(DISTINCT r.report_date) as worked_days,
        SUM(CASE WHEN r.is_sent = 1 THEN 1 ELSE 0 END) as sent_count,
        SUM(CASE WHEN r.is_sent = 0 THEN 1 ELSE 0 END) as unsent_count,
        SUM(CASE WHEN r.transport_type = 'car' THEN 1 ELSE 0 END) as car_days,
        SUM(COALESCE(r.parking_fee, 0)) as total_parking,
        COUNT(DISTINCT rv.revision_id) as revision_count
       FROM reports r
       LEFT JOIN revisions rv ON r.report_id = rv.report_id
       ${whereClause}
       GROUP BY r.worker_name, r.worker_company
       ORDER BY r.worker_name`,
      params
    );

    // 欠勤・遅刻等の詳細
    const [details] = await connection.query(
      `SELECT 
        worker_name,
        report_date,
        clock_in_time,
        transport_type,
        parking_fee,
        is_sent
       FROM reports
       ${whereClause}
       ORDER BY report_date DESC`,
      params
    );

    await connection.release();

    res.status(200).json({
      success: true,
      period: { year, month, start_date: startDate, end_date: endDate },
      summary: summary,
      details: details
    });

  } catch (error) {
    console.error('月次集計エラー:', error);
    res.status(500).json({
      error: '月次集計の取得に失敗しました',
      code: 'MONTHLY_SUMMARY_ERROR'
    });
  }
});

// ============================================================
// 5. 日別報告状況を取得
// ============================================================

router.get('/daily-status', async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({
        error: '日付が必要です',
        code: 'MISSING_DATE'
      });
    }

    const connection = await pool.getConnection();

    // 報告済み
    const [reported] = await connection.query(
      `SELECT worker_name, worker_company, clock_in_time, transport_type
       FROM reports
       WHERE report_date = ? AND is_sent = TRUE
       ORDER BY clock_in_time DESC`,
      [date]
    );

    // 未報告（登録職人から報告がない人）
    const [allWorkers] = await connection.query(
      `SELECT DISTINCT u.name, u.company
       FROM users u
       WHERE u.role = 'worker' AND u.is_active = TRUE`,
      []
    );

    const reportedNames = reported.map(r => r.worker_name);
    const unreported = allWorkers.filter(w => !reportedNames.includes(w.name));

    // 修正待ち
    const [revisionPending] = await connection.query(
      `SELECT r.revision_id, r.report_id, rpt.worker_name, rpt.report_date
       FROM revisions r
       JOIN reports rpt ON r.report_id = rpt.report_id
       WHERE rpt.report_date = ? AND r.approval_status = 'pending'`,
      [date]
    );

    await connection.release();

    res.status(200).json({
      success: true,
      date: date,
      reported_count: reported.length,
      total_workers: allWorkers.length,
      reported: reported,
      unreported: unreported,
      revision_pending: revisionPending
    });

  } catch (error) {
    console.error('日別状況取得エラー:', error);
    res.status(500).json({
      error: '日別状況の取得に失敗しました',
      code: 'DAILY_STATUS_ERROR'
    });
  }
});

// ============================================================
// ヘルパー関数
// ============================================================

async function logAuditAction(connection, userId, userName, userRole, actionType, targetTable, targetId, ipAddress) {
  try {
    await connection.query(
      `INSERT INTO audit_logs (log_id, user_id, user_name, user_role, action_type, target_table, target_id, ip_address, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [uuidv4(), userId, userName, userRole, actionType, targetTable, targetId, ipAddress]
    );
  } catch (error) {
    console.error('監査ログ記録エラー:', error);
  }
}

// ============================================================
// エクスポート
// ============================================================

module.exports = router;