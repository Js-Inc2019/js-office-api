-- ============================================================
-- db/schema.sql - J's Inc. 勤務管理システム データベーススキーマ (PostgreSQL)
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  user_id VARCHAR(32) PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  company VARCHAR(100),
  role VARCHAR(20) DEFAULT 'worker' CHECK (role IN ('worker','boss','admin_office','admin_exec')),
  pin_hash VARCHAR(255) NOT NULL,
  device_id VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_role ON users(role);
CREATE INDEX idx_device_id ON users(device_id);
CREATE INDEX idx_name ON users(name);

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
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(device_id, report_date)
);

CREATE INDEX idx_device_id_reports ON reports(device_id);
CREATE INDEX idx_report_date ON reports(report_date);
CREATE INDEX idx_worker_name ON reports(worker_name);

CREATE TABLE IF NOT EXISTS revisions (
  revision_id VARCHAR(32) PRIMARY KEY,
  report_id VARCHAR(32) NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
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

CREATE INDEX idx_report_id_revisions ON revisions(report_id);
CREATE INDEX idx_approval_status ON revisions(approval_status);
CREATE INDEX idx_requested_at ON revisions(requested_at);

CREATE TABLE IF NOT EXISTS hierarchy (
  hierarchy_id VARCHAR(32) PRIMARY KEY,
  parent_report_id VARCHAR(32) NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  parent_boss_id VARCHAR(50) NOT NULL,
  higher_boss_id VARCHAR(50),
  report_content TEXT,
  report_sent_at TIMESTAMP,
  report_approved_at TIMESTAMP,
  approval_status VARCHAR(20) DEFAULT 'pending' CHECK (approval_status IN ('pending','approved','rejected')),
  approval_comment TEXT
);

CREATE INDEX idx_parent_boss_id ON hierarchy(parent_boss_id);
CREATE INDEX idx_higher_boss_id ON hierarchy(higher_boss_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  log_id VARCHAR(32) PRIMARY KEY,
  user_id VARCHAR(32),
  user_name VARCHAR(50),
  user_role VARCHAR(20),
  action_type VARCHAR(50) NOT NULL,
  target_table VARCHAR(50),
  target_id VARCHAR(32),
  changes_before JSONB,
  changes_after JSONB,
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  ip_address VARCHAR(45)
);

CREATE INDEX idx_timestamp ON audit_logs(timestamp);
CREATE INDEX idx_user_id ON audit_logs(user_id);
CREATE INDEX idx_action_type ON audit_logs(action_type);
CREATE INDEX idx_target_id ON audit_logs(target_id);

CREATE TABLE IF NOT EXISTS settings (
  setting_id VARCHAR(32) PRIMARY KEY,
  setting_key VARCHAR(100) NOT NULL UNIQUE,
  setting_value JSONB,
  description TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_setting_key ON settings(setting_key);

INSERT INTO users (user_id, name, company, role, pin_hash, is_active)
VALUES 
  ('boss_001', '山本 親方', '株式会社J''s', 'boss', '/KFm', TRUE),
  ('admin_001', '事務 太郎', '株式会社J''s', 'admin_office', '/KFm', TRUE)
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO settings (setting_id, setting_key, setting_value, description)
VALUES 
  ('setting_001', 'standard_work_hours', '{"hours": 8, "start": "08:00", "end": "17:00"}', '標準勤務時間'),
  ('setting_002', 'overtime_multiplier', '{"rate": 1.25}', '残業単価倍率'),
  ('setting_003', 'revision_deadline_default', '{"days": 1}', '修正依頼デフォルト期限')
ON CONFLICT (setting_id) DO NOTHING;

COMMIT;
