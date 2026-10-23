require('dotenv').config();
const connectDB = require('./config/db');
const Announcement = require('./models/Announcement');

async function seed() {
    await connectDB();
    await Announcement.updateOne(
        { title: 'Welcome to ProjectBuddy' },
        { $setOnInsert: {
            title: 'Welcome to ProjectBuddy',
            message: 'Share project ideas, discover collaborators, and work together.',
            category: 'announcement',
            active: true
        }},
        { upsert: true }
    );
    console.log('Seed complete. No administrator or demo user is created.');
    await require('mongoose').disconnect();
}

seed().catch(async error => {
    console.error('Seed failed:', error.message);
    await require('mongoose').disconnect().catch(() => {});
    process.exitCode = 1;
});
