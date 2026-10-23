const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Project = require('../models/Project');
const Request = require('../models/Request');
const { protect } = require('../middleware/auth');

// @route   GET /api/users/:id
// @desc    Get user profile by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
    try {
        const user = await User.findById(req.params.id);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Get user's projects
        const projects = await Project.find({ user: req.params.id }).select('title department difficulty status createdAt');

        // Get stats
        const partnerCount = await Request.countDocuments({
            $or: [
                { fromUser: req.params.id, status: 'accepted' },
                { toUser: req.params.id, status: 'accepted' }
            ]
        });
        const requestsSent = await Request.countDocuments({ fromUser: req.params.id });

        res.json({
            user: {
                _id: user._id, name: user.name, university: user.university,
                department: user.department, year: user.year, skills: user.skills,
                bio: user.bio, anonToken: user.anonToken, createdAt: user.createdAt
            },
            projects,
            stats: {
                projectCount: projects.length,
                partnerCount,
                requestsSent
            }
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/users/:id
// @desc    Update user profile
// @access  Private
router.put('/:id', protect, [
    body('name').optional().trim().notEmpty().withMessage('Name cannot be empty'),
    body('skills').optional().isArray({ min: 1 }).withMessage('At least one skill is required')
], async (req, res) => {
    try {
        // Users can only update their own profile
        if (req.params.id !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to update this profile' });
        }

        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array()[0].msg });
        }

        const allowedFields = ['name', 'university', 'department', 'year', 'skills', 'bio'];
        const updates = {};
        allowedFields.forEach(field => {
            if (req.body[field] !== undefined) {
                updates[field] = req.body[field];
            }
        });

        const user = await User.findByIdAndUpdate(req.params.id, updates, {
            new: true,
            runValidators: true
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        res.json(user);
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
