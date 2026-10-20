const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'portraits';

let supabaseClient = null;
if (SUPABASE_URL && SUPABASE_SECRET_KEY) {
  try {
    supabaseClient = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
    console.log('[Storage] Supabase Storage client initialized for bucket:', STORAGE_BUCKET);
  } catch (err) {
    console.warn('[Storage] Failed to initialize Supabase client:', err.message);
  }
}

/**
 * Uploads a portrait image buffer to persistent storage (Supabase Storage or Base64 Data URL)
 * @param {Buffer} buffer 
 * @param {string} originalName 
 * @param {string} mimetype 
 * @param {string|number} leaderId 
 * @returns {Promise<string>} Permanent public URL
 */
async function uploadPortrait(buffer, originalName, mimetype, leaderId = 'leader') {
  if (!buffer || buffer.length === 0) return '';

  const ext = (path.extname(originalName || '') || '.jpg').toLowerCase();
  const cleanId = leaderId ? String(leaderId).replace(/[^a-zA-Z0-9_-]/g, '') : 'leader';
  const timestamp = Date.now();
  const filename = `leader_${cleanId}_${timestamp}${ext}`;

  // 1. Try Supabase Storage if configured
  if (supabaseClient) {
    try {
      const { data, error } = await supabaseClient.storage
        .from(STORAGE_BUCKET)
        .upload(filename, buffer, {
          contentType: mimetype || 'image/jpeg',
          upsert: true
        });

      if (error) {
        console.error('[Storage] Supabase upload error:', error.message);
        throw error;
      }

      const { data: publicData } = supabaseClient.storage
        .from(STORAGE_BUCKET)
        .getPublicUrl(filename);

      if (publicData && publicData.publicUrl) {
        return publicData.publicUrl;
      }
    } catch (err) {
      console.warn('[Storage] Falling back from Supabase Storage:', err.message);
    }
  }

  // 2. Persistent Base64 Data URL fallback: stored directly in PostgreSQL
  // Guaranteed to persist across cold starts and Vercel serverless without disk dependency
  const mime = mimetype || 'image/jpeg';
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

/**
 * Deletes portrait from remote persistent storage if applicable
 * @param {string} photoUrl 
 */
async function deletePortrait(photoUrl) {
  if (!photoUrl || typeof photoUrl !== 'string') return;

  // If stored in Supabase Storage, remove object
  if (supabaseClient && photoUrl.includes(STORAGE_BUCKET)) {
    try {
      const urlParts = photoUrl.split(`/${STORAGE_BUCKET}/`);
      if (urlParts.length > 1) {
        const filePath = urlParts[1].split('?')[0];
        await supabaseClient.storage.from(STORAGE_BUCKET).remove([filePath]);
        console.log('[Storage] Deleted remote portrait:', filePath);
      }
    } catch (err) {
      console.warn('[Storage] Error deleting portrait from Supabase:', err.message);
    }
  }
}

module.exports = {
  uploadPortrait,
  deletePortrait
};
