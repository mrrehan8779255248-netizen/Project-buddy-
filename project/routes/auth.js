const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const { emailConfigured, sendPasswordResetOtp } = require('../utils/email');
const ActivityEvent = require('../models/ActivityEvent');

const OTP_TTL_MS = 10 * 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;
const generateToken = user => jwt.sign({ id: user._id, ver: Number(user.tokenVersion || 0) }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
const normalizeEmail = email => String(email || '').trim().toLowerCase();
const hashOtp = otp => crypto.createHmac('sha256', process.env.JWT_SECRET).update(String(otp)).digest('hex');
const publicUser = user => ({
    _id: user._id,
    name: user.name,
    email: user.email,
    university: user.university,
    department: user.department,
    year: user.year,
    skills: user.skills,
    bio: user.bio,
    profilePicture: user.profilePicture || '',
    coverImage: user.coverImage || '',
    headline: user.headline || '',
    location: user.location || '',
    degree: user.degree || '',
    graduationYear: user.graduationYear || '',
    portfolioUrl: user.portfolioUrl || '',
    linkedinUrl: user.linkedinUrl || '',
    githubUrl: user.githubUrl || '',
    interests: user.interests || [],
    bookmarks: user.bookmarks,
    status: user.status,
    anonToken: user.anonToken,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt
});
const recordActivity = (userId, event, summary = '') => ActivityEvent.create({ user: userId, event, summary }).catch(err => {
    console.error('Activity event could not be saved:', err.message);
});

router.post('/register', [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
    body('university').trim().notEmpty().withMessage('University is required'),
    body('department').notEmpty().withMessage('Department is required'),
    body('year').notEmpty().withMessage('Year of study is required'),
    body('skills').isArray({ min: 1 }).withMessage('At least one skill is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
        const email = normalizeEmail(req.body.email);
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(409).json({ message: 'Email is already registered. Please sign in or recover your password.' });

        const user = await User.create({
            name: String(req.body.name).trim(), email, password: req.body.password, tokenVersion: 0,
            university: String(req.body.university).trim(), department: req.body.department,
            year: req.body.year, skills: req.body.skills,
            bio: String(req.body.bio || 'Student passionate about collaborative projects').slice(0, 500)
        });
        await recordActivity(user._id, 'account_registered', 'Account created');
        res.status(201).json({ ...publicUser(user), token: generateToken(user) });
    } catch (error) {
        if (error.code === 11000) return res.status(409).json({ message: 'Email is already registered' });
        if (error.name === 'ValidationError') return res.status(400).json({ message: error.message });
        console.error('Register error:', error.message);
        res.status(500).json({ message: 'Server error during registration' });
    }
});

router.post('/login', [
    body('email').isEmail().withMessage('Valid email is required'),
    body('password').notEmpty().withMessage('Password is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
        const email = normalizeEmail(req.body.email);
        const user = await User.findOne({ email }).select('+password +tokenVersion');
        if (!user || !(await user.matchPassword(req.body.password))) {
            return res.status(401).json({ message: 'Invalid email or password' });
        }
        if (user.status === 'suspended') return res.status(403).json({ message: 'This account is currently unavailable. Please contact support.' });
        user.lastLoginAt = new Date();
        await user.save();
        await recordActivity(user._id, 'login_success', 'Signed in');
        res.json({ ...publicUser(user), token: generateToken(user) });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ message: 'Server error during login' });
    }
});

// Always use a generic success response to avoid revealing whether an email is registered.
router.post('/forgot-password', [body('email').isEmail().withMessage('Enter a valid email address')], async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
    if (!emailConfigured()) {
        return res.status(503).json({ message: 'Password recovery email is not configured yet. Please contact the platform owner.' });
    }

    const email = normalizeEmail(req.body.email);
    const now = new Date();
    try {
        const user = await User.findOne({ email }).select('+passwordResetOtpRequestedAt +passwordResetOtpAttempts +passwordResetOtpHash +passwordResetOtpExpiresAt');
        if (user) {
            // Reuse neither OTPs nor attempts. Throttle repeated requests by email in addition to API rate limits.
            const lastRequested = user.passwordResetOtpRequestedAt;
            if (!lastRequested || now.getTime() - new Date(lastRequested).getTime() >= 60 * 1000) {
                const otp = crypto.randomInt(100000, 1000000).toString();
                user.passwordResetOtpHash = hashOtp(otp);
                user.passwordResetOtpExpiresAt = new Date(now.getTime() + OTP_TTL_MS);
                user.passwordResetOtpAttempts = 0;
                user.passwordResetOtpRequestedAt = now;
                await user.save();
                try {
                    await sendPasswordResetOtp(user.email, otp);
                    await recordActivity(user._id, 'password_reset_requested', 'Password recovery code requested');
                } catch (mailError) {
                    user.passwordResetOtpHash = undefined;
                    user.passwordResetOtpExpiresAt = undefined;
                    user.passwordResetOtpAttempts = 0;
                    await user.save();
                    console.error('Password recovery email delivery failed:', mailError.message);
                    return res.status(502).json({ message: 'We could not send the recovery email. Please try again later.' });
                }
            }
        }
        return res.json({ message: 'If this email belongs to an account, a recovery code will be sent shortly. The code expires in 10 minutes.' });
    } catch (error) {
        console.error('Password recovery request failed:', error.message);
        return res.status(500).json({ message: 'Could not start password recovery. Please try again.' });
    }
});

router.post('/reset-password', [
    body('email').isEmail().withMessage('Enter a valid email address'),
    body('otp').matches(/^\d{6}$/).withMessage('Enter the 6-digit email code'),
    body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) return res.status(400).json({ message: errors.array()[0].msg });
        const user = await User.findOne({ email: normalizeEmail(req.body.email) })
            .select('+password +tokenVersion +passwordResetOtpHash +passwordResetOtpExpiresAt +passwordResetOtpAttempts +passwordResetOtpRequestedAt');
        const invalid = () => res.status(400).json({ message: 'The recovery code is invalid or expired. Request a new code and try again.' });
        if (!user || !user.passwordResetOtpHash || !user.passwordResetOtpExpiresAt) return invalid();
        if (user.passwordResetOtpAttempts >= MAX_OTP_ATTEMPTS || new Date(user.passwordResetOtpExpiresAt).getTime() < Date.now()) {
            user.passwordResetOtpHash = undefined;
            user.passwordResetOtpExpiresAt = undefined;
            user.passwordResetOtpAttempts = 0;
            await user.save();
            return invalid();
        }

        const providedHash = Buffer.from(hashOtp(req.body.otp), 'hex');
        const storedHash = Buffer.from(user.passwordResetOtpHash, 'hex');
        const matches = providedHash.length === storedHash.length && crypto.timingSafeEqual(providedHash, storedHash);
        if (!matches) {
            user.passwordResetOtpAttempts += 1;
            if (user.passwordResetOtpAttempts >= MAX_OTP_ATTEMPTS) {
                user.passwordResetOtpHash = undefined;
                user.passwordResetOtpExpiresAt = undefined;
                user.passwordResetOtpAttempts = 0;
            }
            await user.save();
            return invalid();
        }

        user.password = req.body.newPassword;
        user.tokenVersion = Number(user.tokenVersion || 0) + 1; // revoke JWTs created before this reset
        user.passwordResetOtpHash = undefined;
        user.passwordResetOtpExpiresAt = undefined;
        user.passwordResetOtpAttempts = 0;
        user.passwordResetOtpRequestedAt = undefined;
        await user.save();
        await recordActivity(user._id, 'password_reset_completed', 'Password changed using email verification');
        return res.json({ message: 'Password updated successfully. Please sign in with your new password.' });
    } catch (error) {
        if (error.name === 'ValidationError') return res.status(400).json({ message: error.message });
        console.error('Password reset failed:', error.message);
        return res.status(500).json({ message: 'Could not update the password. Please try again.' });
    }
});

router.get('/me', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        if (!user) return res.status(404).json({ message: 'Account not found' });
        res.json(publicUser(user));
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
