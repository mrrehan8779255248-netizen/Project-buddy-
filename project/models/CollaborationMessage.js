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
    message: {
        type: String,
        required: true,
        trim: true,
        maxlength: 1000
    }
}, {
    timestamps: true
});

collaborationMessageSchema.pre(/^find/, function(next) {
    this.populate('sender', 'name department university');
    next();
});

module.exports = mongoose.model('CollaborationMessage', collaborationMessageSchema);
