const mongoose = require('mongoose');

const projectSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: [true, 'Project title is required'],
        trim: true,
        maxlength: 150
    },
    description: {
        type: String,
        required: [true, 'Project description is required'],
        maxlength: 2000
    },
    department: {
        type: String,
        required: [true, 'Department is required'],
        enum: ['Computer Science', 'Electrical Engineering', 'Mechanical Engineering', 'Civil Engineering', 'Data Science', 'Information Technology', 'Electronics & Communication', 'Biotechnology', 'Business Administration', 'Design', 'Other']
    },
    difficulty: {
        type: String,
        required: [true, 'Difficulty level is required'],
        enum: ['Beginner', 'Intermediate', 'Advanced']
    },
    skills: [{
        type: String,
        trim: true
    }],
    teamSize: {
        type: String,
        required: true,
        enum: ['1 Partner', '2-3 Partners', '4-5 Partners', '5+ Partners']
    },
    status: {
        type: String,
        default: 'Looking for Partners',
        enum: ['Looking for Partners', 'In Progress', 'Open to Ideas']
    },
    isFlagged: {
        type: Boolean,
        default: false
    },
    reports: [{
        reportedBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        reason: {
            type: String,
            default: 'Suspicious or duplicate content'
        },
        reportedAt: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

// Populate user when querying
projectSchema.pre(/^find/, function(next) {
    this.populate('user', 'name university department year skills status anonToken');
    next();
});

module.exports = mongoose.model('Project', projectSchema);
