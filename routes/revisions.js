// ============================================================
// routes/revisions.js - 修正依頼・再提出管理 (PostgreSQL対応)
// ============================================================

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/connection');
const { checkPermission } = require('../middleware/auth');
require('dotenv').config();

// ============================================================
// 1. 修正依頼を提出 (親方・事務用)
// ============================================================

router.post('/request', checkPermission('request_revision'), async (req, res) => {
  try {
    const {
      report_id,
      reasons,           // 複数選択可能な理由配列
      comment,           // 詳細メッセージ
      deadline_type      // 'next_business_day' / '3_days' / '1_week'
    } = req.body;

    // バリデーション
    if (!report_id || !reasons || reasons.length === 0) {
      return res.status(400).json({
        error: 'レポートIDと修正理由が必須です',
        code: 'MISSING_REQUIRED_FIELDS'
      });
    }

    try {
      // 日報が存在するか確認
      const reportResult = await pool.query(
        'SELECT report_id, worker_name, report_date, device_id FROM reports WHERE report_id = $1',
        [report_id]
      );

      if (!reportResult.rows || reportResult.rows.length === 0) {
        return res.status(404).json({
          error: '日報が見つかりません',
          code: 'REPORT_NOT_FOUND'
        });
      }

      const report = reportResult.rows[0];

      // 応答期限を計算
      const now = new Date();
      let deadline;

      switch (deadline_type) {
        case 'next_business_day':
          deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          // 土日判定の実装は別途（簡略版）
          break;
        case '3_days':
          deadline = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
          break;
        case '1_week':
          deadline = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        default:
          deadline = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      }

      const revisionId = `rev_${uuidv4().substring(0, 16)}`;

      // 修正依頼を作成
      await pool.query(
        `INSERT INTO revisions
         (revision_id, report_id, revision_requester, revision_reason, revision_comment,
          requested_at, response_deadline, approval_status)
         VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, 'pending')`,
        [
          revisionId,
          report_id,
          req.user.user_id,
          JSON.stringify(reasons),
          comment,
          deadline.toISOString()
        ]
      );

      // 日報にフラグを立てる
      await pool.query(
        'UPDATE reports SET revision_requested = TRUE WHERE report_id = $1',
        [report_id]
      );

      // 監査ログに記録
      await logAuditAction(
        req.user.user_id,
        req.user.name,
        req.user.role,
        'revision_requested',
        'revisions',
        revisionId,
        req.ip,
        { reasons, comment, deadline: deadline.toISOString() }
      );

      // WebSocket で職人に通知（別途実装）
      // io.to(`device:${report.device_id}`).emit('revision-notification', {...})

      res.status(201).json({
        success: true,
        revision_id: revisionId,
        worker_name: report.worker_name,
        report_date: report.report_date,
        deadline: deadline.toISOString(),
        message: '修正依頼を提出しました'
      });

    } catch (error) {
      throw error;
    }

  } catch (error) {
    console.error('修正依頼提出エラー:', error);
    res.status(500).json({
      error: '修正依頼の提出に失敗しました',
      code: 'REVISION_REQUEST_ERROR'
    });
  }
});

// ============================================================
// 2. 修正依頼一覧を取得 (親方・事務用)
// ============================================================

router.get('/pending', checkPermission('view_audit_logs'), async (req, res) => {
  try {
    const { status, worker_name } = req.query;

    // SQL を構築
    let whereClause = '1=1';
    let params = [];
    let paramIndex = 1;

    if (status) {
      whereClause += ` AND r.approval_status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (worker_name) {
      whereClause += ` AND rpt.worker_name = $${paramIndex}`;
      params.push(worker_name);
      paramIndex++;
    }

    const result = await pool.query(
      `SELECT
        r.revision_id,
        r.report_id,
        rpt.worker_name,
        rpt.worker_company,
        rpt.report_date,
        r.revision_reason,
        r.revision_comment,
        r.requested_at,
        r.response_deadline,
        r.approval_status,
        r.resubmitted_at,
        r.resubmitted_data,
        r.approver_id,
        r.approved_at,
        r.approval_comment
       FROM revisions r
       JOIN reports rpt ON r.report_id = rpt.report_id
       WHERE ${whereClause}
       ORDER BY r.requested_at DESC`,
      params
    );

    const now = new Date();
    const formattedRevisions = result.rows.map(r => ({
      revision_id: r.revision_id,
      report_id: r.report_id,
      worker_name: r.worker_name,
      worker_company: r.worker_company,
      report_date: r.report_date,
      reasons: typeof r.revision_reason === 'string' ? JSON.parse(r.revision_reason) : r.revision_reason,
      comment: r.revision_comment,
      requested_at: r.requested_at,
      deadline: r.response_deadline,
      is_overdue: new Date(r.response_deadline) < now,
      status: r.approval_status,
      resubmitted_at: r.resubmitted_at,
      resubmitted_data: r.resubmitted_data ? (typeof r.resubmitted_data === 'string' ? JSON.parse(r.resubmitted_data) : r.resubmitted_data) : null,
      approval: r.approval_status !== 'pending' ? {
        approver_id: r.approver_id,
        approved_at: r.approved_at,
        comment: r.approval_comment
      } : null
    }));

    res.status(200).json({
      success: true,
      count: formattedRevisions.length,
      revisions: formattedRevisions
    });

  } catch (error) {
    console.error('修正依頼一覧取得エラー:', error);
    res.status(500).json({
      error: '修正依頼一覧の取得に失敗しました',
      code: 'REVISION_LIST_ERROR'
    });
  }
});

// ============================================================
// 3. 修正依頼を承認 (親方・事務用)
// ============================================================

router.post('/:revision_id/approve', checkPermission('approve_revision'), async (req, res) => {
  try {
    const { revision_id } = req.params;
    const { comment } = req.body;

    try {
      // 修正依頼を取得
      const result = await pool.query(
        `SELECT r.*, rpt.worker_name, rpt.report_date
         FROM revisions r
         JOIN reports rpt ON r.report_id = rpt.report_id
         WHERE r.revision_id = $1`,
        [revision_id]
      );

      if (!result.rows || result.rows.length === 0) {
        return res.status(404).json({
          error: '修正依頼が見つかりません',
          code: 'REVISION_NOT_FOUND'
        });
      }

      const revision = result.rows[0];

      // 修正依頼を承認
      await pool.query(
        `UPDATE revisions
         SET approval_status = 'approved',
             approver_id = $1,
             approved_at = CURRENT_TIMESTAMP,
             approval_comment = $2
         WHERE revision_id = $3`,
        [req.user.user_id, comment || '', revision_id]
      );

      // 日報のフラグを解除
      await pool.query(
        'UPDATE reports SET revision_requested = FALSE WHERE report_id = $1',
        [revision.report_id]
      );

      // 監査ログに記録
      await logAuditAction(
        req.user.user_id,
        req.user.name,
        req.user.role,
        'revision_approved',
        'revisions',
        revision_id,
        req.ip,
        { worker_name: revision.worker_name, report_date: revision.report_date }
      );

      res.status(200).json({
        success: true,
        revision_id: revision_id,
        worker_name: revision.worker_name,
        approved_at: new Date().toISOString(),
        message: '修正を承認しました'
      });

    } catch (error) {
      throw error;
    }

  } catch (error) {
    console.error('修正承認エラー:', error);
    res.status(500).json({
      error: '修正承認に失敗しました',
      code: 'REVISION_APPROVE_ERROR'
    });
  }
});

// ============================================================
// 4. 修正依頼を却下 (親方・事務用)
// ============================================================

router.post('/:revision_id/reject', checkPermission('approve_revision'), async (req, res) => {
  try {
    const { revision_id } = req.params;
    const { comment } = req.body;

    try {
      const result = await pool.query(
        'SELECT revision_id FROM revisions WHERE revision_id = $1',
        [revision_id]
      );

      if (!result.rows || result.rows.length === 0) {
        return res.status(404).json({
          error: '修正依頼が見つかりません',
          code: 'REVISION_NOT_FOUND'
        });
      }

      // 修正依頼を却下（次度の修正依頼が可能）
      await pool.query(
        `UPDATE revisions
         SET approval_status = 'rejected',
             approver_id = $1,
             approved_at = CURRENT_TIMESTAMP,
             approval_comment = $2
         WHERE revision_id = $3`,
        [req.user.user_id, comment || '', revision_id]
      );

      // 監査ログに記録
      await logAuditAction(
        req.user.user_id,
        req.user.name,
        req.user.role,
        'revision_rejected',
        'revisions',
        revision_id,
        req.ip,
        { reason: comment }
      );

      res.status(200).json({
        success: true,
        revision_id: revision_id,
        message: '修正を却下しました'
      });

    } catch (error) {
      throw error;
    }

  } catch (error) {
    console.error('修正却下エラー:', error);
    res.status(500).json({
      error: '修正却下に失敗しました',
      code: 'REVISION_REJECT_ERROR'
    });
  }
});

// ============================================================
// 5. 修正依頼の詳細を取得 (職人・親方・事務用)
// ============================================================

router.get('/:revision_id', async (req, res) => {
  try {
    const { revision_id } = req.params;

    const result = await pool.query(
      `SELECT r.*, rpt.report_date, rpt.worker_name, rpt.worker_company
       FROM revisions r
       JOIN reports rpt ON r.report_id = rpt.report_id
       WHERE r.revision_id = $1`,
      [revision_id]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({
        error: '修正依頼が見つかりません',
        code: 'REVISION_NOT_FOUND'
      });
    }

    const revision = result.rows[0];

    res.status(200).json({
      success: true,
      revision: {
        revision_id: revision.revision_id,
        report_id: revision.report_id,
        worker_name: revision.worker_name,
        worker_company: revision.worker_company,
        report_date: revision.report_date,
        reasons: typeof revision.revision_reason === 'string' ? JSON.parse(revision.revision_reason) : revision.revision_reason,
        comment: revision.revision_comment,
        requested_at: revision.requested_at,
        deadline: revision.response_deadline,
        status: revision.approval_status,
        resubmitted_at: revision.resubmitted_at,
        resubmitted_data: revision.resubmitted_data ? (typeof revision.resubmitted_data === 'string' ? JSON.parse(revision.resubmitted_data) : revision.resubmitted_data) : null,
        approval: {
          approver_id: revision.approver_id,
          approved_at: revision.approved_at,
          comment: revision.approval_comment
        }
      }
    });

  } catch (error) {
    console.error('修正依頼詳細取得エラー:', error);
    res.status(500).json({
      error: '修正依頼詳細の取得に失敗しました',
      code: 'REVISION_DETAIL_ERROR'
    });
  }
});

// ============================================================
// 6. 修正依頼の履歴を取得 (親方・事務用)
// ============================================================

router.get('/history/:report_id', checkPermission('view_audit_logs'), async (req, res) => {
  try {
    const { report_id } = req.params;

    const result = await pool.query(
      `SELECT * FROM revisions
       WHERE report_id = $1
       ORDER BY requested_at DESC`,
      [report_id]
    );

    const formattedRevisions = result.rows.map(r => ({
      revision_id: r.revision_id,
      reasons: typeof r.revision_reason === 'string' ? JSON.parse(r.revision_reason) : r.revision_reason,
      comment: r.revision_comment,
      requested_at: r.requested_at,
      deadline: r.response_deadline,
      status: r.approval_status,
      resubmitted_at: r.resubmitted_at,
      approval: {
        approver_id: r.approver_id,
        approved_at: r.approved_at,
        comment: r.approval_comment
      }
    }));

    res.status(200).json({
      success: true,
      report_id: report_id,
      revision_count: result.rows.length,
      revisions: formattedRevisions
    });

  } catch (error) {
    console.error('修正履歴取得エラー:', error);
    res.status(500).json({
      error: '修正履歴の取得に失敗しました',
      code: 'REVISION_HISTORY_ERROR'
    });
  }
});

// ============================================================
// ヘルパー関数
// ============================================================

async function logAuditAction(userId, userName, userRole, actionType, targetTable, targetId, ipAddress, changeData = {}) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (log_id, user_id, user_name, user_role, action_type, target_table, target_id, changes_after, ip_address, timestamp)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, CURRENT_TIMESTAMP)`,
      [
        uuidv4(),
        userId,
        userName,
        userRole,
        actionType,
        targetTable,
        targetId,
        JSON.stringify(changeData),
        ipAddress
      ]
    );
  } catch (error) {
    console.error('監査ログ記録エラー:', error);
  }
}

// ============================================================
// エクスポート
// ============================================================

module.exports = router;