const mongoose = require('mongoose');

const collaborationMessageSchema = new mongoose.Schema({
    projectId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    recipient: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    message: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    }
}, {
    timestamps: true
});

collaborationMessageSchema.index({ projectId: 1, sender: 1, recipient: 1, createdAt: 1 });
collaborationMessageSchema.index({ projectId: 1, recipient: 1, sender: 1, createdAt: 1 });

collaborationMessageSchema.pre(/^find/, function(next) {
    this.populate('sender', 'name department university')
        .populate('recipient', 'name department university');
    next();
});

module.exports = mongoose.model('CollaborationMessage', collaborationMessageSchema);
