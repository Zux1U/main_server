'use strict';

const fs = require('fs');
const path = require('path');

class StateStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = loadState(filePath);
  }

  getBotState(username) {
    return this.state.bots[username] || null;
  }

  getAllState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  getArenaState() {
    return this.state.arena ? JSON.parse(JSON.stringify(this.state.arena)) : null;
  }

  upsertBotState(username, patch) {
    const current = this.state.bots[username] || { username };
    this.state.bots[username] = {
      ...current,
      ...patch,
      username
    };
    this.touch();
  }

  markBotDisconnected(username, reason) {
    this.upsertBotState(username, {
      status: 'disconnected',
      lastDisconnectReason: reason || 'unknown',
      lastDisconnectAt: new Date().toISOString()
    });
  }

  upsertArenaState(patch) {
    const current = this.state.arena || {};
    this.state.arena = {
      ...current,
      ...patch
    };
    this.touch();
  }

  pruneBotStates(allowedUsernames) {
    const allowed = new Set(Array.isArray(allowedUsernames) ? allowedUsernames : []);
    let changed = false;

    for (const username of Object.keys(this.state.bots || {})) {
      if (allowed.has(username)) {
        continue;
      }

      delete this.state.bots[username];
      changed = true;
    }

    if (changed) {
      this.touch();
    }

    return changed;
  }

  touch() {
    this.state.updatedAt = new Date().toISOString();
    saveState(this.filePath, this.state);
  }
}

function loadState(filePath) {
  ensureDirectory(path.dirname(filePath));

  if (!fs.existsSync(filePath)) {
    const initial = {
      project: 'mc-bot-colony',
      updatedAt: null,
      arena: {},
      bots: {}
    };
    saveState(filePath, initial);
    return initial;
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return {
    project: parsed.project || 'mc-bot-colony',
    updatedAt: parsed.updatedAt || null,
    arena: parsed.arena || {},
    bots: parsed.bots || {}
  };
}

function saveState(filePath, data) {
  ensureDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

module.exports = {
  StateStore
};
