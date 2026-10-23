require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const User = require('../models/User');
const Project = require('../models/Project');
const Request = require('../models/Request');
const ActivityEvent = require('../models/ActivityEvent');

const csvCell = value => {
    const text = Array.isArray(value) ? value.join('; ') : value == null ? '' : String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const toCsv = rows => {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    return [headers.join(','), ...rows.map(row => headers.map(h => csvCell(row[h])).join(','))].join('\n') + '\n';
};

async function main() {
    await connectDB();
    const fields = 'name email university department year skills bio status anonToken createdAt lastLoginAt';
    const users = await User.find({}, fields).sort({ createdAt: -1 }).lean();
    const [projects, requests, activity] = await Promise.all([
        Project.aggregate([{ $group: { _id: '$user', count: { $sum: 1 } } }]),
        Request.aggregate([{ $group: { _id: '$fromUser', count: { $sum: 1 } } }]),
        ActivityEvent.find({}).sort({ createdAt: -1 }).limit(20000).lean()
    ]);
    const countMap = rows => new Map(rows.map(row => [String(row._id), row.count]));
    const projectCounts = countMap(projects);
    const sentRequestCounts = countMap(requests);
    const activityByUser = new Map();
    for (const ev of activity) {
        const key = String(ev.user);
        if (!activityByUser.has(key)) activityByUser.set(key, []);
        if (activityByUser.get(key).length < 10) activityByUser.get(key).push({ event: ev.event, summary: ev.summary, at: ev.createdAt });
    }
    const usersReport = users.map(user => ({
        id: String(user._id), name: user.name, email: user.email, university: user.university,
        department: user.department, year: user.year, skills: user.skills || [], bio: user.bio || '',
        status: user.status || 'active', accountReference: user.anonToken || '', createdAt: user.createdAt || null,
        lastLoginAt: user.lastLoginAt || null, projectCount: projectCounts.get(String(user._id)) || 0,
        requestsSent: sentRequestCounts.get(String(user._id)) || 0,
        recentActivity: activityByUser.get(String(user._id)) || []
    }));
    const activityReport = activity.map(ev => ({
        at: ev.createdAt, userId: String(ev.user), event: ev.event, summary: ev.summary || ''
    }));
    const report = {
        generatedAt: new Date().toISOString(),
        privacy: 'Contains user basic details and account activity. Store securely; do not publish or commit exports.',
        totals: { users: usersReport.length, projects: await Project.countDocuments(), requests: await Request.countDocuments(), loggedActivityEventsIncluded: activityReport.length },
        users: usersReport,
        recentActivity: activityReport
    };
    const outDir = path.join(process.cwd(), 'owner-reports');
    fs.mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.writeFileSync(path.join(outDir, `owner-report-${stamp}.json`), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(outDir, `users-${stamp}.csv`), toCsv(usersReport.map(({ recentActivity, ...user }) => user)));
    fs.writeFileSync(path.join(outDir, `activity-${stamp}.csv`), toCsv(activityReport));
    console.log(`Exported ${usersReport.length} user records and ${activityReport.length} activity events to ${outDir}`);
    console.log('No passwords, OTP hashes, JWTs, or other authentication secrets are included. Protect this folder as personal data.');
    await mongoose.disconnect();
}

main().catch(async error => {
    console.error('Owner report export failed:', error.message);
    await mongoose.disconnect().catch(() => {});
    process.exitCode = 1;
});
