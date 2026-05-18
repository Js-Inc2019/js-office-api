-- ============================================================
-- db/schema_v2.sql - J's Awake App 拡張版スキーマ
-- ※ 既存テーブルは変更しない・追加のみ
-- 実行順番：このファイルを上から順に実行すること
-- ============================================================

-- ============================================================
-- STEP 1: companies テーブル（会社マスター）
-- 全会社の情報を管理する。J'sもここに入る。
-- ============================================================
CREATE TABLE IF NOT EXISTS companies (
  company_id    VARCHAR(36)  PRIMARY KEY,
  company_name  VARCHAR(100) NOT NULL,
  company_code  VARCHAR(20)  NOT NULL UNIQUE,  -- 短縮コード例: JS001
  address       TEXT,
  phone         VARCHAR(20),
  email         VARCHAR(100),
  is_active     BOOLEAN      DEFAULT TRUE,
  is_master     BOOLEAN      DEFAULT FALSE,    -- TRUEはJ'sのみ（システム管理者）
  created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_companies_code     ON companies(company_code);
CREATE INDEX idx_companies_is_master ON companies(is_master);

-- J's社を初期データとして登録
INSERT INTO companies (
  company_id, company_name, company_code,
  address, phone, email, is_active, is_master
) VALUES (
  'company_js_001',
  '株式会社J''s',
  'JS001',
  '〒653-0036 兵庫県神戸市長田区腕塚町3丁目1-2',
  '',
  'info@j-denki.com',
  TRUE,
  TRUE
) ON CONFLICT (company_id) DO NOTHING;

-- ============================================================
-- STEP 2: company_relations テーブル（会社間の繋がり）
-- どの会社とどの会社が報告し合えるかを管理する
-- 例: JS001 ↔ KY001 ↔ KY002 のメッシュ状の関係も対応
-- ============================================================
CREATE TABLE IF NOT EXISTS company_relations (
  relation_id    VARCHAR(36)  PRIMARY KEY,
  company_id_a   VARCHAR(36)  NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  company_id_b   VARCHAR(36)  NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  relation_type  VARCHAR(20)  DEFAULT 'partner'
                 CHECK (relation_type IN ('partner', 'subcontractor', 'client')),
  is_active      BOOLEAN      DEFAULT TRUE,
  created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(company_id_a, company_id_b)  -- 同じ組み合わせを重複登録しない
);

CREATE INDEX idx_company_relations_a ON company_relations(company_id_a);
CREATE INDEX idx_company_relations_b ON company_relations(company_id_b);

-- ============================================================
-- STEP 3: sites テーブル（現場マスター）
-- 現場を会社に紐付けて管理する
-- ============================================================
CREATE TABLE IF NOT EXISTS sites (
  site_id      VARCHAR(36)  PRIMARY KEY,
  company_id   VARCHAR(36)  NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
  site_name    VARCHAR(100) NOT NULL,
  site_code    VARCHAR(20),
  address      TEXT,
  start_date   DATE,
  end_date     DATE,
  is_active    BOOLEAN      DEFAULT TRUE,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_sites_company_id ON sites(company_id);
CREATE INDEX idx_sites_is_active  ON sites(is_active);

-- ============================================================
-- STEP 4: 既存テーブルへのカラム追加
-- usersに company_id を追加する
-- reportsに site_id と content_hash を追加する
-- ============================================================

-- users テーブルに company_id を追加
-- ※ 既存データが壊れないようにDEFAULTを設定しておく
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS company_id VARCHAR(36)
  REFERENCES companies(company_id)
  DEFAULT 'company_js_001';

CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id);

-- reports テーブルに site_id と content_hash を追加
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS site_id      VARCHAR(36) REFERENCES sites(site_id),
  ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64);  -- SHA-256ハッシュ（改ざん検知用）

CREATE INDEX IF NOT EXISTS idx_reports_site_id ON reports(site_id);

-- ============================================================
-- STEP 5: report_shares テーブル（会社間報告の送受信ログ）
-- 送った側・受け取った側、両方にデータを保存する
-- 編集があった場合はここで検知して通知を送る
-- ============================================================
CREATE TABLE IF NOT EXISTS report_shares (
  share_id          VARCHAR(36)  PRIMARY KEY,
  report_id         VARCHAR(36)  NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
  sender_company_id VARCHAR(36)  NOT NULL REFERENCES companies(company_id),
  sender_user_id    VARCHAR(36)  NOT NULL REFERENCES users(user_id),
  receiver_company_id VARCHAR(36) NOT NULL REFERENCES companies(company_id),
  share_type        VARCHAR(20)  DEFAULT 'in_app'
                    CHECK (share_type IN ('in_app', 'pdf', 'email')),
  content_hash      VARCHAR(64)  NOT NULL,  -- 送信時のハッシュ値（改ざん検知の基準）
  share_status      VARCHAR(20)  DEFAULT 'sent'
                    CHECK (share_status IN ('sent', 'received', 'read', 'tampered')),
  sent_at           TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  received_at       TIMESTAMP,
  read_at           TIMESTAMP,
  memo              TEXT
);

CREATE INDEX idx_report_shares_report_id        ON report_shares(report_id);
CREATE INDEX idx_report_shares_sender_company   ON report_shares(sender_company_id);
CREATE INDEX idx_report_shares_receiver_company ON report_shares(receiver_company_id);
CREATE INDEX idx_report_shares_status           ON report_shares(share_status);

-- ============================================================
-- STEP 6: tamper_notifications テーブル（改ざん・編集通知）
-- データが編集されたとき、相手側に通知を送るためのログ
-- ============================================================
CREATE TABLE IF NOT EXISTS tamper_notifications (
  notification_id  VARCHAR(36)  PRIMARY KEY,
  share_id         VARCHAR(36)  NOT NULL REFERENCES report_shares(share_id) ON DELETE CASCADE,
  report_id        VARCHAR(36)  NOT NULL REFERENCES reports(report_id),
  notified_user_id VARCHAR(36)  NOT NULL REFERENCES users(user_id),
  hash_before      VARCHAR(64)  NOT NULL,  -- 編集前のハッシュ
  hash_after       VARCHAR(64)  NOT NULL,  -- 編集後のハッシュ
  is_read          BOOLEAN      DEFAULT FALSE,
  created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
  read_at          TIMESTAMP
);

CREATE INDEX idx_tamper_notifications_share_id  ON tamper_notifications(share_id);
CREATE INDEX idx_tamper_notifications_user_id   ON tamper_notifications(notified_user_id);
CREATE INDEX idx_tamper_notifications_is_read   ON tamper_notifications(is_read);

-- ============================================================
-- STEP 7: push_notifications テーブル（プッシュ通知ログ）
-- FCMを使ったプッシュ通知の送信記録
-- ============================================================
CREATE TABLE IF NOT EXISTS push_notifications (
  push_id      VARCHAR(36)  PRIMARY KEY,
  user_id      VARCHAR(36)  NOT NULL REFERENCES users(user_id),
  device_id    VARCHAR(100) REFERENCES devices(device_id),
  type         VARCHAR(50)  NOT NULL,
  -- 例: 'report_shared' / 'tamper_detected' / 'revision_requested'
  title        VARCHAR(100) NOT NULL,
  body         TEXT         NOT NULL,
  data         JSONB,
  is_sent      BOOLEAN      DEFAULT FALSE,
  sent_at      TIMESTAMP,
  created_at   TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_push_notifications_user_id  ON push_notifications(user_id);
CREATE INDEX idx_push_notifications_type     ON push_notifications(type);
CREATE INDEX idx_push_notifications_is_sent  ON push_notifications(is_sent);

-- ============================================================
-- STEP 8: 権限定義の確認
-- 既存のroleに事務・職長・職人が含まれているか確認
-- 既存: worker / boss / admin_office / admin_exec
-- 今回の対応:
--   worker       = 職人（自社職長にのみ報告可）
--   boss         = 職長（他社への報告可）
--   admin_office = 事務（他社への報告可・社員管理可）
--   admin_exec   = システム管理者（J'sのみ使用）
-- ※ roleの変更は不要・既存のまま使える
-- ============================================================

-- ============================================================
-- 完了確認用クエリ（実行後に確認すること）
-- ============================================================
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- ORDER BY table_name;