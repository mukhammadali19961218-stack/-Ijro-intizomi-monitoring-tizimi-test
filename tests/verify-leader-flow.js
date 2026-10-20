require('dotenv').config();
const { uploadPortrait, deletePortrait } = require('../server/storage');
const { createDepartment, updateDepartment, deleteDepartment, getDepartmentOverdueStats } = require('../server/postgres');
const fs = require('fs');
const path = require('path');

async function testFlow() {
  console.log('--- STARTING NEW LEADER CREATION & PORTRAIT UPLOAD VERIFICATION ---');

  // Minimal valid 1x1 JPEG buffer
  const sampleJpegBuffer = Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x01, 0x00, 0x48, 0x00, 0x48, 0x00, 0x00, 0xff, 0xdb, 0x00, 0x43,
    0x00, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01,
    0x11, 0x00, 0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x09,
    0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0xbf, 0xff, 0xd9
  ]);

  const testLeaderId = 999;
  const initialUploadsCount = fs.existsSync(path.join(process.cwd(), 'public/uploads')) 
    ? fs.readdirSync(path.join(process.cwd(), 'public/uploads')).length 
    : 0;

  console.log('Step 1: Uploading portrait via server/storage.js to Supabase Storage bucket "portraits"...');
  const uploadedUrl = await uploadPortrait(sampleJpegBuffer, 'test_leader.jpg', 'image/jpeg', testLeaderId);
  console.log('Resulting photo URL:', uploadedUrl);

  if (!uploadedUrl.startsWith('https://') || !uploadedUrl.includes('supabase.co')) {
    throw new Error(`Expected remote Supabase HTTPS URL, but got: ${uploadedUrl}`);
  }

  // Verify no file written to local disk
  const afterUploadsCount = fs.existsSync(path.join(process.cwd(), 'public/uploads')) 
    ? fs.readdirSync(path.join(process.cwd(), 'public/uploads')).length 
    : 0;
  if (afterUploadsCount !== initialUploadsCount) {
    throw new Error('Local public/uploads was modified! File must not be written to disk.');
  }
  console.log('Verified: No files written to local filesystem or public/uploads.');

  console.log('Step 2: Creating new department in PostgreSQL...');
  const createdDept = await createDepartment({
    leaderId: testLeaderId,
    name: 'TEST MONITORING BOSHQARMASI',
    headName: 'TESTOV TEST TESTOVICH',
    headTitle: 'Bosh mutaxassis',
    photo: uploadedUrl,
    status: 'active'
  });
  console.log('Created department in PostgreSQL:', createdDept.id, 'Photo in DB:', createdDept.photo);

  if (createdDept.photo !== uploadedUrl) {
    throw new Error('PostgreSQL photo column does not match uploaded URL!');
  }

  console.log('Step 3: Verifying Dashboard departments query retrieves the new department and portrait URL...');
  const dashStats = await getDepartmentOverdueStats(1, 1000, false);
  const foundInDashboard = dashStats.allItems.find(d => d.id === createdDept.id);
  if (!foundInDashboard) {
    throw new Error('Newly created department not found in getDepartmentOverdueStats!');
  }
  if (foundInDashboard.photo !== uploadedUrl) {
    throw new Error(`Dashboard photo URL mismatch! Got: ${foundInDashboard.photo}`);
  }
  console.log('Verified: Dashboard query returns new department and portrait HTTPS URL.');

  console.log('Step 4: Testing EDIT flow with photo replacement...');
  const replacementBuffer = Buffer.concat([sampleJpegBuffer, Buffer.from([0x01, 0x02])]);
  const newPhotoUrl = await uploadPortrait(replacementBuffer, 'replaced_leader.jpg', 'image/jpeg', testLeaderId);
  console.log('New replacement photo URL:', newPhotoUrl);

  const updatedDept = await updateDepartment(createdDept.id, {
    headName: 'TESTOV TEST YANGILANGAN',
    photo: newPhotoUrl
  });
  if (updatedDept.photo !== newPhotoUrl) {
    throw new Error('Updated department photo does not match new URL!');
  }
  console.log('Verified: Department updated with new portrait URL in PostgreSQL.');

  console.log('Step 5: Cleaning up test department and remote test portraits...');
  await deletePortrait(uploadedUrl);
  await deletePortrait(newPhotoUrl);
  await deleteDepartment(createdDept.id);
  console.log('Verified: Cleaned up test records and remote storage objects.');

  console.log('====================================================');
  console.log('ALL NEW LEADER CREATION & PORTRAIT CHECKS PASSED!');
  console.log('====================================================');
}

testFlow()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('VERIFICATION ERROR:', err);
    process.exit(1);
  });
