const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  console.log('マイグレーション開始...');

  const steps = [

    // STEP 1: companies テーブル作成
    `CREATE TABLE IF NOT EXISTS companies (
      company_id    VARCHAR(36)  PRIMARY KEY,
      company_name  VARCHAR(100) NOT NULL,
      company_code  VARCHAR(20)  NOT NULL UNIQUE,
      address       TEXT,
      phone         VARCHAR(20),
      email         VARCHAR(100),
      is_active     BOOLEAN      DEFAULT TRUE,
      is_master     BOOLEAN      DEFAULT FALSE,
      created_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      updated_at    TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    )`,

    // STEP 2: companies インデックス
    `CREATE INDEX IF NOT EXISTS idx_companies_code ON companies(company_code)`,
    `CREATE INDEX IF NOT EXISTS idx_companies_is_master ON companies(is_master)`,

    // STEP 3: J's社を初期データ登録
    `INSERT INTO companies (
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
    ) ON CONFLICT (company_id) DO NOTHING`,

    // STEP 4: company_relations テーブル作成
    `CREATE TABLE IF NOT EXISTS company_relations (
      relation_id    VARCHAR(36)  PRIMARY KEY,
      company_id_a   VARCHAR(36)  NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
      company_id_b   VARCHAR(36)  NOT NULL REFERENCES companies(company_id) ON DELETE CASCADE,
      relation_type  VARCHAR(20)  DEFAULT 'partner' CHECK (relation_type IN ('partner', 'subcontractor', 'client')),
      is_active      BOOLEAN      DEFAULT TRUE,
      created_at     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(company_id_a, company_id_b)
    )`,

    // STEP 5: company_relations インデックス
    `CREATE INDEX IF NOT EXISTS idx_company_relations_a ON company_relations(company_id_a)`,
    `CREATE INDEX IF NOT EXISTS idx_company_relations_b ON company_relations(company_id_b)`,

    // STEP 6: sites テーブル作成
    `CREATE TABLE IF NOT EXISTS sites (
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
    )`,

    // STEP 7: sites インデックス
    `CREATE INDEX IF NOT EXISTS idx_sites_company_id ON sites(company_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sites_is_active ON sites(is_active)`,

    // STEP 8: users に company_id 追加
    `ALTER TABLE users
      ADD COLUMN IF NOT EXISTS company_id VARCHAR(36)
      REFERENCES companies(company_id)
      DEFAULT 'company_js_001'`,

    // STEP 9: users company_id インデックス
    `CREATE INDEX IF NOT EXISTS idx_users_company_id ON users(company_id)`,

    // STEP 10: 既存ユーザーにcompany_idをセット
    `UPDATE users SET company_id = 'company_js_001' WHERE company_id IS NULL`,

    // STEP 11: reports に site_id 追加
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS site_id VARCHAR(36) REFERENCES sites(site_id)`,

    // STEP 12: reports に content_hash 追加
    `ALTER TABLE reports ADD COLUMN IF NOT EXISTS content_hash VARCHAR(64)`,

    // STEP 13: reports site_id インデックス
    `CREATE INDEX IF NOT EXISTS idx_reports_site_id ON reports(site_id)`,

    // STEP 14: report_shares テーブル作成
    `CREATE TABLE IF NOT EXISTS report_shares (
      share_id            VARCHAR(36)  PRIMARY KEY,
      report_id           VARCHAR(36)  NOT NULL REFERENCES reports(report_id) ON DELETE CASCADE,
      sender_company_id   VARCHAR(36)  NOT NULL REFERENCES companies(company_id),
      sender_user_id      VARCHAR(36)  NOT NULL REFERENCES users(user_id),
      receiver_company_id VARCHAR(36)  NOT NULL REFERENCES companies(company_id),
      share_type          VARCHAR(20)  DEFAULT 'in_app' CHECK (share_type IN ('in_app', 'pdf', 'email')),
      content_hash        VARCHAR(64)  NOT NULL,
      share_status        VARCHAR(20)  DEFAULT 'sent' CHECK (share_status IN ('sent', 'received', 'read', 'tampered')),
      sent_at             TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      received_at         TIMESTAMP,
      read_at             TIMESTAMP,
      memo                TEXT
    )`,

    // STEP 15: report_shares インデックス
    `CREATE INDEX IF NOT EXISTS idx_report_shares_report_id ON report_shares(report_id)`,
    `CREATE INDEX IF NOT EXISTS idx_report_shares_sender ON report_shares(sender_company_id)`,
    `CREATE INDEX IF NOT EXISTS idx_report_shares_receiver ON report_shares(receiver_company_id)`,
    `CREATE INDEX IF NOT EXISTS idx_report_shares_status ON report_shares(share_status)`,

    // STEP 16: tamper_notifications テーブル作成
    `CREATE TABLE IF NOT EXISTS tamper_notifications (
      notification_id  VARCHAR(36)  PRIMARY KEY,
      share_id         VARCHAR(36)  NOT NULL REFERENCES report_shares(share_id) ON DELETE CASCADE,
      report_id        VARCHAR(36)  NOT NULL REFERENCES reports(report_id),
      notified_user_id VARCHAR(36)  NOT NULL REFERENCES users(user_id),
      hash_before      VARCHAR(64)  NOT NULL,
      hash_after       VARCHAR(64)  NOT NULL,
      is_read          BOOLEAN      DEFAULT FALSE,
      created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP,
      read_at          TIMESTAMP
    )`,

    // STEP 17: tamper_notifications インデックス
    `CREATE INDEX IF NOT EXISTS idx_tamper_share_id ON tamper_notifications(share_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tamper_user_id ON tamper_notifications(notified_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tamper_is_read ON tamper_notifications(is_read)`,

    // STEP 18: push_notifications テーブル作成
    `CREATE TABLE IF NOT EXISTS push_notifications (
      push_id      VARCHAR(36)   PRIMARY KEY,
      user_id      VARCHAR(36)   NOT NULL REFERENCES users(user_id),
      device_id    VARCHAR(100)  REFERENCES devices(device_id),
      type         VARCHAR(50)   NOT NULL,
      title        VARCHAR(100)  NOT NULL,
      body         TEXT          NOT NULL,
      data         JSONB,
      is_sent      BOOLEAN       DEFAULT FALSE,
      sent_at      TIMESTAMP,
      created_at   TIMESTAMP     DEFAULT CURRENT_TIMESTAMP
    )`,

    // STEP 19: push_notifications インデックス
    `CREATE INDEX IF NOT EXISTS idx_push_user_id ON push_notifications(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_push_type ON push_notifications(type)`,
    `CREATE INDEX IF NOT EXISTS idx_push_is_sent ON push_notifications(is_sent)`,

  ];

  for (let i = 0; i < steps.length; i++) {
    try {
      await pool.query(steps[i]);
      console.log(`✅ STEP ${i + 1} 完了`);
    } catch (e) {
      if (
        e.message.includes('already exists') ||
        e.message.includes('duplicate column')
      ) {
        console.log(`⚠️  STEP ${i + 1} スキップ（既存）`);
      } else {
        console.error(`❌ STEP ${i + 1} エラー:`, e.message);
      }
    }
  }

  console.log('\nマイグレーション完了！');
  await pool.end();
}

migrate();