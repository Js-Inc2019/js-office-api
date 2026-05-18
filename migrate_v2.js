const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema_v2.sql'), 'utf8');

const statements = sql
  .split(';')
  .map(s => s.trim())
  .filter(s => s.length > 0 && !s.startsWith('--'));

async function migrate() {
  console.log('マイグレーション開始...');
  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    try {
      await pool.query(stmt);
      console.log(`✅ STEP ${i + 1} 完了`);
    } catch (e) {
      if (e.message.includes('already exists')) {
        console.log(`⚠️  STEP ${i + 1} スキップ（既存）`);
      } else {
        console.error(`❌ STEP ${i + 1} エラー:`, e.message);
      }
    }
  }
  console.log('マイグレーション完了！');
  await pool.end();
}

migrate();