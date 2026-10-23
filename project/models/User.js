const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true
    },
    email: {
        type: String,
        required: [true, 'Email is required'],
        unique: true,
        lowercase: true,
        trim: true
    },
    password: {
        type: String,
        required: [true, 'Password is required'],
        minlength: 8,
        select: false
    },
    status: {
        type: String,
        enum: ['active', 'suspended', 'flagged'],
        default: 'active'
    },
    // Optional public-facing account reference; not an authorization role.
    anonToken: {
        type: String,
        unique: true,
        default: () => 'STU_' + Math.random().toString(36).substring(2, 8).toUpperCase()
    },
    lastLoginAt: { type: Date, default: null },
    // Increment after password recovery to revoke existing stateless JWT sessions.
    tokenVersion: { type: Number, default: 0, select: false },
    passwordResetOtpHash: { type: String, select: false },
    passwordResetOtpExpiresAt: { type: Date, select: false },
    passwordResetOtpAttempts: { type: Number, default: 0, select: false },
    passwordResetOtpRequestedAt: { type: Date, select: false },
    // Optional profile media is compressed in the browser and stored as validated data URLs.
    profilePicture: { type: String, default: '', maxlength: 700000 },
    coverImage: { type: String, default: '', maxlength: 700000 },
    headline: { type: String, default: '', trim: true, maxlength: 120 },
    location: { type: String, default: '', trim: true, maxlength: 120 },
    degree: { type: String, default: '', trim: true, maxlength: 120 },
    graduationYear: { type: String, default: '', trim: true, maxlength: 20 },
    portfolioUrl: { type: String, default: '', trim: true, maxlength: 300 },
    linkedinUrl: { type: String, default: '', trim: true, maxlength: 300 },
    githubUrl: { type: String, default: '', trim: true, maxlength: 300 },
    interests: [{ type: String, trim: true, maxlength: 50 }],
    university: {
        type: String,
        required: [true, 'University is required'],
        trim: true
    },
    department: {
        type: String,
        required: [true, 'Department is required'],
        enum: ['Computer Science', 'Electrical Engineering', 'Mechanical Engineering', 'Civil Engineering', 'Data Science', 'Information Technology', 'Electronics & Communication', 'Biotechnology', 'Business Administration', 'Design', 'Other']
    },
    year: {
        type: String,
        required: [true, 'Year is required'],
        enum: ['1st Year', '2nd Year', '3rd Year', '4th Year', 'Post Graduate', 'PhD']
    },
    skills: [{
        type: String,
        trim: true
    }],
    bio: {
        type: String,
        default: 'Student passionate about collaborative projects.',
        maxlength: 500
    },
    bookmarks: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Project'
    }]
}, {
    timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function(next) {
    if (!this.isModified('password')) return next();
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
});

// Compare password method
userSchema.methods.matchPassword = async function(enteredPassword) {
    return await bcrypt.compare(enteredPassword, this.password);
};

module.exports = mongoose.model('User', userSchema);
