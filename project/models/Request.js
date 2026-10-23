const mongoose = require('mongoose');

const requestSchema = new mongoose.Schema({
    fromUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    toUser: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    project: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project',
        required: true
    },
    message: {
        type: String,
        required: [true, 'A message is required with your partnership request'],
        maxlength: 1000
    },
    status: {
        type: String,
        default: 'pending',
        enum: ['pending', 'accepted', 'declined']
    }
}, {
    timestamps: true
});

// Prevent duplicate requests
requestSchema.index({ fromUser: 1, project: 1 }, { unique: true });

// Populate references when querying
requestSchema.pre(/^find/, function(next) {
    this.populate('fromUser', 'name email university department year skills')
        .populate('toUser', 'name email university department year skills')
        .populate('project', 'title department difficulty skills teamSize status');
    next();
});

module.exports = mongoose.model('Request', requestSchema);
