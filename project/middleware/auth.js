const jwt = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    const token = header.slice(7).trim();
    if (!token) return res.status(401).json({ message: 'Authentication required' });

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.id).select('-password +tokenVersion');
        if (!user) return res.status(401).json({ message: 'Account not found' });
        if (Number(decoded.ver || 0) !== Number(user.tokenVersion || 0)) {
            return res.status(401).json({ message: 'Your session has expired. Please sign in again.' });
        }
        if (user.status === 'suspended') {
            return res.status(403).json({ message: 'This account is suspended' });
        }
        req.user = user;
        return next();
    } catch (error) {
        if (error.name === 'TokenExpiredError' || error.name === 'JsonWebTokenError') {
            return res.status(401).json({ message: 'Invalid or expired token' });
        }
        return next(error);
    }
};

module.exports = { protect };
