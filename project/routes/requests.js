const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Request = require('../models/Request');
const Project = require('../models/Project');
const { protect } = require('../middleware/auth');

// @route   POST /api/requests
// @desc    Send a partnership request
// @access  Private
router.post('/', protect, [
    body('projectId').notEmpty().withMessage('Project ID is required'),
    body('message').trim().notEmpty().withMessage('A message is required')
        .isLength({ max: 1000 }).withMessage('Message must be under 1000 characters')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array()[0].msg });
        }

        const { projectId, message } = req.body;

        // Get the project
        const project = await Project.findById(projectId);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        // Can't request own project
        if (project.user._id.toString() === req.user._id.toString()) {
            return res.status(400).json({ message: 'You cannot request partnership on your own project' });
        }

        // Check for duplicate request
        const existing = await Request.findOne({
            fromUser: req.user._id,
            project: projectId
        });
        if (existing) {
            return res.status(400).json({ message: 'You already sent a request for this project' });
        }

        const request = await Request.create({
            fromUser: req.user._id,
            toUser: project.user._id,
            project: projectId,
            message
        });

        // Populate for response
        await request.populate('fromUser', 'name email university department year skills');
        await request.populate('toUser', 'name email university department year skills');
        await request.populate('project', 'title department difficulty skills teamSize status');

        res.status(201).json(request);
    } catch (error) {
        console.error('Create request error:', error);
        if (error.code === 11000) {
            return res.status(400).json({ message: 'You already sent a request for this project' });
        }
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/requests/received
// @desc    Get requests received by current user
// @access  Private
router.get('/received', protect, async (req, res) => {
    try {
        const requests = await Request.find({ toUser: req.user._id })
            .populate('fromUser', 'name email university department year skills')
            .populate('toUser', 'name email university department year skills')
            .populate('project', 'title department difficulty skills teamSize status')
            .sort({ status: 1, createdAt: -1 });

        res.json(requests);
    } catch (error) {
        console.error('Get received requests error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/requests/sent
// @desc    Get requests sent by current user
// @access  Private
router.get('/sent', protect, async (req, res) => {
    try {
        const requests = await Request.find({ fromUser: req.user._id })
            .populate('fromUser', 'name email university department year skills')
            .populate('toUser', 'name email university department year skills')
            .populate('project', 'title department difficulty skills teamSize status')
            .sort({ createdAt: -1 });

        res.json(requests);
    } catch (error) {
        console.error('Get sent requests error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/requests/count
// @desc    Get count of pending received requests
// @access  Private
router.get('/count', protect, async (req, res) => {
    try {
        const count = await Request.countDocuments({
            toUser: req.user._id,
            status: 'pending'
        });
        res.json({ count });
    } catch (error) {
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   PUT /api/requests/:id
// @desc    Accept or decline a request
// @access  Private
router.put('/:id', protect, [
    body('status').isIn(['accepted', 'declined']).withMessage('Status must be accepted or declined')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array()[0].msg });
        }

        const request = await Request.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ message: 'Request not found' });
        }

        // Only the project owner (toUser) can accept/decline
        if (request.toUser._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to update this request' });
        }

        if (request.status !== 'pending') {
            return res.status(400).json({ message: 'This request has already been ' + request.status });
        }

        request.status = req.body.status;
        await request.save();

        // Re-populate
        await request.populate('fromUser', 'name email university department year skills');
        await request.populate('toUser', 'name email university department year skills');
        await request.populate('project', 'title department difficulty skills teamSize status');

        res.json(request);
    } catch (error) {
        console.error('Update request error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
