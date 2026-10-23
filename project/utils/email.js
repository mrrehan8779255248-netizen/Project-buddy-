const nodemailer = require('nodemailer');

function emailConfigured() {
    return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS && process.env.EMAIL_FROM);
}

function getTransporter() {
    if (!emailConfigured()) throw new Error('SMTP email settings are missing');
    const port = Number(process.env.SMTP_PORT || 587);
    return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port,
        secure: process.env.SMTP_SECURE === 'true' || port === 465,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 15000
    });
}

async function sendPasswordResetOtp(to, otp) {
    const transporter = getTransporter();
    await transporter.sendMail({
        from: process.env.EMAIL_FROM,
        to,
        subject: 'Your ProjectBuddy password recovery code',
        text: `Your ProjectBuddy password recovery code is ${otp}. It expires in 10 minutes. If you did not request this, you can ignore this email.`,
        html: `<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;padding:28px;color:#14233b"><h2 style="margin:0 0 12px;color:#3454d1">ProjectBuddy</h2><p>Use this code to reset your password:</p><p style="font-size:30px;letter-spacing:8px;font-weight:700;padding:18px;background:#f2f5ff;border-radius:12px;text-align:center">${otp}</p><p>This code expires in <strong>10 minutes</strong>. Never share it with anyone.</p><p style="color:#65738b;font-size:13px">If you did not request this, you can safely ignore this email.</p></div>`
    });
}

module.exports = { emailConfigured, sendPasswordResetOtp };
