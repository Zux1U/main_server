'use strict';

const mineflayer = require('mineflayer');
const { NavigationController } = require('./navigationController');
const { SurvivalController } = require('./survivalController');
const { BehaviorStateMachine } = require('./behaviorStateMachine');
const { TaskManager } = require('./taskManager');
const { BuildController } = require('./buildController');
const { ArenaCombatController } = require('./arenaCombatController');

class BotRuntime {
  constructor(options) {
    this.username = options.username;
    this.role = options.role || 'collector';
    this.server = options.server;
    this.roles = options.roles || {};
    this.arena = options.arena || { enabled: false };
    this.navigation = options.navigation;
    this.survival = options.survival;
    this.build = options.build;
    this.stateMachine = options.stateMachine;
    this.tasks = options.tasks;
    this.reconnect = options.reconnect;
    this.coordination = options.coordination;
    this.logger = options.logger;
    this.stateStore = options.stateStore;
    this.chatOnSpawn = options.chatOnSpawn;
    this.emitEvent = typeof options.emitEvent === 'function' ? options.emitEvent : () => {};
    this.onReady = typeof options.onReady === 'function' ? options.onReady : () => {};

    this.bot = null;
    this.stopped = false;
    this.reconnectAttempts = 0;
    this.hasSpawned = false;
    this.botOptions = null;
    this.navigationController = null;
    this.survivalController = null;
    this.behaviorStateMachine = null;
    this.taskManager = null;
    this.buildController = null;
    this.arenaCombatController = null;
  }

  connect() {
    if (this.stopped) return;

    this.logger.info(`[${this.username}] connect`, {
      host: this.server.host,
      port: this.server.port,
      reconnectAttempt: this.reconnectAttempts,
      mode: this.isArenaMode() ? 'arena' : 'legacy'
    });

    this.stateStore.upsertBotState(this.username, {
      status: 'connecting',
      role: this.role,
      host: this.server.host,
      port: this.server.port,
      reconnectAttempts: this.reconnectAttempts,
      runtimeMode: this.isArenaMode() ? 'arena' : 'legacy',
      lastConnectAt: new Date().toISOString()
    });

    this.botOptions = {
      host: this.server.host,
      port: this.server.port,
      username: this.username,
      auth: this.server.auth,
      version: this.server.version,
      // Keep respawn controllable at runtime so we can recover dead logins,
      // but still disable respawns during active arena rounds.
      respawn: true
    };

    this.bot = mineflayer.createBot(this.botOptions);

    this.navigationController = new NavigationController(this.bot, {
      logger: this.logger,
      stateStore: this.stateStore,
      username: this.username,
      navigation: this.navigation
    });
    this.navigationController.setup();

    if (this.isArenaMode()) {
      this.arenaCombatController = new ArenaCombatController({
        bot: this.bot,
        username: this.username,
        logger: this.logger,
        stateStore: this.stateStore,
        navigationController: this.navigationController,
        arena: this.arena,
        setAutoRespawn: (enabled, reason) => this.setArenaAutoRespawn(enabled, reason),
        emitEvent: (name, payload) => this.emitEvent(name, payload)
      });
      this.arenaCombatController.setup();
    } else {
      this.survivalController = new SurvivalController(this.bot, {
        logger: this.logger,
        stateStore: this.stateStore,
        username: this.username,
        role: this.role,
        roles: this.roles,
        navigationController: this.navigationController,
        survival: this.survival,
        coordination: this.coordination
      });
      this.survivalController.setup();

      this.buildController = new BuildController(this.bot, {
        username: this.username,
        logger: this.logger,
        stateStore: this.stateStore,
        navigationController: this.navigationController,
        build: optionsOrDefault(this.build, {
          enabled: true,
          placeDelayMs: 120,
          flyHeight: 2.5,
          defaultTemplate: 'big_house'
        })
      });

      this.taskManager = new TaskManager({
        username: this.username,
        role: this.role,
        roles: this.roles,
        logger: this.logger,
        stateStore: this.stateStore,
        navigationController: this.navigationController,
        survivalController: this.survivalController,
        buildController: this.buildController,
        tasks: this.tasks,
        survival: this.survival
      });

      this.behaviorStateMachine = new BehaviorStateMachine({
        bot: this.bot,
        username: this.username,
        logger: this.logger,
        stateStore: this.stateStore,
        navigationController: this.navigationController,
        survivalController: this.survivalController,
        taskManager: this.taskManager,
        navigation: this.navigation,
        survival: this.survival,
        tasks: this.tasks,
        stateMachine: this.stateMachine
      });
      this.behaviorStateMachine.setup();
    }

    this.registerEvents();
  }

  registerEvents() {
    this.bot.once('login', () => {
      const loginAt = new Date().toISOString();
      this.logger.info(`[${this.username}] login`);
      this.stateStore.upsertBotState(this.username, {
        status: 'logged_in',
        role: this.role,
        reconnectAttempts: this.reconnectAttempts,
        lastLoginAt: loginAt
      });
      this.emitEvent('logged_in', {
        at: loginAt,
        mode: this.isArenaMode() ? 'arena' : 'legacy'
      });
    });

    this.bot.once('spawn', () => {
      const wasReconnect = this.reconnectAttempts > 0;
      this.hasSpawned = true;
      this.reconnectAttempts = 0;
      this.logger.info(`[${this.username}] spawn`);
      this.persistPosition('spawned');
      this.persistHomePoint();
      this.persistVitals();
      this.stateStore.upsertBotState(this.username, {
        role: this.role,
        lastSpawnAt: new Date().toISOString()
      });
      this.onReady({
        username: this.username,
        mode: this.isArenaMode() ? 'arena' : 'legacy'
      });

      if (!this.isArenaMode()) {
        this.registerChatCommands();
        this.startTaskLoop();
      }

      if (this.chatOnSpawn) {
        this.bot.chat(this.chatOnSpawn);
      }

      if (wasReconnect) {
        this.emitEvent('reconnected', {
          at: new Date().toISOString()
        });
      }
    });

    this.bot.on('move', () => {
      if (!this.bot.entity) return;
      this.persistPosition(this.hasSpawned ? 'active' : 'moving');
    });

    this.bot.on('health', () => {
      this.persistVitals();
    });

    if (!this.isArenaMode()) {
      this.bot.on('navigation_controller_idle', () => {
        if (this.taskManager) {
          this.taskManager.handleNavigationIdle();
        }
      });

      this.bot.on('navigation_controller_failed', (reason) => {
        if (this.taskManager) {
          this.taskManager.handleNavigationFailure(reason);
        }
      });

      this.bot.on('survival_action', (action) => {
        if (this.taskManager) {
          this.taskManager.handleSurvivalAction(action);
        }
      });
    }

    this.bot.on('kicked', (reason) => {
      this.logger.warn(`[${this.username}] kicked`, { reason: formatReason(reason) });
      this.stateStore.upsertBotState(this.username, {
        status: 'kicked',
        lastKickReason: formatReason(reason),
        lastKickAt: new Date().toISOString()
      });
      this.emitEvent('disconnected', {
        reason: formatReason(reason)
      });
    });

    this.bot.on('error', (error) => {
      this.logger.error(`[${this.username}] error`, { message: error.message });
      this.stateStore.upsertBotState(this.username, {
        status: 'error',
        lastError: error.message,
        lastErrorAt: new Date().toISOString()
      });
      this.emitEvent('error', {
        message: error.message
      });
    });

    this.bot.once('end', (reason) => {
      const endReason = reason || 'connection-closed';
      this.logger.warn(`[${this.username}] end`, { reason: endReason });
      this.teardownControllers('disconnected');
      this.stateStore.markBotDisconnected(this.username, endReason);
      this.emitEvent('disconnected', {
        reason: endReason
      });

      if (this.stopped) return;
      if (!this.reconnect.enabled) return;
      if (this.reconnect.maxAttempts > 0 && this.reconnectAttempts >= this.reconnect.maxAttempts) {
        this.logger.warn(`[${this.username}] reconnect limit reached`, {
          maxAttempts: this.reconnect.maxAttempts
        });
        return;
      }

      this.reconnectAttempts += 1;
      const delay = this.reconnect.delayMs;

      this.logger.info(`[${this.username}] reconnect scheduled`, {
        attempt: this.reconnectAttempts,
        delayMs: delay
      });

      setTimeout(() => {
        this.hasSpawned = false;
        this.connect();
      }, delay);
    });
  }

  stop(reason) {
    this.stopped = true;
    this.teardownControllers(reason || 'shutdown');
    if (this.bot) {
      this.bot.end(reason || 'shutdown');
    }
  }

  executeControlCommand(command, args) {
    if (this.isArenaMode()) {
      return this.executeArenaCommand(command, args);
    }

    switch (command) {
      case 'go_to': {
        if (!args || !Number.isFinite(args.x) || !Number.isFinite(args.y) || !Number.isFinite(args.z)) {
          return { ok: false, error: 'invalid_coordinates' };
        }
        this.say(`going to ${args.x} ${args.y} ${args.z}`);
        if (this.behaviorStateMachine) {
          this.behaviorStateMachine.markManualNavigation('go_to');
        }
        this.taskManager.enqueue({ type: 'go_to', priority: 10, payload: args });
        return { ok: true };
      }
      case 'return_home':
        this.say('returning home');
        if (this.behaviorStateMachine) {
          this.behaviorStateMachine.markManualNavigation('return_home');
        }
        this.taskManager.enqueue({ type: 'return_home', priority: 10 });
        return { ok: true };
      case 'stop':
        this.say('stopping');
        this.navigationController.stop('manual-stop');
        if (this.taskManager) {
          this.taskManager.clearQueue('manual-stop');
        }
        if (this.behaviorStateMachine) {
          this.behaviorStateMachine.transition('idle', 'manual-stop');
        }
        return { ok: true };
      case 'start_survival':
        if (this.survivalController) {
          this.survivalController.start();
          this.say('survival started');
        }
        return { ok: true };
      case 'stop_survival':
        if (this.survivalController) {
          this.survivalController.stop('manual-stop');
          if (this.behaviorStateMachine) {
            this.behaviorStateMachine.transition('idle', 'survival-stopped');
          }
          this.say('survival stopped');
        }
        return { ok: true };
      case 'task_collect_wood':
        this.taskManager.enqueue({ type: 'collect_wood', priority: 20 });
        this.say('task collect_wood queued');
        return { ok: true };
      case 'build_big_house': {
        if (this.role !== 'builder') {
          this.say('build is builder-only');
          return { ok: false, error: 'role_not_builder' };
        }
        const origin = args && Number.isFinite(args.x) && Number.isFinite(args.y) && Number.isFinite(args.z)
          ? { x: args.x, y: args.y, z: args.z }
          : null;
        this.taskManager.enqueue({
          type: 'build_template',
          priority: 15,
          payload: {
            template: 'big_house',
            origin
          }
        });
        this.say('build big_house queued');
        return { ok: true };
      }
      default:
        return { ok: false, error: 'unknown_command' };
    }
  }

  executeArenaCommand(command, args) {
    if (!this.arenaCombatController) {
      return { ok: false, error: 'arena_runtime_not_ready' };
    }

    switch (command) {
      case 'prepare_round':
        return this.arenaCombatController.prepareRound(args || {});
      case 'start_round':
        return this.arenaCombatController.startRound(args || {});
      case 'stop_round':
        return this.arenaCombatController.stopRound(args || {});
      case 'reset_position':
        return this.arenaCombatController.resetPosition(args || {});
      case 'shutdown':
        this.stop('arena-shutdown');
        return { ok: true };
      default:
        return { ok: false, error: 'command_not_allowed_in_arena_mode' };
    }
  }

  setArenaAutoRespawn(enabled, reason) {
    if (!this.isArenaMode() || !this.botOptions) {
      return;
    }

    const nextValue = !!enabled;
    if (this.botOptions.respawn === nextValue) {
      return;
    }

    this.botOptions.respawn = nextValue;
    this.logger.info(`[${this.username}] arena auto respawn ${nextValue ? 'enabled' : 'disabled'}`, {
      reason: reason || 'unspecified'
    });
    this.stateStore.upsertBotState(this.username, {
      arenaRuntime: {
        autoRespawn: nextValue,
        autoRespawnReason: reason || 'unspecified',
        updatedAt: new Date().toISOString()
      }
    });
  }

  teardownControllers(reason) {
    if (this.navigationController) {
      this.navigationController.stop(reason);
    }
    if (this.survivalController) {
      this.survivalController.stop(reason);
    }
    if (this.behaviorStateMachine) {
      this.behaviorStateMachine.stop(reason);
    }
    if (this.taskManager) {
      this.taskManager.clearQueue(reason);
    }
    if (this.arenaCombatController) {
      this.arenaCombatController.stop(reason);
    }
  }

  isArenaMode() {
    return !!(this.arena && this.arena.enabled);
  }

  startTaskLoop() {
    if (!this.taskManager) return;
    this.bot.on('physicsTick', () => {
      this.taskManager.tick();
    });
  }

  persistPosition(status) {
    if (!this.bot || !this.bot.entity || !this.bot.entity.position) return;

    const pos = this.bot.entity.position;
    this.stateStore.upsertBotState(this.username, {
      status,
      lastSeenAt: new Date().toISOString(),
      position: {
        x: round(pos.x),
        y: round(pos.y),
        z: round(pos.z)
      }
    });
  }

  persistHomePoint() {
    if (!this.navigation.home.enabled) {
      if (!this.bot || !this.bot.entity) return;
      const pos = this.bot.entity.position;
      this.navigation.home.x = round(pos.x);
      this.navigation.home.y = round(pos.y);
      this.navigation.home.z = round(pos.z);
      this.navigation.home.enabled = true;
      this.logger.info(`[${this.username}] home initialized from spawn`, this.navigation.home);
    }

    this.stateStore.upsertBotState(this.username, {
      home: {
        x: this.navigation.home.x,
        y: this.navigation.home.y,
        z: this.navigation.home.z
      }
    });
  }

  persistVitals() {
    this.stateStore.upsertBotState(this.username, {
      vitals: {
        health: toFiniteNumber(this.bot && this.bot.health),
        food: toFiniteNumber(this.bot && this.bot.food),
        alive: this.bot ? !!this.bot.isAlive : false,
        updatedAt: new Date().toISOString()
      }
    });
  }

  registerChatCommands() {
    this.bot.on('chat', (sender, message) => {
      if (sender === this.username) return;

      const command = message.trim();
      const isDirect = command.startsWith(`${this.username} `);
      const isBroadcast = command.startsWith('all ');

      if (!isDirect && !isBroadcast) return;

      const payload = isDirect
        ? command.slice(`${this.username} `.length)
        : command.slice('all '.length);

      if (payload === 'start_survival') {
        this.executeControlCommand('start_survival');
        return;
      }

      if (payload === 'stop_survival') {
        this.executeControlCommand('stop_survival');
        return;
      }

      if (payload === 'return_home') {
        this.executeControlCommand('return_home');
        return;
      }

      if (payload === 'follow me') {
        this.say(`following ${sender}`);
        this.behaviorStateMachine.markManualNavigation('follow_player');
        this.navigationController.followPlayer(sender);
        return;
      }

      if (payload.startsWith('go_to ')) {
        const coords = parseCoordinates(payload.slice('go_to '.length));
        if (!coords) {
          this.logger.warn(`[${this.username}] invalid go_to command`, { message: command });
          this.say('invalid go_to command');
          return;
        }

        this.executeControlCommand('go_to', coords);
        return;
      }

      if (payload === 'stop') {
        this.executeControlCommand('stop');
        return;
      }

      if (payload === 'set_home') {
        if (!this.bot.entity) return;

        const pos = this.bot.entity.position;
        this.navigation.home.x = round(pos.x);
        this.navigation.home.y = round(pos.y);
        this.navigation.home.z = round(pos.z);
        this.navigation.home.enabled = true;
        this.persistHomePoint();

        this.logger.info(`[${this.username}] home updated`, this.navigation.home);
        this.say(`home set to ${this.navigation.home.x} ${this.navigation.home.y} ${this.navigation.home.z}`);
        return;
      }

      if (payload === 'where_are_you') {
        this.persistPosition('reporting');
        if (this.bot.entity && this.bot.entity.position) {
          const pos = this.bot.entity.position;
          this.say(`at ${round(pos.x)} ${round(pos.y)} ${round(pos.z)}`);
        }
      }

      if (payload === 'help') {
        this.logger.info(`[${this.username}] available commands`, {
          commands: [
            `${this.username} go_to <x> <y> <z>`,
            `${this.username} follow me`,
            `${this.username} return_home`,
            `${this.username} set_home`,
            `${this.username} stop`,
            `${this.username} where_are_you`,
            `${this.username} survival start`,
            `${this.username} survival stop`,
            `${this.username} survival status`
          ]
        });
        this.say('commands: go_to, follow me, return_home, set_home, stop, where_are_you, survival start/stop/status');
      }

      if (payload === 'survival start') {
        this.executeControlCommand('start_survival');
      }

      if (payload === 'survival stop') {
        this.executeControlCommand('stop_survival');
      }

      if (payload === 'survival status') {
        const state = this.stateStore.getBotState(this.username);
        const action = state && state.survival ? state.survival.lastAction : 'unknown';
        const aiState = state && state.ai ? state.ai.state : 'unknown';
        const currentTask = state && state.tasks && state.tasks.currentTask ? state.tasks.currentTask.type : 'none';
        this.say(`role ${this.role}, survival ${action}, ai ${aiState}, task ${currentTask}`);
      }

      if (payload === 'task status') {
        const state = this.stateStore.getBotState(this.username);
        const currentTask = state && state.tasks && state.tasks.currentTask ? state.tasks.currentTask.type : 'none';
        const queueSize = state && state.tasks && state.tasks.queue ? state.tasks.queue.length : 0;
        this.say(`role ${this.role}, task ${currentTask}, queue ${queueSize}`);
      }

      if (payload === 'task collect_wood') {
        this.executeControlCommand('task_collect_wood');
      }

      if (payload === 'build big_house') {
        this.executeControlCommand('build_big_house');
      }
    });
  }

  say(message) {
    if (!this.bot || typeof this.bot.chat !== 'function') return;
    this.bot.chat(message);
  }
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function formatReason(reason) {
  if (typeof reason === 'string') return reason;

  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function parseCoordinates(raw) {
  const parts = raw.split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some((value) => !Number.isFinite(value))) {
    return null;
  }

  return {
    x: parts[0],
    y: parts[1],
    z: parts[2]
  };
}

function optionsOrDefault(value, fallback) {
  return value || fallback;
}

module.exports = {
  BotRuntime
};
