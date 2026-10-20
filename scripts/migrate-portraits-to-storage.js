require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { pool, query } = require('../server/postgres');
const { uploadPortrait } = require('../server/storage');

async function migratePortraits() {
  console.log('====================================================');
  console.log('Migrating local portraits to Persistent Storage');
  console.log('====================================================');

  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is required.');
    process.exit(1);
  }

  const portraitsDir = path.join(__dirname, '..', 'public', 'uploads', 'portraits');
  if (!fs.existsSync(portraitsDir)) {
    console.log('No local portraits directory found.');
    return;
  }

  const files = fs.readdirSync(portraitsDir).filter(f => f.match(/\.(jpg|jpeg|png|webp|svg)$/i));
  console.log(`Found ${files.length} portrait files in ${portraitsDir}`);

  for (const filename of files) {
    const filePath = path.join(portraitsDir, filename);
    const buffer = fs.readFileSync(filePath);
    const ext = path.extname(filename).toLowerCase();
    const leaderIdStr = path.basename(filename, ext).replace(/^leader_/, '').split('_')[0];
    const leaderId = parseInt(leaderIdStr, 10);

    const mime = ext === '.png' ? 'image/png' : (ext === '.webp' ? 'image/webp' : 'image/jpeg');

    console.log(`Uploading ${filename} (leaderId: ${leaderId || 'generic'})...`);
    const permanentUrl = await uploadPortrait(buffer, filename, mime, leaderId || filename);

    if (permanentUrl && !isNaN(leaderId)) {
      const updateRes = await query(`
        UPDATE departments
        SET photo = $2, updated_at = NOW()
        WHERE leader_id = $1
        RETURNING id, name, head_name;
      `, [leaderId, permanentUrl]);

      if (updateRes.rows.length > 0) {
        console.log(`  -> Updated department "${updateRes.rows[0].name}" with URL: ${permanentUrl.substring(0, 60)}...`);
      }
    }
  }

  console.log('====================================================');
  console.log('Portraits migration completed successfully!');
  console.log('====================================================');
  await pool.end();
}

if (require.main === module) {
  migratePortraits().catch(err => {
    console.error('Portraits migration failed:', err);
    process.exit(1);
  });
}

module.exports = { migratePortraits };
