const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const Project = require('../models/Project');
const Request = require('../models/Request');
const User = require('../models/User');
const CollaborationMessage = require('../models/CollaborationMessage');
const { protect } = require('../middleware/auth');

// @route   GET /api/projects
// @desc    Get all projects (with optional filters)
// @access  Private
router.get('/', protect, async (req, res) => {
    try {
        const { department, difficulty, status, search, page = 1, limit = 30 } = req.query;

        const filter = {};

        if (department) filter.department = department;
        if (difficulty) filter.difficulty = difficulty;
        if (status) filter.status = status;
        if (search) {
            filter.$or = [
                { title: { $regex: search, $options: 'i' } },
                { skills: { $elemMatch: { $regex: search, $options: 'i' } } },
                { department: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const projects = await Project.find(filter)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(parseInt(limit));

        const total = await Project.countDocuments(filter);

        const currentUser = await User.findById(req.user._id).select('bookmarks skills');
        const userBookmarks = currentUser.bookmarks ? currentUser.bookmarks.map(b => b.toString()) : [];
        const userSkills = (currentUser.skills || []).map(s => s.toLowerCase());

        // For each project, compute metadata & hide private ideas
        const projectsWithMeta = await Promise.all(projects.map(async (project) => {
            const projectObj = project.toObject();

            // Check if current user sent a request for this project
            const userRequest = await Request.findOne({
                fromUser: req.user._id,
                project: project._id
            }).select('status');

            // Check if current user is an accepted partner
            const isPartner = await Request.findOne({
                project: project._id,
                status: 'accepted',
                $or: [
                    { fromUser: req.user._id },
                    { toUser: req.user._id }
                ]
            });

            const isOwner = project.user._id.toString() === req.user._id.toString();

            projectObj.isOwner = isOwner;
            projectObj.isPartner = !!isPartner;
            projectObj.requestStatus = userRequest ? userRequest.status : null;
            projectObj.isBookmarked = userBookmarks.includes(project._id.toString());

            // Compute skill match score percentage
            if (project.skills && project.skills.length > 0 && userSkills.length > 0) {
                const matched = project.skills.filter(s => userSkills.includes(s.toLowerCase()));
                projectObj.matchScore = Math.min(100, Math.round((matched.length / project.skills.length) * 100));
            } else {
                projectObj.matchScore = 0;
            }

            // CRITICAL: Protect idea blueprint unless owner or accepted partner
            if (!isOwner && !isPartner) {
                projectObj.description = null;
            }

            return projectObj;
        }));

        res.json({
            projects: projectsWithMeta,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit))
        });
    } catch (error) {
        console.error('Get projects error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/projects/mine
// @desc    Get current user's projects
// @access  Private
router.get('/mine', protect, async (req, res) => {
    try {
        const projects = await Project.find({ user: req.user._id }).sort({ createdAt: -1 });

        const projectsWithStats = await Promise.all(projects.map(async (project) => {
            const projectObj = project.toObject();
            projectObj.pendingRequests = await Request.countDocuments({
                project: project._id,
                status: 'pending'
            });
            projectObj.acceptedPartners = await Request.countDocuments({
                project: project._id,
                status: 'accepted'
            });
            return projectObj;
        }));

        res.json(projectsWithStats);
    } catch (error) {
        console.error('Get my projects error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/projects/partnered
// @desc    Get projects where user is an accepted partner
// @access  Private
router.get('/partnered', protect, async (req, res) => {
    try {
        const acceptedRequests = await Request.find({
            status: 'accepted',
            $or: [
                { fromUser: req.user._id },
                { toUser: req.user._id }
            ]
        }).populate({
            path: 'project',
            populate: { path: 'user', select: 'name email university department year' }
        });

        const results = acceptedRequests.map(reqDoc => {
            const partner = reqDoc.fromUser._id.toString() === req.user._id.toString()
                ? reqDoc.toUser : reqDoc.fromUser;
            return {
                request: reqDoc,
                project: reqDoc.project,
                partner
            };
        });

        res.json(results);
    } catch (error) {
        console.error('Get partnered projects error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/projects/:id/bookmark
// @desc    Bookmark or unbookmark a project
// @access  Private
router.post('/:id/bookmark', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);
        const projectId = req.params.id;

        const index = user.bookmarks.indexOf(projectId);
        let bookmarked = false;

        if (index > -1) {
            user.bookmarks.splice(index, 1);
            bookmarked = false;
        } else {
            user.bookmarks.push(projectId);
            bookmarked = true;
        }

        await user.save();
        res.json({ bookmarked, message: bookmarked ? 'Project saved to bookmarks' : 'Project removed from bookmarks' });
    } catch (error) {
        console.error('Bookmark error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/projects/:id/report
// @desc    Report an inappropriate project title to Anonymous Moderation
// @access  Private
router.post('/:id/report', protect, async (req, res) => {
    try {
        const { reason } = req.body;
        const project = await Project.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        project.reports.push({
            reportedBy: req.user._id,
            reason: reason || 'Inappropriate or spam project title'
        });
        project.isFlagged = true;
        await project.save();

        res.json({ message: 'Report submitted for review. Thank you for keeping ProjectBuddy safe!' });
    } catch (error) {
        console.error('Report error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/projects/:id/messages
// @desc    Get collaboration room messages for an accepted project partnership
// @access  Private (Owner or Accepted Partner)
router.get('/:id/messages', protect, async (req, res) => {
    try {
        const project = await Project.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const isOwner = project.user._id.toString() === req.user._id.toString();
        const isPartner = await Request.findOne({
            project: project._id,
            status: 'accepted',
            $or: [
                { fromUser: req.user._id },
                { toUser: req.user._id }
            ]
        });

        if (!isOwner && !isPartner) {
            return res.status(403).json({ message: 'Access denied: Collaboration room is exclusive to matched partners.' });
        }

        const messages = await CollaborationMessage.find({ projectId: project._id })
            .sort({ createdAt: 1 });

        res.json(messages);
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/projects/:id/messages
// @desc    Post a message in the partner collaboration room
// @access  Private (Owner or Accepted Partner)
router.post('/:id/messages', protect, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || !message.trim()) {
            return res.status(400).json({ message: 'Message content cannot be blank' });
        }

        const project = await Project.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const isOwner = project.user._id.toString() === req.user._id.toString();
        const isPartner = await Request.findOne({
            project: project._id,
            status: 'accepted',
            $or: [
                { fromUser: req.user._id },
                { toUser: req.user._id }
            ]
        });

        if (!isOwner && !isPartner) {
            return res.status(403).json({ message: 'Only project owners and accepted partners can collaborate in this room' });
        }

        const newMessage = await CollaborationMessage.create({
            projectId: project._id,
            sender: req.user._id,
            message: message.trim()
        });

        await newMessage.populate('sender', 'name department university');

        res.status(201).json(newMessage);
    } catch (error) {
        console.error('Post message error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   GET /api/projects/:id
// @desc    Get single project by ID
// @access  Private
router.get('/:id', protect, async (req, res) => {
    try {
        const project = await Project.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        const projectObj = project.toObject();
        const isOwner = project.user._id.toString() === req.user._id.toString();

        const isPartner = await Request.findOne({
            project: project._id,
            status: 'accepted',
            $or: [
                { fromUser: req.user._id },
                { toUser: req.user._id }
            ]
        });

        const userRequest = await Request.findOne({
            fromUser: req.user._id,
            project: project._id
        }).select('status');

        projectObj.isOwner = isOwner;
        projectObj.isPartner = !!isPartner;
        projectObj.requestStatus = userRequest ? userRequest.status : null;

        // Only show description to owner or accepted partner
        if (!isOwner && !isPartner) {
            projectObj.description = null;
        }

        // If owner or partner, get partner list
        if (isOwner || isPartner) {
            const partners = await Request.find({
                project: project._id,
                status: 'accepted'
            }).populate('fromUser', 'name email department university year skills');
            projectObj.partners = partners.map(r => r.fromUser);
        }

        res.json(projectObj);
    } catch (error) {
        console.error('Get project error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   POST /api/projects
// @desc    Create a new project
// @access  Private
router.post('/', protect, [
    body('title').trim().notEmpty().withMessage('Project title is required'),
    body('description').trim().notEmpty().withMessage('Project description is required'),
    body('department').notEmpty().withMessage('Department is required'),
    body('difficulty').notEmpty().withMessage('Difficulty level is required'),
    body('skills').isArray({ min: 1 }).withMessage('At least one skill is required'),
    body('teamSize').notEmpty().withMessage('Team size is required')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ message: errors.array()[0].msg });
        }

        const { title, description, department, difficulty, skills, teamSize, status } = req.body;

        const project = await Project.create({
            user: req.user._id,
            title,
            description,
            department,
            difficulty,
            skills,
            teamSize,
            status: status || 'Looking for Partners'
        });

        await project.populate('user', 'name email university department year skills');

        res.status(201).json(project);
    } catch (error) {
        console.error('Create project error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// @route   DELETE /api/projects/:id
// @desc    Delete a project
// @access  Private
router.delete('/:id', protect, async (req, res) => {
    try {
        const project = await Project.findById(req.params.id);
        if (!project) {
            return res.status(404).json({ message: 'Project not found' });
        }

        if (project.user._id.toString() !== req.user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to delete this project' });
        }

        await Request.deleteMany({ project: project._id });
        await CollaborationMessage.deleteMany({ projectId: project._id });
        await Project.findByIdAndDelete(req.params.id);

        res.json({ message: 'Project deleted successfully' });
    } catch (error) {
        console.error('Delete project error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

module.exports = router;
