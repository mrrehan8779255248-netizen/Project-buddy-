const mongoose = require('mongoose');

const activityEventSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    event: { type: String, required: true, trim: true, maxlength: 80 },
    summary: { type: String, default: '', maxlength: 160 }
}, { timestamps: { createdAt: true, updatedAt: false } });

activityEventSchema.index({ user: 1, createdAt: -1 });
// Keep a bounded audit history; events expire after one year.
activityEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

module.exports = mongoose.model('ActivityEvent', activityEventSchema);
