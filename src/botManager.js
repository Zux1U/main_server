'use strict';

const path = require('path');
const os = require('os');
const { fork } = require('child_process');

const COMMAND_TIMEOUT_MS = 15000;
const WORKER_RESPAWN_DELAY_MS = 3000;

class BotManager {
  constructor(config, logger, stateStore) {
    this.config = config;
    this.logger = logger;
    this.stateStore = stateStore;
    this.bots = [];
    this.resourceReservations = new Map();
    this.commandRequests = new Map();
    this.stopping = false;
    this.arenaController = null;
    this.maxBotCount = Number.isInteger(config.bots.maxCount) && config.bots.maxCount > 0
      ? config.bots.maxCount
      : config.bots.count;
    this.safeScaleLimit = Number.isInteger(config.bots.safeScaleLimit) && config.bots.safeScaleLimit > 0
      ? config.bots.safeScaleLimit
      : 120;
    this.activeUsernames = [];
  }

  setArenaController(arenaController) {
    this.arenaController = arenaController;
  }

  async startAll() {
    this.stopping = false;
    return this.setActiveBotCount(this.config.bots.count, {
      reason: 'startup'
    });
  }

  async setActiveBotCount(count, options) {
    this.stopping = false;
    const requestedCount = clamp(Math.floor(Number(count) || 0), 0, this.maxBotCount);
    const dynamicSafe = this.getDynamicSafeCapacity();
    const safeCapacity = Math.max(1, Math.min(this.maxBotCount, this.safeScaleLimit, dynamicSafe));
    const allowUnsafe = !!(options && options.allowUnsafe);
    const targetCount = allowUnsafe
      ? requestedCount
      : Math.min(requestedCount, safeCapacity);
    this.ensureDescriptorPool(targetCount);

    const startupAt = new Date().toISOString();
    const previousActive = new Set(this.activeUsernames);
    const activeDescriptors = this.bots.slice(0, targetCount);
    const activeSet = new Set(activeDescriptors.map((descriptor) => descriptor.username));
    this.activeUsernames = activeDescriptors.map((descriptor) => descriptor.username);
    this.stateStore.pruneBotStates(this.activeUsernames);

    this.logger.info('Applying bot roster size', {
      requested: requestedCount,
      active: targetCount,
      capacity: this.maxBotCount,
      safeCapacity,
      clamped: targetCount !== requestedCount,
      reason: options && options.reason ? options.reason : 'manual'
    });

    let spawned = 0;
    for (const descriptor of this.bots) {
      const shouldBeActive = activeSet.has(descriptor.username);
      descriptor.desiredOnline = shouldBeActive;

      if (shouldBeActive) {
        const currentState = this.stateStore.getBotState(descriptor.username) || {};
        this.stateStore.upsertBotState(descriptor.username, {
          role: descriptor.role,
          runtimeMode: this.config.arena && this.config.arena.enabled ? 'arena' : 'legacy',
          status: descriptor.workerOnline ? 'running' : 'starting',
          worker: {
            ...(currentState.worker || {}),
            online: !!descriptor.workerOnline,
            pid: descriptor.child && descriptor.workerOnline ? descriptor.child.pid : null,
            lastManagerStartAt: startupAt
          }
        });

        if (!descriptor.child) {
          this.spawnBotProcess(descriptor);
          spawned += 1;
          await throttleWorkerSpawns(spawned, this.config.bots.spawnIntervalMs);
        }
        continue;
      }

      if (descriptor.child) {
        await this.stopDescriptor(descriptor, 'scaled-down');
      }

      if (!previousActive.has(descriptor.username)) {
        continue;
      }

      this.stateStore.upsertBotState(descriptor.username, {
        status: 'inactive',
        worker: {
          online: false,
          pid: null,
          lastScaledDownAt: new Date().toISOString()
        }
      });
    }

    return {
      ok: true,
      activeCount: targetCount,
      capacity: this.maxBotCount,
      safeCapacity,
      clamped: targetCount !== requestedCount,
      requestedCount,
      usernames: this.activeUsernames.slice()
    };
  }

  getManagerState() {
    const activeDescriptors = this.getActiveDescriptors();
    const safeCapacity = Math.max(1, Math.min(this.maxBotCount, this.safeScaleLimit, this.getDynamicSafeCapacity()));
    return {
      activeCount: activeDescriptors.length,
      onlineCount: activeDescriptors.filter((descriptor) => descriptor.workerOnline).length,
      capacity: this.maxBotCount,
      safeCapacity,
      startOnBoot: this.config.bots.startOnBoot !== false
    };
  }

  getDynamicSafeCapacity() {
    const cpuCount = Math.max(1, os.cpus().length);
    const totalMemGb = os.totalmem() / (1024 ** 3);
    const byCpu = cpuCount * 10;
    const byMem = Math.floor(totalMemGb * 8);
    return Math.max(1, Math.min(byCpu, byMem));
  }

  ensureDescriptorPool(count) {
    const targetCount = clamp(Math.floor(Number(count) || 0), 0, this.maxBotCount);
    if (targetCount <= this.bots.length) {
      return;
    }

    const usernames = buildUsernames({
      ...this.config.bots,
      count: targetCount
    });
    const startupAt = new Date().toISOString();

    for (let index = this.bots.length; index < targetCount; index += 1) {
      const username = usernames[index];
      const role = resolveRole(this.config.roles, index);
      const runtimeConfig = cloneRuntimeConfig(this.config);
      const descriptor = {
        username,
        role,
        index,
        runtimeConfig,
        child: null,
        workerOnline: false,
        lastSpawnAt: null,
        desiredOnline: false
      };

      this.bots.push(descriptor);
      this.stateStore.upsertBotState(username, {
        role,
        runtimeMode: this.config.arena && this.config.arena.enabled ? 'arena' : 'legacy',
        status: 'inactive',
        worker: {
          online: false,
          pid: null,
          lastManagerStartAt: startupAt
        }
      });
    }
  }

  async stopDescriptor(descriptor, reason) {
    if (!descriptor || !descriptor.child) {
      return;
    }

    const child = descriptor.child;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        child.off('exit', onExit);
        clearTimeout(timer);
        resolve();
      };
      const onExit = () => finish();
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch (_error) {
          // ignore
        }
        finish();
      }, 2000);

      child.once('exit', onExit);
      try {
        child.send({
          type: 'shutdown',
          reason: reason || 'shutdown'
        });
      } catch (_error) {
        finish();
      }
    });
  }

  async stopAll(reason) {
    this.stopping = true;
    this.activeUsernames = [];
    this.bots.forEach((descriptor) => {
      descriptor.desiredOnline = false;
    });
    this.logger.warn('Stopping all bots', { reason: reason || 'shutdown' });

    const shutdowns = this.bots
      .filter((descriptor) => descriptor.child)
      .map((descriptor) => this.stopDescriptor(descriptor, reason || 'shutdown').catch(() => null));

    return Promise.allSettled(shutdowns);
  }

  getBotSummaries() {
    return this.getActiveDescriptors().map((descriptor) => ({
      username: descriptor.username,
      connected: descriptor.workerOnline,
      state: this.stateStore.getBotState(descriptor.username)
    }));
  }

  getUsernames() {
    return this.activeUsernames.slice();
  }

  getUnavailableParticipants(participantUsernames) {
    const targets = selectArenaDescriptors(this.getActiveDescriptors(), participantUsernames);
    return targets
      .filter((descriptor) => !descriptor.workerOnline || !descriptor.child)
      .map((descriptor) => descriptor.username);
  }

  async waitForParticipantsReady(participantUsernames, timeoutMs) {
    const deadline = Date.now() + Math.max(0, timeoutMs || 0);

    while (Date.now() <= deadline) {
      const unavailable = this.getUnavailableParticipants(participantUsernames);
      if (!unavailable.length) {
        return {
          ok: true,
          unavailable: []
        };
      }

      await delay(250);
    }

    return {
      ok: false,
      unavailable: this.getUnavailableParticipants(participantUsernames)
    };
  }

  getArenaParticipants(participantUsernames) {
    const targets = selectArenaDescriptors(this.getActiveDescriptors(), participantUsernames);
    const totalCount = targets.length;
    return targets.map((descriptor, participantIndex) => ({
      username: descriptor.username,
      index: descriptor.index,
      spawnPoint: resolveSpawnPoint(this.config.arena, participantIndex, totalCount)
    }));
  }

  getArenaSpawnPoint(index, totalCount) {
    return resolveSpawnPoint(this.config.arena, index, totalCount);
  }

  async ensureParticipantsOnline(participantUsernames) {
    const targets = selectArenaDescriptors(this.getActiveDescriptors(), participantUsernames);
    let spawned = 0;
    for (const descriptor of targets) {
      descriptor.desiredOnline = true;
      if (!descriptor.child) {
        this.spawnBotProcess(descriptor);
        spawned += 1;
        await throttleWorkerSpawns(spawned, this.config.bots.spawnIntervalMs);
      }
    }
  }

  async runCommand(input) {
    const target = input && input.target ? input.target : 'all';
    const command = input && input.command ? input.command : '';
    const args = input && input.args ? input.args : {};

    const activeDescriptors = this.getActiveDescriptors();
    const targets = target === 'all'
      ? activeDescriptors
      : activeDescriptors.filter((descriptor) => descriptor.username === target);

    if (!targets.length) {
      return { ok: false, error: 'target_not_found' };
    }

    const results = await Promise.all(targets.map(async (descriptor) => {
      const state = this.stateStore.getBotState(descriptor.username) || {};

      if (!descriptor.workerOnline || !descriptor.child) {
        return {
          username: descriptor.username,
          result: { ok: false, error: 'worker_offline' }
        };
      }

      if (command === 'build_big_house' && state.role && state.role !== 'builder') {
        return {
          username: descriptor.username,
          result: { ok: false, error: 'role_not_builder' }
        };
      }

      try {
        const result = await this.requestCommand(descriptor, command, args);
        return {
          username: descriptor.username,
          result
        };
      } catch (error) {
        return {
          username: descriptor.username,
          result: { ok: false, error: error.message }
        };
      }
    }));

    return { ok: true, results };
  }

  async runArenaCommand(command, args) {
    const allowed = new Set(['prepare_round', 'start_round', 'stop_round', 'reset_position']);
    if (!allowed.has(command)) {
      return { ok: false, error: 'unknown_arena_command' };
    }

    const targets = selectArenaDescriptors(this.getActiveDescriptors(), args && args.participantUsernames);
    const results = await Promise.all(targets.map(async (descriptor) => {
      if (!descriptor.workerOnline || !descriptor.child) {
        return {
          username: descriptor.username,
          result: { ok: false, error: 'worker_offline' }
        };
      }

      try {
        const workerArgs = this.buildArenaArgs(descriptor, command, args || {});
        const result = await this.requestCommand(descriptor, command, workerArgs);
        return {
          username: descriptor.username,
          result
        };
      } catch (error) {
        return {
          username: descriptor.username,
          result: { ok: false, error: error.message }
        };
      }
    }));

    return {
      ok: true,
      command,
      roundId: args && args.roundId ? args.roundId : null,
      results
    };
  }

  spawnBotProcess(descriptor) {
    const workerPath = path.resolve(__dirname, 'botWorker.js');
    const child = fork(workerPath, [], {
      cwd: path.resolve(__dirname, '..'),
      stdio: ['inherit', 'inherit', 'inherit', 'ipc']
    });

    descriptor.child = child;
    descriptor.workerOnline = false;
    descriptor.lastSpawnAt = new Date().toISOString();
    descriptor.desiredOnline = true;

    child.on('message', (message) => {
      this.handleWorkerMessage(descriptor, message);
    });

    child.on('exit', (code, signal) => {
      descriptor.workerOnline = false;
      descriptor.child = null;
      this.stateStore.upsertBotState(descriptor.username, {
        worker: {
          online: false,
          pid: null,
          exitCode: code,
          signal: signal || null,
          lastExitAt: new Date().toISOString()
        }
      });

      this.rejectPendingFor(descriptor.username, signal || `worker-exit-${code}`);

      if (this.stopping || !descriptor.desiredOnline) return;

      this.logger.warn(`[${descriptor.username}] worker exited`, {
        code,
        signal
      });

      setTimeout(() => {
        if (this.stopping || !descriptor.desiredOnline) return;
        this.logger.info(`[${descriptor.username}] respawning worker`, {
          delayMs: WORKER_RESPAWN_DELAY_MS
        });
        this.spawnBotProcess(descriptor);
      }, WORKER_RESPAWN_DELAY_MS);
    });

    child.send({
      type: 'init',
      username: descriptor.username,
      role: descriptor.role,
      runtimeConfig: descriptor.runtimeConfig
    });
  }

  handleWorkerMessage(descriptor, message) {
    if (!message || typeof message !== 'object') return;

    switch (message.type) {
      case 'ready':
        descriptor.workerOnline = true;
        this.stateStore.upsertBotState(descriptor.username, {
          role: descriptor.role,
          worker: {
            online: true,
            pid: message.pid || null,
            mode: message.mode || null,
            readyAt: new Date().toISOString()
          }
        });
        this.logger.info(`[${descriptor.username}] worker ready`, {
          pid: message.pid || null,
          mode: message.mode || null
        });
        break;
      case 'log':
        this.logger.write(message.level || 'INFO', message.message || '', message.details);
        break;
      case 'state_patch':
        this.stateStore.upsertBotState(message.username || descriptor.username, message.patch || {});
        break;
      case 'state_mark_disconnected':
        descriptor.workerOnline = false;
        this.stateStore.markBotDisconnected(message.username || descriptor.username, message.reason);
        break;
      case 'command_response':
        this.resolveCommand(message.requestId, message.result);
        break;
      case 'resource_request':
        this.handleResourceRequest(descriptor, message);
        break;
      case 'heartbeat':
        this.handleHeartbeat(descriptor, message);
        break;
      case 'arena_event':
        this.handleArenaEvent(descriptor, message);
        break;
      default:
        this.logger.warn(`[${descriptor.username}] unknown worker message`, {
          type: message.type
        });
        break;
    }
  }

  handleHeartbeat(descriptor, message) {
    const username = message.username || descriptor.username;
    const currentState = this.stateStore.getBotState(username) || {};
    this.stateStore.upsertBotState(username, {
      worker: {
        ...(currentState.worker || {}),
        online: true,
        lastHeartbeatAt: message.payload && message.payload.sentAt ? message.payload.sentAt : new Date().toISOString()
      }
    });

    if (this.arenaController) {
      this.arenaController.handleWorkerHeartbeat(username, message.payload || null);
    }
  }

  handleArenaEvent(descriptor, message) {
    if (!this.arenaController) return;
    this.arenaController.handleWorkerEvent(
      message.username || descriptor.username,
      message.name || 'unknown',
      message.payload || null
    );
  }

  handleResourceRequest(descriptor, message) {
    let result = null;

    switch (message.action) {
      case 'reserve':
        result = this.reserveResource(message.resourceKey, descriptor.username);
        break;
      case 'release':
        this.releaseResource(message.resourceKey, descriptor.username);
        result = true;
        break;
      case 'is_reserved_by_other':
        result = this.isResourceReservedByOther(message.resourceKey, descriptor.username);
        break;
      default:
        result = false;
        break;
    }

    this.sendWorkerMessage(descriptor, {
      type: 'resource_response',
      requestId: message.requestId,
      result
    }).catch(() => null);
  }

  requestCommand(descriptor, command, args) {
    const requestId = `${descriptor.username}-cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.commandRequests.delete(requestId);
        reject(new Error('command_timeout'));
      }, COMMAND_TIMEOUT_MS);

      this.commandRequests.set(requestId, {
        username: descriptor.username,
        resolve,
        reject,
        timeout
      });

      this.sendWorkerMessage(descriptor, {
        type: 'command',
        requestId,
        command,
        args: args || {}
      }).catch((error) => {
        clearTimeout(timeout);
        this.commandRequests.delete(requestId);
        reject(error);
      });
    });
  }

  resolveCommand(requestId, result) {
    const pending = this.commandRequests.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.commandRequests.delete(requestId);
    pending.resolve(result || { ok: true });
  }

  rejectPendingFor(username, reason) {
    for (const [requestId, pending] of this.commandRequests.entries()) {
      if (pending.username !== username) continue;
      clearTimeout(pending.timeout);
      this.commandRequests.delete(requestId);
      pending.reject(new Error(reason || 'worker_offline'));
    }
  }

  sendWorkerMessage(descriptor, payload) {
    return new Promise((resolve, reject) => {
      if (!descriptor.child || !descriptor.workerOnline || descriptor.child.connected === false) {
        reject(new Error('worker_offline'));
        return;
      }

      try {
        descriptor.child.send(payload);
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  }

  buildArenaArgs(descriptor, command, args) {
    const participantUsernames = normalizeParticipantUsernames(args && args.participantUsernames, this.getUsernames());
    const payload = {
      ...args,
      participantUsernames
    };

    if ((command === 'prepare_round' || command === 'reset_position') && !payload.spawnPoint) {
      const participantIndex = participantUsernames.indexOf(descriptor.username);
      const spawnPoint = resolveSpawnPoint(
        this.config.arena,
        participantIndex >= 0 ? participantIndex : descriptor.index,
        participantUsernames.length
      );
      if (spawnPoint) {
        payload.spawnPoint = spawnPoint;
      }
    }

    return payload;
  }

  reserveResource(resourceKey, owner) {
    const current = this.resourceReservations.get(resourceKey);
    if (current && current !== owner) {
      return false;
    }

    this.resourceReservations.set(resourceKey, owner);
    return true;
  }

  releaseResource(resourceKey, owner) {
    const current = this.resourceReservations.get(resourceKey);
    if (current === owner) {
      this.resourceReservations.delete(resourceKey);
    }
  }

  isResourceReservedByOther(resourceKey, owner) {
    const current = this.resourceReservations.get(resourceKey);
    return !!current && current !== owner;
  }

  getActiveDescriptors() {
    const active = new Set(this.activeUsernames);
    return this.bots.filter((descriptor) => active.has(descriptor.username));
  }
}

function buildUsernames(botConfig) {
  const usernames = [];

  for (let i = 0; i < botConfig.count; i += 1) {
    const numericIndex = botConfig.startIndex + i;
    usernames.push(`${botConfig.prefix}${String(numericIndex).padStart(3, '0')}`);
  }

  return usernames;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cloneRuntimeConfig(config) {
  return {
    bots: { ...config.bots },
    roles: { ...config.roles },
    arena: {
      ...config.arena,
      spawnGrid: config.arena && config.arena.spawnGrid
        ? {
            ...config.arena.spawnGrid
          }
        : null,
      spawnPoints: Array.isArray(config.arena && config.arena.spawnPoints)
        ? config.arena.spawnPoints.map((point) => ({ ...point }))
        : []
    },
    server: { ...config.server },
    navigation: {
      ...config.navigation,
      home: { ...config.navigation.home }
    },
    survival: { ...config.survival },
    stateMachine: { ...config.stateMachine },
    build: { ...config.build },
    tasks: { ...config.tasks },
    reconnect: { ...config.reconnect }
  };
}

function resolveRole(roleConfig, index) {
  if (!roleConfig || !roleConfig.enabled) {
    return 'collector';
  }

  if (index < roleConfig.builderCount) {
    return 'builder';
  }

  return roleConfig.defaultRole || 'collector';
}

function resolveSpawnPoint(arenaConfig, index, totalCount) {
  const points = getArenaSpawnPoints(arenaConfig, totalCount);
  if (!points.length) {
    return null;
  }

  const point = points[index % points.length];
  return {
    x: point.x,
    y: point.y,
    z: point.z
  };
}

function getArenaSpawnPoints(arenaConfig, totalCount) {
  if (!arenaConfig) {
    return [];
  }

  if (Array.isArray(arenaConfig.spawnPoints) && arenaConfig.spawnPoints.length) {
    return arenaConfig.spawnPoints;
  }

  return generateSpawnGrid(arenaConfig.spawnGrid, totalCount);
}

function generateSpawnGrid(spawnGrid, totalCount) {
  if (!spawnGrid || !spawnGrid.enabled) {
    return [];
  }

  const configuredColumns = positiveInteger(spawnGrid.columns) || 1;
  const configuredRows = positiveInteger(spawnGrid.rows) || 1;
  const safeTotalCount = Number.isInteger(totalCount) && totalCount > 0 ? totalCount : (configuredColumns * configuredRows);
  const dynamicByCount = spawnGrid.dynamicByCount !== false;
  const columns = dynamicByCount
    ? Math.max(1, Math.min(configuredColumns, Math.ceil(Math.sqrt(safeTotalCount))))
    : configuredColumns;
  const rows = dynamicByCount
    ? Math.max(1, Math.ceil(safeTotalCount / columns))
    : configuredRows;
  const spacing = Number.isFinite(spawnGrid.spacing) && spawnGrid.spacing > 0
    ? spawnGrid.spacing
    : 8;
  const centerX = Number.isFinite(spawnGrid.centerX) ? spawnGrid.centerX : 0;
  const centerY = Number.isFinite(spawnGrid.y) ? spawnGrid.y : 64;
  const centerZ = Number.isFinite(spawnGrid.centerZ) ? spawnGrid.centerZ : 0;

  const points = [];
  const startX = centerX - ((columns - 1) * spacing) / 2;
  const startZ = centerZ - ((rows - 1) * spacing) / 2;

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      points.push({
        x: roundPoint(startX + (column * spacing)),
        y: roundPoint(centerY),
        z: roundPoint(startZ + (row * spacing))
      });
    }
  }

  return points;
}

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function roundPoint(value) {
  return Math.round(value * 100) / 100;
}

function selectArenaDescriptors(descriptors, participantUsernames) {
  const safeDescriptors = Array.isArray(descriptors) ? descriptors : [];
  const normalized = normalizeParticipantUsernames(
    participantUsernames,
    safeDescriptors.map((descriptor) => descriptor.username)
  );

  if (!normalized.length) {
    return safeDescriptors;
  }

  const descriptorByUsername = new Map(safeDescriptors.map((descriptor) => [descriptor.username, descriptor]));
  return normalized
    .map((username) => descriptorByUsername.get(username))
    .filter(Boolean);
}

function normalizeParticipantUsernames(participantUsernames, knownUsernames) {
  const known = new Set(Array.isArray(knownUsernames) ? knownUsernames : []);
  if (!Array.isArray(participantUsernames) || !participantUsernames.length) {
    return Array.from(known);
  }

  return Array.from(new Set(participantUsernames.filter((username) => known.has(username))));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function throttleWorkerSpawns(spawnedCount, spawnIntervalMs) {
  if (spawnedCount < 1) {
    return;
  }

  const baseDelay = Number.isInteger(spawnIntervalMs) && spawnIntervalMs >= 0 ? spawnIntervalMs : 200;
  let delayMs = baseDelay;

  if (spawnedCount > 60) {
    delayMs += 120;
  } else if (spawnedCount > 30) {
    delayMs += 60;
  }

  if (spawnedCount % 20 === 0) {
    delayMs += 700;
  }

  await delay(delayMs);
}

module.exports = {
  BotManager
};
