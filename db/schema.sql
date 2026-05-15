-- ============================================================
-- db/schema.sql - J's Inc. 勤務管理システム データベーススキーマ (PostgreSQL)
-- 拡張版：デバイス管理・複数認証対応
-- ============================================================

-- ============================================================
-- users テーブル：ユーザー基本情報
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(36) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  phone_number VARCHAR(20),
  email VARCHAR(100),
  company VARCHAR(100) DEFAULT '株式会社J''s',
  role VARCHAR(20) DEFAULT 'worker' CHECK (role IN ('worker','boss','admin_office','admin_exec')),
  pin_hash VARCHAR(255) NOT NULL,
  biometric_enabled BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_name ON users(name);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_phone ON users(phone_number);

-- ============================================================
-- devices テーブル：デバイス管理
-- ============================================================

CREATE TABLE IF NOT EXISTS devices (
  device_id VARCHAR(100) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  device_name VARCHAR(100) NOT NULL,
  device_type VARCHAR(20) CHECK (device_type IN ('smartphone','tablet','pc')),
  os_type VARCHAR(20) CHECK (os_type IN ('android','ios','windows','macos','linux')),
  model_name VARCHAR(100),
  fcm_token TEXT,
  is_primary BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  last_used_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_devices_user_id ON devices(user_id);
CREATE INDEX idx_devices_device_type ON devices(device_type);
CREATE INDEX idx_devices_is_active ON devices(is_active);

-- ============================================================
-- authentication_logs テーブル：認証ログ
-- ============================================================

CREATE TABLE IF NOT EXISTS authentication_logs (
  auth_log_id VARCHAR(36) PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
  user_id VARCHAR(36) REFERENCES users(user_id),
  auth_method VARCHAR(20) CHECK (auth_method IN ('pin','biometric','second_factor')),
  auth_status VARCHAR(20) CHECK (auth_status IN ('success','failed','timeout')),
  ip_address VARCHAR(45),
  user_agent TEXT,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_auth_logs_device ON authentication_logs(device_id);
CREATE INDEX idx_auth_logs_user ON authentication_logs(user_id);
CREATE INDEX idx_auth_logs_timestamp ON authentication_logs(timestamp);

-- ============================================================
-- reports テーブル：日報データ
-- ============================================================

CREATE TABLE IF NOT EXISTS reports (
  report_id VARCHAR(36) PRIMARY KEY,
  device_id VARCHAR(100) NOT NULL REFERENCES devices(device_id),
  user_id VARCHAR(36) NOT NULL REFERENCES users(user_id),
  worker_name VARCHAR(50) NOT NULL,
  worker_company VARCHAR(100),
  report_date DATE NOT NULL,
  clock_in_time TIME NOT NULL,
  clock_out_time TIME,
  transport_type VARCHAR(20),
  parking_fee DECIMAL(10,2),
  parking_photo_url TEXT,
  site_photo_url TEXT,
  gps_address VARCHAR(255),
  site_name VARCHAR(100),
  work_content TEXT,
  memo TEXT,
  weather VARCHAR(50),
  temperature DECIMAL(5,2),
  is_sent BOOLEAN DEFAULT FALSE,
  is_pinned BOOLEAN DEFAULT FALSE,
  revision_requested BOOLEAN DEFAULT FALSE,
  boss_note TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, report_date)
);

CREATE INDEX idx_reports_user ON reports(user_id);
CREATE INDEX idx_reports_device ON reports(device_id);
CREATE INDEX idx_reports_date ON reports(report_date);
CREATE INDEX idx_reports_worker_name ON reports(worker_name);

-- ============================================================
-- revisions テーブル：修正依頼
-- ============================================================

CREATE TABLE IF NOT EXISTS revisions (
  revision_id VARCHAR(36) PRIMARY KEY,
  report_id VARCHAR(36) NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  revision_requester VARCHAR(50) NOT NULL,
  revision_reason JSONB,
  revision_comment TEXT,
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  response_deadline TIMESTAMP,
  resubmitted_data JSONB,
  resubmitted_at TIMESTAMP,
  approval_status VARCHAR(20) DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  approver_id VARCHAR(50),
  approved_at TIMESTAMP,
  approval_comment TEXT
);

CREATE INDEX idx_revisions_report ON revisions(report_id);
CREATE INDEX idx_revisions_approval_status ON revisions(approval_status);
CREATE INDEX idx_revisions_requested_at ON revisions(requested_at);

-- ============================================================
-- hierarchy テーブル：承認フロー
-- ============================================================

CREATE TABLE IF NOT EXISTS hierarchy (
  hierarchy_id VARCHAR(36) PRIMARY KEY,
  parent_report_id VARCHAR(36) NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  parent_boss_id VARCHAR(50) NOT NULL,
  higher_boss_id VARCHAR(50),
  report_content TEXT,
  report_sent_at TIMESTAMP,
  report_approved_at TIMESTAMP,
  approval_status VARCHAR(20) DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  approval_comment TEXT
);

CREATE INDEX idx_hierarchy_parent_boss ON hierarchy(parent_boss_id);
CREATE INDEX idx_hierarchy_higher_boss ON hierarchy(higher_boss_id);

-- ============================================================
-- audit_logs テーブル：監査ログ
-- ============================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36),
  user_name VARCHAR(50),
  user_role VARCHAR(20),
  action_type VARCHAR(50) NOT NULL,
  target_table VARCHAR(50),
  target_id VARCHAR(36),
  changes_before JSONB,
  changes_after JSONB,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45)
);

CREATE INDEX idx_audit_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_audit_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_action_type ON audit_logs(action_type);
CREATE INDEX idx_audit_target_id ON audit_logs(target_id);

-- ============================================================
-- settings テーブル：システム設定
-- ============================================================

CREATE TABLE IF NOT EXISTS settings (
  setting_id VARCHAR(36) PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value JSONB,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_settings_key ON settings(setting_key);

-- ============================================================
-- 初期データ挿入
-- ============================================================

INSERT INTO users (user_id, name, phone_number, email, company, role, pin_hash, is_active)
VALUES
  ('user_boss_001', '山本 親方', '090-1234-5678', 'yamamoto@j-denki.jp', '株式会社J''s', 'boss', '$2b$10$abcdefghijklmnopqrstuvwxyz123456789012345678901234567', TRUE),
  ('user_admin_001', '事務 太郎', '090-9876-5432', 'jimusu@j-denki.jp', '株式会社J''s', 'admin_office', '$2b$10$abcdefghijklmnopqrstuvwxyz123456789012345678901234567', TRUE)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO devices (device_id, user_id, device_name, device_type, os_type, is_primary, is_active)
VALUES
  ('device_boss_smartphone_001', 'user_boss_001', '山本親方のスマートフォン', 'smartphone', 'android', TRUE, TRUE),
  ('device_admin_pc_001', 'user_admin_001', '事務太郎のPC', 'pc', 'windows', TRUE, TRUE)
ON CONFLICT (device_id) DO NOTHING;

INSERT INTO settings (setting_id, setting_key, setting_value, description)
VALUES
  ('setting_001', 'standard_work_hours', '{"hours": 8, "start": "08:00", "end": "17:00"}', '標準勤務時間'),
  ('setting_002', 'overtime_multiplier', '{"rate": 1.25}', '残業単価倍率'),
  ('setting_003', 'revision_deadline_default', '{"days": 1}', '修正依頼デフォルト期限'),
  ('setting_004', 'biometric_enabled', '{"enabled": true}', '生体認証の有効化'),
  ('setting_005', 'second_factor_required', '{"enabled": false}', '第2認証の必須化')
ON CONFLICT (setting_id) DO NOTHING;

COMMIT;