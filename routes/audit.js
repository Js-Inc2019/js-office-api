// ============================================================
// routes/audit.js - 監査ログ・改ざん検知
// ============================================================

const express = require('express');
const router = express.Router();
const pool = require('../db/connection');
const { checkPermission } = require('../middleware/auth');
require('dotenv').config();

// ============================================================
// 1. 監査ログ一覧を取得（事務用）
// ============================================================

router.get('/', checkPermission('view_audit_logs'), async (req, res) => {
  try {
    const {
      start_date,
      end_date,
      user_id,
      action_type,
      target_table,
      limit = 100,
      offset = 0
    } = req.query;

    const connection = await pool.getConnection();

    try {
      // SQL を構築
      let whereClause = 'WHERE 1=1';
      let params = [];

      if (start_date) {
        whereClause += ' AND DATE(timestamp) >= ?';
        params.push(start_date);
      }

      if (end_date) {
        whereClause += ' AND DATE(timestamp) <= ?';
        params.push(end_date);
      }

      if (user_id) {
        whereClause += ' AND user_id = ?';
        params.push(user_id);
      }

      if (action_type) {
        whereClause += ' AND action_type = ?';
        params.push(action_type);
      }

      if (target_table) {
        whereClause += ' AND target_table = ?';
        params.push(target_table);
      }

      // 総件数を取得
      const [countResult] = await connection.query(
        `SELECT COUNT(*) as total FROM audit_logs ${whereClause}`,
        params
      );

      const totalCount = countResult[0].total;

      // ログを取得
      const [logs] = await connection.query(
        `SELECT * FROM audit_logs 
         ${whereClause}
         ORDER BY timestamp DESC 
         LIMIT ? OFFSET ?`,
        [...params, parseInt(limit), parseInt(offset)]
      );

      await connection.release();

      // JSON データをパース
      const formattedLogs = logs.map(log => ({
        log_id: log.log_id,
        user_id: log.user_id,
        user_name: log.user_name,
        user_role: log.user_role,
        action_type: log.action_type,
        target_table: log.target_table,
        target_id: log.target_id,
        changes_before: log.changes_before ? JSON.parse(log.changes_before) : null,
        changes_after: log.changes_after ? JSON.parse(log.changes_after) : null,
        timestamp: log.timestamp,
        ip_address: log.ip_address
      }));

      res.status(200).json({
        success: true,
        pagination: {
          total: totalCount,
          limit: parseInt(limit),
          offset: parseInt(offset),
          pages: Math.ceil(totalCount / parseInt(limit))
        },
        logs: formattedLogs
      });

    } catch (error) {
      await connection.release();
      throw error;
    }

  } catch (error) {
    console.error('監査ログ取得エラー:', error);
    res.status(500).json({
      error: '監査ログの取得に失敗しました',
      code: 'AUDIT_LOG_ERROR'
    });
  }
});

// ============================================================
// 2. 特定のユーザーの操作履歴を取得
// ============================================================

router.get('/user/:user_id', checkPermission('view_audit_logs'), async (req, res) => {
  try {
    const { user_id } = req.params;
    const { limit = 50, offset = 0 } = req.query;

    const connection = await pool.getConnection();

    try {
      // ユーザーの操作履歴を取得
      const [logs] = await connection.query(
        `SELECT * FROM audit_logs 
         WHERE user_id = ?
         ORDER BY timestamp DESC 
         LIMIT ? OFFSET ?`,
        [user_id, parseInt(limit), parseInt(offset)]
      );

      // ユーザー情報を取得
      const [users] = await connection.query(
        'SELECT user_id, name, role, company FROM users WHERE user_id = ?',
        [user_id]
      );

      await connection.release();

      if (!users || users.length === 0) {
        return res.status(404).json({
          error: 'ユーザーが見つかりません',
          code: 'USER_NOT_FOUND'
        });
      }

      const user = users[0];
      const formattedLogs = logs.map(log => ({
        log_id: log.log_id,
        action_type: log.action_type,
        target_table: log.target_table,
        target_id: log.target_id,
        changes: {
          before: log.changes_before ? JSON.parse(log.changes_before) : null,
          after: log.changes_after ? JSON.parse(log.changes_after) : null
        },
        timestamp: log.timestamp,
        ip_address: log.ip_address
      }));

      res.status(200).json({
        success: true,
        user: {
          user_id: user.user_id,
          name: user.name,
          role: user.role,
          company: user.company
        },
        operation_count: logs.length,
        logs: formattedLogs
      });

    } catch (error) {
      await connection.release();
      throw error;
    }

  } catch (error) {
    console.error('ユーザー操作履歴取得エラー:', error);
    res.status(500).json({
      error: 'ユーザー操作履歴の取得に失敗しました',
      code: 'USER_OPERATION_ERROR'
    });
  }
});

// ============================================================
// 3. 特定の日報に対する全操作を追跡
// ============================================================

router.get('/report/:report_id', checkPermission('view_audit_logs'), async (req, res) => {
  try {
    const { report_id } = req.params;

    const connection = await pool.getConnection();

    try {
      // 日報の全操作を取得
      const [logs] = await connection.query(
        `SELECT * FROM audit_logs 
         WHERE target_id = ? OR (target_table = 'reports' AND target_id LIKE ?)
         ORDER BY timestamp ASC`,
        [report_id, `%${report_id}%`]
      );

      // 日報情報を取得
      const [reports] = await connection.query(
        'SELECT report_id, worker_name, report_date, is_sent FROM reports WHERE report_id = ?',
        [report_id]
      );

      // 修正依頼情報を取得
      const [revisions] = await connection.query(
        'SELECT revision_id, approval_status FROM revisions WHERE report_id = ?',
        [report_id]
      );

      await connection.release();

      if (!reports || reports.length === 0) {
        return res.status(404).json({
          error: '日報が見つかりません',
          code: 'REPORT_NOT_FOUND'
        });
      }

      const report = reports[0];
      const revisionHistory = revisions.map(r => ({
        revision_id: r.revision_id,
        status: r.approval_status
      }));

      const formattedLogs = logs.map(log => ({
        log_id: log.log_id,
        user_id: log.user_id,
        user_name: log.user_name,
        action_type: log.action_type,
        changes: {
          before: log.changes_before ? JSON.parse(log.changes_before) : null,
          after: log.changes_after ? JSON.parse(log.changes_after) : null
        },
        timestamp: log.timestamp
      }));

      res.status(200).json({
        success: true,
        report: {
          report_id: report.report_id,
          worker_name: report.worker_name,
          report_date: report.report_date,
          is_sent: report.is_sent
        },
        revisions: revisionHistory,
        operation_history: formattedLogs
      });

    } catch (error) {
      await connection.release();
      throw error;
    }

  } catch (error) {
    console.error('日報操作履歴取得エラー:', error);
    res.status(500).json({
      error: '日報操作履歴の取得に失敗しました',
      code: 'REPORT_OPERATION_ERROR'
    });
  }
});

// ============================================================
// 4. 改ざん検知（承認済み日報が修正されていないか確認）
// ============================================================

router.get('/tamper-detection', checkPermission('view_audit_logs'), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const connection = await pool.getConnection();

    try {
      // 1. 承認済み修正依頼
      const [approvedRevisions] = await connection.query(
        `SELECT r.revision_id, r.report_id, r.approved_at, rpt.worker_name, rpt.report_date
         FROM revisions r
         JOIN reports rpt ON r.report_id = rpt.report_id
         WHERE r.approval_status = 'approved'
         ORDER BY r.approved_at DESC`
      );

      // 2. 各報告に対する承認後の操作を調査
      const tamperAlerts = [];

      for (const revision of approvedRevisions) {
        const [latestLogs] = await connection.query(
          `SELECT * FROM audit_logs 
           WHERE target_id = ? AND action_type = 'update' AND timestamp > ?
           ORDER BY timestamp DESC`,
          [revision.report_id, revision.approved_at]
        );

        if (latestLogs && latestLogs.length > 0) {
          // 承認後に更新があった！
          tamperAlerts.push({
            alert_type: 'POST_APPROVAL_UPDATE',
            revision_id: revision.revision_id,
            report_id: revision.report_id,
            worker_name: revision.worker_name,
            report_date: revision.report_date,
            approved_at: revision.approved_at,
            suspicious_update: {
              updated_by: latestLogs[0].user_name,
              updated_at: latestLogs[0].timestamp,
              change: {
                before: latestLogs[0].changes_before ? JSON.parse(latestLogs[0].changes_before) : null,
                after: latestLogs[0].changes_after ? JSON.parse(latestLogs[0].changes_after) : null
              }
            },
            severity: 'HIGH'
          });
        }
      }

      // 3. 短時間に複数の修正が入った場合
      const [suspiciousReports] = await connection.query(
        `SELECT target_id, COUNT(*) as update_count, 
                MIN(timestamp) as first_update, MAX(timestamp) as last_update
         FROM audit_logs
         WHERE action_type = 'update' AND target_table = 'reports'
         GROUP BY target_id
         HAVING update_count > 5`
      );

      for (const report of suspiciousReports || []) {
        tamperAlerts.push({
          alert_type: 'RAPID_MODIFICATIONS',
          report_id: report.target_id,
          update_count: report.update_count,
          update_period: {
            first: report.first_update,
            last: report.last_update
          },
          severity: 'MEDIUM'
        });
      }

      await connection.release();

      res.status(200).json({
        success: true,
        tamper_alerts: {
          count: tamperAlerts.length,
          alerts: tamperAlerts.sort((a, b) => 
            a.severity === 'HIGH' ? -1 : 1
          )
        },
        recommendation: tamperAlerts.length > 0 
          ? '⚠️ 不審な操作が検出されました。詳細を確認してください'
          : '✅ 改ざんは検出されませんでした'
      });

    } catch (error) {
      await connection.release();
      throw error;
    }

  } catch (error) {
    console.error('改ざん検知エラー:', error);
    res.status(500).json({
      error: '改ざん検知に失敗しました',
      code: 'TAMPER_DETECTION_ERROR'
    });
  }
});

// ============================================================
// 5. 操作統計を取得（ダッシュボード用）
// ============================================================

router.get('/stats/daily', checkPermission('view_audit_logs'), async (req, res) => {
  try {
    const { start_date, end_date } = req.query;

    const connection = await pool.getConnection();

    try {
      // 日別操作統計
      const [dailyStats] = await connection.query(
        `SELECT 
          DATE(timestamp) as date,
          action_type,
          COUNT(*) as count
         FROM audit_logs
         ${start_date ? 'WHERE DATE(timestamp) >= ?' : ''}
         ${end_date ? 'AND DATE(timestamp) <= ?' : ''}
         GROUP BY DATE(timestamp), action_type
         ORDER BY date DESC`,
        [start_date, end_date].filter(Boolean)
      );

      // ユーザー別操作統計
      const [userStats] = await connection.query(
        `SELECT 
          user_name,
          user_role,
          COUNT(*) as operation_count,
          COUNT(DISTINCT DATE(timestamp)) as active_days
         FROM audit_logs
         WHERE user_id IS NOT NULL
         GROUP BY user_name, user_role
         ORDER BY operation_count DESC
         LIMIT 20`
      );

      // 操作種別別統計
      const [actionStats] = await connection.query(
        `SELECT 
          action_type,
          COUNT(*) as count,
          COUNT(DISTINCT user_id) as user_count
         FROM audit_logs
         GROUP BY action_type
         ORDER BY count DESC`
      );

      await connection.release();

      res.status(200).json({
        success: true,
        statistics: {
          daily: dailyStats,
          by_user: userStats,
          by_action: actionStats
        }
      });

    } catch (error) {
      await connection.release();
      throw error;
    }

  } catch (error) {
    console.error('操作統計取得エラー:', error);
    res.status(500).json({
      error: '操作統計の取得に失敗しました',
      code: 'STATS_ERROR'
    });
  }
});

// ============================================================
// 6. ログをエクスポート（CSV/JSON）
// ============================================================

router.post('/export', checkPermission('view_audit_logs'), async (req, res) => {
  try {
    const { format = 'json', start_date, end_date } = req.body;

    const connection = await pool.getConnection();

    try {
      // ログを取得
      const [logs] = await connection.query(
        `SELECT * FROM audit_logs 
         WHERE DATE(timestamp) BETWEEN ? AND ?
         ORDER BY timestamp DESC`,
        [start_date || '2000-01-01', end_date || '2099-12-31']
      );

      await connection.release();

      if (format === 'csv') {
        // CSV形式
        const csv = convertToCSV(logs);
        res.status(200)
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().slice(0, 10)}.csv"`)
          .send(csv);
      } else {
        // JSON形式
        const json = logs.map(log => ({
          ...log,
          changes_before: log.changes_before ? JSON.parse(log.changes_before) : null,
          changes_after: log.changes_after ? JSON.parse(log.changes_after) : null
        }));

        res.status(200)
          .header('Content-Type', 'application/json; charset=utf-8')
          .header('Content-Disposition', `attachment; filename="audit_logs_${new Date().toISOString().slice(0, 10)}.json"`)
          .json(json);
      }

    } catch (error) {
      await connection.release();
      throw error;
    }

  } catch (error) {
    console.error('ログエクスポートエラー:', error);
    res.status(500).json({
      error: 'ログのエクスポートに失敗しました',
      code: 'EXPORT_ERROR'
    });
  }
});

// ============================================================
// ヘルパー関数
// ============================================================

function convertToCSV(logs) {
  if (!logs || logs.length === 0) return '';

  // ヘッダー
  const headers = ['log_id', 'user_name', 'action_type', 'target_table', 'target_id', 'timestamp', 'ip_address'];
  const csv = [headers.join(',')];

  // データ行
  for (const log of logs) {
    const row = [
      log.log_id,
      `"${log.user_name}"`,
      log.action_type,
      log.target_table,
      log.target_id,
      log.timestamp,
      log.ip_address
    ];
    csv.push(row.join(','));
  }

  return csv.join('\n');
}

// ============================================================
// エクスポート
// ============================================================

module.exports = router;