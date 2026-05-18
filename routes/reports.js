// ============================================================
// routes/reports.js - 日報管理API
// ============================================================

const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool    = require('../db/connection');

// ============================================================
// POST /api/v1/reports - 日報送信
// ============================================================

router.post('/', async (req, res) => {
  try {
    const { user_id, company_id } = req.user;

    const {
      worker_name,
      worker_company,
      report_date,
      clock_in_time,
      clock_out_time,
      transport_type,
      parking_fee,
      parking_photo_url,
      site_photo_url,
      gps_address,
      site_name,
      work_content,
      memo,
      weather,
      temperature,
      site_id,
    } = req.body;

    if (!worker_name || !report_date || !clock_in_time) {
      return res.status(400).json({
        success: false,
        error:   '名前・日付・出勤時刻は必須です'
      });
    }

    const report_id = uuidv4();

    // デバイスIDを取得
    const deviceResult = await pool.query(
      `SELECT device_id FROM devices WHERE user_id = $1 AND is_active = TRUE LIMIT 1`,
      [user_id]
    );
    const device_id = deviceResult.rows[0]?.device_id || uuidv4();

    await pool.query(`
      INSERT INTO reports (
        report_id, device_id, user_id,
        worker_name, worker_company,
        report_date, clock_in_time, clock_out_time,
        transport_type, parking_fee,
        parking_photo_url, site_photo_url,
        gps_address, site_name,
        work_content, memo,
        weather, temperature,
        is_sent, is_pinned,
        revision_requested, site_id
      ) VALUES (
        $1, $2, $3,
        $4, $5,
        $6, $7, $8,
        $9, $10,
        $11, $12,
        $13, $14,
        $15, $16,
        $17, $18,
        TRUE, FALSE,
        FALSE, $19
      )
      ON CONFLICT (user_id, report_date) DO UPDATE SET
        worker_name       = EXCLUDED.worker_name,
        transport_type    = EXCLUDED.transport_type,
        parking_fee       = EXCLUDED.parking_fee,
        gps_address       = EXCLUDED.gps_address,
        site_name         = EXCLUDED.site_name,
        work_content      = EXCLUDED.work_content,
        memo              = EXCLUDED.memo,
        updated_at        = CURRENT_TIMESTAMP
    `, [
      report_id, device_id, user_id,
      worker_name, worker_company || null,
      report_date, clock_in_time, clock_out_time || null,
      transport_type || null, parking_fee || null,
      parking_photo_url || null, site_photo_url || null,
      gps_address || null, site_name || null,
      work_content || null, memo || null,
      weather || null, temperature || null,
      site_id || null
    ]);

    console.log(`✅ 日報受信: ${worker_name} (${report_date})`);

    res.status(201).json({
      success:   true,
      message:   '日報を受信しました',
      report_id: report_id
    });

  } catch (err) {
    console.error('日報受信エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// GET /api/v1/reports - 日報一覧取得
// ============================================================

router.get('/', async (req, res) => {
  try {
    const { user_id, role, company_id } = req.user;
    const { date, limit = 50 } = req.query;

    let query;
    let params;

    if (role === 'worker') {
      // 職人は自分の日報のみ
      query = `
        SELECT * FROM reports
        WHERE user_id = $1
        ${date ? 'AND report_date = $2' : ''}
        ORDER BY report_date DESC, created_at DESC
        LIMIT $${date ? 3 : 2}
      `;
      params = date ? [user_id, date, limit] : [user_id, limit];
    } else {
      // 職長・事務は自社の全日報
      query = `
        SELECT r.* FROM reports r
        JOIN users u ON r.user_id = u.user_id
        WHERE u.company_id = $1
        ${date ? 'AND r.report_date = $2' : ''}
        ORDER BY r.report_date DESC, r.created_at DESC
        LIMIT $${date ? 3 : 2}
      `;
      params = date ? [company_id, date, limit] : [company_id, limit];
    }

    const result = await pool.query(query, params);

    res.json({
      success: true,
      reports: result.rows
    });
  } catch (err) {
    console.error('日報一覧取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

// ============================================================
// GET /api/v1/reports/:report_id - 日報詳細
// ============================================================

router.get('/:report_id', async (req, res) => {
  try {
    const { report_id } = req.params;
    const result = await pool.query(
      'SELECT * FROM reports WHERE report_id = $1',
      [report_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: '日報が見つかりません' });
    }

    res.json({ success: true, report: result.rows[0] });
  } catch (err) {
    console.error('日報詳細取得エラー:', err.message);
    res.status(500).json({ success: false, error: 'サーバーエラー' });
  }
});

module.exports = router;