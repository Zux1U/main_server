'use strict';

const fs = require('fs');
const path = require('path');

class Logger {
  constructor(baseDir) {
    this.baseDir = baseDir;
    this.recentEntries = [];
    fs.mkdirSync(this.baseDir, { recursive: true });

    const timestamp = new Date().toISOString().replace(/[:]/g, '-');
    this.logFile = path.join(this.baseDir, `${timestamp}.log`);
  }

  info(message, details) {
    this.write('INFO', message, details);
  }

  warn(message, details) {
    this.write('WARN', message, details);
  }

  error(message, details) {
    this.write('ERROR', message, details);
  }

  debug(message, details) {
    this.write('DEBUG', message, details);
  }

  write(level, message, details) {
    const timestamp = new Date().toISOString();
    const detailsText = details ? ` ${serialize(details)}` : '';
    const line = `[${timestamp}] [${level}] ${message}${detailsText}`;
    this.recentEntries.push({
      timestamp,
      level,
      message,
      details: details || null,
      line
    });
    if (this.recentEntries.length > 300) {
      this.recentEntries.shift();
    }
    console.log(line);
    fs.appendFileSync(this.logFile, `${line}\n`);
  }

  getRecentEntries(limit) {
    const safeLimit = Math.max(1, Math.min(limit || 100, 300));
    return this.recentEntries.slice(-safeLimit);
  }
}

function serialize(value) {
  if (typeof value === 'string') return value;

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

module.exports = {
  Logger
};
