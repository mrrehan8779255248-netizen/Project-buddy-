require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../config/db');

async function migrate() {
    await connectDB();
    // Use the raw collection intentionally: `role` is no longer an application schema field.
    const result = await mongoose.connection.collection('users').updateMany({}, { $unset: { role: '' } });
    console.log(`Removed legacy role fields from ${result.modifiedCount} account(s). Existing accounts and profile data were preserved.`);
    await mongoose.disconnect();
}

migrate().catch(async error => {
    console.error('Role cleanup failed:', error.message);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
