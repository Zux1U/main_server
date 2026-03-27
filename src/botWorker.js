'use strict';

const { BotRuntime } = require('./botRuntime');

let runtime = null;
let stateStore = null;
let coordination = null;
let heartbeatInterval = null;
let heartbeatUsername = null;
const resourceRequests = new Map();

process.on('message', async (message) => {
  if (!message || typeof message !== 'object') return;

  switch (message.type) {
    case 'init':
      initializeRuntime(message);
      break;
    case 'command':
      await handleCommand(message);
      break;
    case 'resource_response':
      resolveResourceRequest(message.requestId, message.result);
      break;
    case 'shutdown':
      shutdownWorker(message.reason || 'shutdown');
      break;
    default:
      sendToParent({
        type: 'log',
        level: 'WARN',
        message: '[worker] unknown parent message',
        details: {
          kind: message.type || 'unknown'
        }
      });
      break;
  }
});

process.on('uncaughtException', (error) => {
  sendToParent({
    type: 'log',
    level: 'ERROR',
    message: '[worker] uncaughtException',
    details: {
      message: error.message,
      stack: error.stack
    }
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  sendToParent({
    type: 'log',
    level: 'ERROR',
    message: '[worker] unhandledRejection',
    details: {
      message: error.message,
      stack: error.stack
    }
  });
});

function initializeRuntime(message) {
  stopHeartbeatLoop();
  stateStore = new ProcessStateStore();
  coordination = new IpcCoordinator(message.username);

  runtime = new BotRuntime({
    username: message.username,
    role: message.role,
    server: message.runtimeConfig.server,
    roles: message.runtimeConfig.roles,
    arena: message.runtimeConfig.arena,
    navigation: message.runtimeConfig.navigation,
    survival: message.runtimeConfig.survival,
    build: message.runtimeConfig.build,
    stateMachine: message.runtimeConfig.stateMachine,
    tasks: message.runtimeConfig.tasks,
    reconnect: message.runtimeConfig.reconnect,
    chatOnSpawn: message.runtimeConfig.bots.chatOnSpawn,
    coordination,
    logger: new ProcessLogger(),
    stateStore,
    onReady: (payload) => {
      sendToParent({
        type: 'ready',
        username: message.username,
        pid: process.pid,
        mode: payload && payload.mode ? payload.mode : (message.runtimeConfig.arena && message.runtimeConfig.arena.enabled ? 'arena' : 'legacy')
      });
    },
    emitEvent: (name, payload) => {
      sendToParent({
        type: 'arena_event',
        username: message.username,
        name,
        payload: payload || null
      });
    }
  });

  runtime.connect();
  heartbeatUsername = message.username;
  startHeartbeatLoop(message.runtimeConfig.arena);
}

async function handleCommand(message) {
  if (!runtime) {
    sendToParent({
      type: 'command_response',
      requestId: message.requestId,
      result: { ok: false, error: 'worker_not_initialized' }
    });
    return;
  }

  let result = null;

  try {
    result = await runtime.executeControlCommand(message.command, message.args);
  } catch (error) {
    result = { ok: false, error: error.message };
  }

  sendToParent({
    type: 'command_response',
    requestId: message.requestId,
    result
  });
}

function startHeartbeatLoop(arenaConfig) {
  const intervalMs = arenaConfig && arenaConfig.enabled
    ? arenaConfig.heartbeatIntervalMs
    : 5000;

  heartbeatInterval = setInterval(() => {
    if (!stateStore || !heartbeatUsername) return;

    const snapshot = stateStore.getBotState(heartbeatUsername) || {};
    sendToParent({
      type: 'heartbeat',
      username: heartbeatUsername,
      payload: {
        sentAt: new Date().toISOString(),
        status: snapshot.status || null,
        runtimeMode: snapshot.runtimeMode || null,
        aiState: snapshot.ai ? snapshot.ai.state : null,
        roundStatus: snapshot.arena ? snapshot.arena.roundStatus : null,
        arenaState: snapshot.arena ? snapshot.arena.state : null,
        vitals: snapshot.vitals || null,
        position: snapshot.position || null,
        target: snapshot.arena ? snapshot.arena.target || null : null,
        stats: snapshot.arena ? snapshot.arena.stats || null : null
      }
    });
  }, intervalMs);
}

function stopHeartbeatLoop() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

function shutdownWorker(reason) {
  stopHeartbeatLoop();
  if (runtime) {
    runtime.stop(reason || 'shutdown');
  }
  setTimeout(() => process.exit(0), 250);
}

function resolveResourceRequest(requestId, result) {
  const pending = resourceRequests.get(requestId);
  if (!pending) return;

  clearTimeout(pending.timeout);
  resourceRequests.delete(requestId);
  pending.resolve(result);
}

function sendToParent(message) {
  if (typeof process.send !== 'function') return;
  process.send(message);
}

class ProcessLogger {
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
    sendToParent({
      type: 'log',
      level,
      message,
      details: details || null
    });
  }
}

class ProcessStateStore {
  constructor() {
    this.state = {
      project: 'mc-bot-colony-worker',
      updatedAt: null,
      bots: {}
    };
  }

  getBotState(username) {
    return this.state.bots[username] || null;
  }

  getAllState() {
    return JSON.parse(JSON.stringify(this.state));
  }

  upsertBotState(username, patch) {
    const current = this.state.bots[username] || { username };
    this.state.bots[username] = {
      ...current,
      ...patch,
      username
    };
    this.state.updatedAt = new Date().toISOString();
    sendToParent({
      type: 'state_patch',
      username,
      patch
    });
  }

  markBotDisconnected(username, reason) {
    this.upsertBotState(username, {
      status: 'disconnected',
      lastDisconnectReason: reason || 'unknown',
      lastDisconnectAt: new Date().toISOString()
    });

    sendToParent({
      type: 'state_mark_disconnected',
      username,
      reason: reason || 'unknown'
    });
  }
}

class IpcCoordinator {
  constructor(username) {
    this.username = username;
  }

  reserveResource(resourceKey) {
    return this.request('reserve', resourceKey);
  }

  releaseResource(resourceKey) {
    return this.request('release', resourceKey);
  }

  isResourceReservedByOther(resourceKey) {
    return this.request('is_reserved_by_other', resourceKey);
  }

  request(action, resourceKey) {
    const requestId = `${this.username}-${action}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        resourceRequests.delete(requestId);
        reject(new Error(`resource_request_timeout:${action}`));
      }, 3000);

      resourceRequests.set(requestId, {
        resolve,
        reject,
        timeout
      });

      sendToParent({
        type: 'resource_request',
        requestId,
        action,
        resourceKey
      });
    });
  }
}
