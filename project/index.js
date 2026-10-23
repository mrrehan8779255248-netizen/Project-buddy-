// Vercel's Express adapter discovers this entrypoint and serves the app as a function.
require('express');
const app = require('./server');
module.exports = app;
