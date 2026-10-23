require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const connectDB = require('./config/db');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const projectRoutes = require('./routes/projects');
const requestRoutes = require('./routes/requests');
const accountRoutes = require('./routes/account');
const ActivityEvent = require('./models/ActivityEvent');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);

const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5000,http://127.0.0.1:5000')
    .split(',').map(origin => origin.trim()).filter(Boolean);

app.use(helmet({
    // The existing frontend may use inline scripts/styles. Tighten CSP after migrating those assets.
    contentSecurityPolicy: false
}));
const corsOptions = {
    origin(origin, callback) {
        if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin is not allowed by CORS'));
    },
    credentials: true
};
app.use((req, res, next) => {
    const origin = req.get('origin');
    // Same-origin traffic does not need CORS headers. This keeps the one-origin Render app
    // working even if CORS_ORIGINS has not been populated in the hosting dashboard.
    if (origin) {
        try {
            if (new URL(origin).host.toLowerCase() === String(req.get('host') || '').toLowerCase()) return next();
        } catch { /* let the configured CORS policy reject malformed origins */ }
    }
    return cors(corsOptions)(req, res, next);
});
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many requests. Please try again later.' }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { message: 'Too many authentication attempts. Please try again later.' }
});

app.use('/api', apiLimiter);
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false }));
app.use('/api/auth/reset-password', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false }));

// Record successful authenticated write actions without storing IPs, credentials, request bodies or message contents.
app.use('/api', (req, res, next) => {
    res.on('finish', () => {
        if (!req.user?._id || res.statusCode >= 400) return;
        if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return;
        const path = String(req.originalUrl || '').split('?')[0];
        let event = 'account_action';
        let summary = 'Account action';
        if (path === '/api/projects' && req.method === 'POST') { event = 'project_created'; summary = 'Created a project'; }
        else if (path.startsWith('/api/projects') && req.method === 'DELETE') { event = 'project_deleted'; summary = 'Deleted a project'; }
        else if (path.includes('/bookmark')) { event = 'project_bookmark_changed'; summary = 'Updated a project bookmark'; }
        else if (path.includes('/report')) { event = 'project_reported'; summary = 'Reported a project'; }
        else if (path.includes('/messages')) { event = 'collaboration_message_sent'; summary = 'Sent a collaboration message'; }
        else if (path.startsWith('/api/requests') && req.method === 'POST') { event = 'partnership_request_sent'; summary = 'Sent a partnership request'; }
        else if (path.startsWith('/api/requests') && req.method === 'PUT') { event = 'partnership_request_updated'; summary = 'Updated a partnership request'; }
        else if (path.startsWith('/api/users') && req.method === 'PUT') { event = 'profile_updated'; summary = 'Updated profile'; }
        ActivityEvent.create({ user: req.user._id, event, summary }).catch(err => console.error('Activity audit error:', err.message));
    });
    next();
});

// In Vercel's serverless runtime there is no persistent startup listener, so make sure
// the shared MongoDB connection is ready before any API handler accesses a model.
const mongoose = require('mongoose');
let databaseConnectionPromise;
async function ensureDatabase(req, res, next) {
    if (mongoose.connection.readyState === 1) return next();
    try {
        if (!databaseConnectionPromise) {
            databaseConnectionPromise = connectDB()
                .then(() => ActivityEvent.createIndexes())
                .catch(error => {
                    databaseConnectionPromise = null;
                    throw error;
                });
        }
        await databaseConnectionPromise;
        return next();
    } catch (error) {
        console.error('Database connection failed:', error.message);
        return res.status(503).json({ message: 'Database unavailable. Please try again shortly.' });
    }
}
app.use('/api', ensureDatabase);

app.use((req, res, next) => {
    if (/^\/(?:config|middleware|models|routes|scripts|utils|owner-reports)(?:\/|$)/i.test(req.path) || /^\/(?:server|seed)\.js$/i.test(req.path) || /^\/(?:\.env(?:\..*)?|package(?:-lock)?\.json|README(?:_BACKEND_SETUP)?\.md|generate_ppt\.py)$/i.test(req.path)) return res.sendStatus(404);
    return next();
});
// Vercel serves static files from public/ through its CDN; the same directory is used locally/Render.
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny', index: false }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/account', accountRoutes);

app.get('/api/health', (req, res) => {
    const mongoose = require('mongoose');
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({
        status: connected ? 'ok' : 'degraded',
        service: 'ProjectBuddy API',
        database: connected ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ message: 'API route not found' });
    res.sendFile(path.join(__dirname, 'index.html'), error => error && next(error));
});

app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.message === 'Origin is not allowed by CORS') {
        return res.status(403).json({ message: 'Origin is not allowed' });
    }
    if (err.name === 'ValidationError') {
        return res.status(400).json({ message: 'Validation failed', details: Object.values(err.errors).map(e => e.message) });
    }
    if (err.name === 'CastError') return res.status(400).json({ message: 'Invalid resource ID' });
    if (err.code === 11000) return res.status(409).json({ message: 'A record with this value already exists' });
    console.error('Unhandled API error:', err);
    res.status(500).json({
        message: 'Internal server error',
        ...(process.env.NODE_ENV === 'development' ? { detail: err.message } : {})
    });
});

const PORT = Number(process.env.PORT) || 5000;
let server;

async function start() {
    if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
        throw new Error('JWT_SECRET must be configured with at least 32 characters.');
    }
    await connectDB();
    // Ensure query and one-year retention indexes exist even with autoIndex disabled in production.
    await ActivityEvent.createIndexes();
    server = app.listen(PORT, () => console.log(`ProjectBuddy API listening on port ${PORT}`));
}

async function shutdown(signal) {
    console.log(`${signal} received; shutting down`);
    if (server) server.close();
    const mongoose = require('mongoose');
    await mongoose.disconnect();
    process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

if (require.main === module) {
    start().catch(error => {
        console.error('Startup failed:', error.message);
        process.exit(1);
    });
}

module.exports = app;
