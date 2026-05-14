-- ============================================================
-- db/schema.sql - J's Inc. 勤務管理システム データベーススキーマ
-- ============================================================

-- ============================================================
-- users テーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  company VARCHAR(100),
  role ENUM('worker','boss','admin_office','admin_exec') DEFAULT 'worker',
  pin_hash VARCHAR(255) NOT NULL,
  device_id VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_role (role),
  INDEX idx_device_id (device_id),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- reports テーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS reports (
  report_id VARCHAR(32) PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL,
  worker_name VARCHAR(50) NOT NULL,
  worker_company VARCHAR(100),
  report_date DATE NOT NULL,
  clock_in_time TIME NOT NULL,
  transport_type VARCHAR(20),
  parking_fee DECIMAL(10,2),
  parking_photo_url TEXT,
  site_photo_url TEXT,
  gps_address VARCHAR(255),
  site_name VARCHAR(100),
  memo TEXT,
  weather VARCHAR(50),
  temperature DECIMAL(5,2),
  is_sent BOOLEAN DEFAULT FALSE,
  is_pinned BOOLEAN DEFAULT FALSE,
  revision_requested BOOLEAN DEFAULT FALSE,
  boss_note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_device_id (device_id),
  INDEX idx_report_date (report_date),
  INDEX idx_worker_name (worker_name),
  UNIQUE KEY uk_device_date (device_id, report_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- revisions テーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS revisions (
  revision_id VARCHAR(32) PRIMARY KEY,
  report_id VARCHAR(32) NOT NULL,
  revision_requester VARCHAR(50) NOT NULL,
  revision_reason JSON,
  revision_comment TEXT,
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  response_deadline TIMESTAMP,
  resubmitted_data JSON,
  resubmitted_at TIMESTAMP,
  approval_status ENUM('pending','approved','rejected') DEFAULT 'pending',
  approver_id VARCHAR(50),
  approved_at TIMESTAMP,
  approval_comment TEXT,
  
  FOREIGN KEY (report_id) REFERENCES reports(report_id) ON DELETE CASCADE,
  INDEX idx_report_id (report_id),
  INDEX idx_approval_status (approval_status),
  INDEX idx_requested_at (requested_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- hierarchy テーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS hierarchy (
  hierarchy_id VARCHAR(32) PRIMARY KEY,
  parent_report_id VARCHAR(32) NOT NULL,
  parent_boss_id VARCHAR(50) NOT NULL,
  higher_boss_id VARCHAR(50),
  report_content TEXT,
  report_sent_at TIMESTAMP,
  report_approved_at TIMESTAMP,
  approval_status ENUM('pending','approved','rejected') DEFAULT 'pending',
  approval_comment TEXT,
  
  FOREIGN KEY (parent_report_id) REFERENCES reports(report_id) ON DELETE CASCADE,
  INDEX idx_parent_boss_id (parent_boss_id),
  INDEX idx_higher_boss_id (higher_boss_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- audit_logs テーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32),
  user_name VARCHAR(50),
  user_role VARCHAR(20),
  action_type VARCHAR(50) NOT NULL,
  target_table VARCHAR(50),
  target_id VARCHAR(32),
  changes_before JSON,
  changes_after JSON,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45),
  
  INDEX idx_timestamp (timestamp),
  INDEX idx_user_id (user_id),
  INDEX idx_action_type (action_type),
  INDEX idx_target_id (target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- settings テーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  setting_id VARCHAR(32) PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value JSON,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  INDEX idx_setting_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 初期データ挿入
-- ============================================================

INSERT IGNORE INTO users (user_id, name, company, role, pin_hash, is_active)
VALUES 
  ('boss_001', '山本 親方', '株式会社J\'s', 'boss', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/KFm', TRUE),
  ('admin_001', '事務 太郎', '株式会社J\'s', 'admin_office', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcg7b3XeKeUxWdeS86E36P4/KFm', TRUE);

INSERT IGNORE INTO settings (setting_id, setting_key, setting_value, description)
VALUES 
  ('setting_001', 'standard_work_hours', '{\"hours\": 8, \"start\": \"08:00\", \"end\": \"17:00\"}', '標準勤務時間'),
  ('setting_002', 'overtime_multiplier', '{\"rate\": 1.25}', '残業単価倍率'),
  ('setting_003', 'revision_deadline_default', '{\"days\": 1}', '修正依頼デフォルト期限');

SET FOREIGN_KEY_CHECKS = 1;
FLUSH PRIVILEGES;
COMMIT;