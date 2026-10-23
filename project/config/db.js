const mongoose = require('mongoose');

async function connectDB() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is missing. Copy .env.example to .env and configure it.');

    mongoose.set('strictQuery', true);
    mongoose.set('sanitizeFilter', true);

    const conn = await mongoose.connect(uri, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
        maxPoolSize: 10,
        minPoolSize: 0,
        autoIndex: process.env.NODE_ENV !== 'production'
    });

    console.log(`MongoDB connected: ${conn.connection.name} (${conn.connection.host})`);
    return conn;
}

module.exports = connectDB;
