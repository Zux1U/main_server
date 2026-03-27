'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const defaultConfigPath = path.join(projectRoot, 'config.default.json');

function loadConfig() {
  const explicitPath = process.env.MCB_CONFIG;
  const configPath = explicitPath ? path.resolve(explicitPath) : defaultConfigPath;
  const raw = fs.readFileSync(configPath, 'utf8');
  const parsed = JSON.parse(raw);

  const config = {
    ...parsed,
    server: { ...parsed.server },
    rcon: { ...parsed.rcon },
    bots: {
      ...parsed.bots,
      maxCount: Number.isInteger(parsed.bots && parsed.bots.maxCount)
        ? parsed.bots.maxCount
        : (parsed.bots && parsed.bots.count),
      safeScaleLimit: Number.isInteger(parsed.bots && parsed.bots.safeScaleLimit)
        ? parsed.bots.safeScaleLimit
        : 120,
      startOnBoot: parsed.bots && typeof parsed.bots.startOnBoot === 'boolean'
        ? parsed.bots.startOnBoot
        : true
    },
    roles: { ...parsed.roles },
    arena: {
      ...(parsed.arena || {}),
      loginRecoveryEnabled: parsed.arena && typeof parsed.arena.loginRecoveryEnabled === 'boolean'
        ? parsed.arena.loginRecoveryEnabled
        : true,
      holdingZone: parsed.arena && parsed.arena.holdingZone
        ? { ...parsed.arena.holdingZone }
        : null,
      runtimeDatapack: parsed.arena && parsed.arena.runtimeDatapack
        ? { ...parsed.arena.runtimeDatapack }
        : null,
      spawnGrid: parsed.arena && parsed.arena.spawnGrid
        ? { ...parsed.arena.spawnGrid }
        : null,
      serverControl: {
        enabled: !!(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.enabled),
        bootstrapCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.bootstrapCommands),
        sharedPrepareCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.sharedPrepareCommands),
        sharedParticipantPrepareCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.sharedParticipantPrepareCommands),
        perBotPrepareCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.perBotPrepareCommands),
        perBotLoadoutCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.perBotLoadoutCommands),
        perHumanPrepareCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.perHumanPrepareCommands),
        perHumanLoadoutCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.perHumanLoadoutCommands),
        sharedStartCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.sharedStartCommands),
        perBotStartCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.perBotStartCommands),
        perHumanStartCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.perHumanStartCommands),
        sharedStopCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.sharedStopCommands),
        perBotStopCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.perBotStopCommands),
        perHumanStopCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.perHumanStopCommands),
        perBotEliminatedCommands: arrayClone(parsed.arena && parsed.arena.serverControl && parsed.arena.serverControl.perBotEliminatedCommands)
      },
      spawnPoints: Array.isArray(parsed.arena && parsed.arena.spawnPoints)
        ? parsed.arena.spawnPoints.map((point) => ({ ...point }))
        : []
    },
    navigation: {
      ...parsed.navigation,
      home: { ...(parsed.navigation && parsed.navigation.home) }
    },
    survival: { ...parsed.survival },
    stateMachine: { ...parsed.stateMachine },
    tasks: { ...parsed.tasks },
    web: { ...parsed.web },
    build: { ...parsed.build },
    reconnect: { ...parsed.reconnect },
    logging: { ...parsed.logging },
    storage: { ...parsed.storage }
  };

  applyEnvOverrides(config);

  config._meta = {
    projectRoot,
    configPath
  };

  return config;
}

function applyEnvOverrides(config) {
  if (process.env.MCB_HOST) config.server.host = process.env.MCB_HOST;
  if (process.env.MCB_PORT) config.server.port = parseInt(process.env.MCB_PORT, 10);
  if (process.env.MCB_VERSION) config.server.version = process.env.MCB_VERSION;
  if (process.env.MCB_AUTH) config.server.auth = process.env.MCB_AUTH;

  if (process.env.MCB_RCON_ENABLED) config.rcon.enabled = parseBool(process.env.MCB_RCON_ENABLED);
  if (process.env.MCB_RCON_HOST) config.rcon.host = process.env.MCB_RCON_HOST;
  if (process.env.MCB_RCON_PORT) config.rcon.port = parseInt(process.env.MCB_RCON_PORT, 10);
  if (process.env.MCB_RCON_PASSWORD) config.rcon.password = process.env.MCB_RCON_PASSWORD;
  if (process.env.MCB_RCON_TIMEOUT_MS) config.rcon.timeoutMs = parseInt(process.env.MCB_RCON_TIMEOUT_MS, 10);

  if (process.env.MCB_BOT_COUNT) config.bots.count = parseInt(process.env.MCB_BOT_COUNT, 10);
  if (process.env.MCB_BOT_MAX_COUNT) config.bots.maxCount = parseInt(process.env.MCB_BOT_MAX_COUNT, 10);
  if (process.env.MCB_BOT_SAFE_SCALE_LIMIT) config.bots.safeScaleLimit = parseInt(process.env.MCB_BOT_SAFE_SCALE_LIMIT, 10);
  if (process.env.MCB_BOT_START_ON_BOOT) config.bots.startOnBoot = parseBool(process.env.MCB_BOT_START_ON_BOOT);
  if (process.env.MCB_BOT_PREFIX) config.bots.prefix = process.env.MCB_BOT_PREFIX;
  if (process.env.MCB_BOT_START_INDEX) config.bots.startIndex = parseInt(process.env.MCB_BOT_START_INDEX, 10);
  if (process.env.MCB_BOT_SPAWN_INTERVAL_MS) config.bots.spawnIntervalMs = parseInt(process.env.MCB_BOT_SPAWN_INTERVAL_MS, 10);
  if (process.env.MCB_CHAT_ON_SPAWN !== undefined) config.bots.chatOnSpawn = process.env.MCB_CHAT_ON_SPAWN;

  if (process.env.MCB_ROLES_ENABLED) config.roles.enabled = parseBool(process.env.MCB_ROLES_ENABLED);
  if (process.env.MCB_DEFAULT_ROLE) config.roles.defaultRole = process.env.MCB_DEFAULT_ROLE;
  if (process.env.MCB_BUILDER_COUNT) config.roles.builderCount = parseInt(process.env.MCB_BUILDER_COUNT, 10);
  if (process.env.MCB_COLLECTOR_WOOD_GOAL) config.roles.collectorWoodGoal = parseInt(process.env.MCB_COLLECTOR_WOOD_GOAL, 10);

  if (process.env.MCB_ARENA_ENABLED) config.arena.enabled = parseBool(process.env.MCB_ARENA_ENABLED);
  if (process.env.MCB_ARENA_HEARTBEAT_MS) config.arena.heartbeatIntervalMs = parseInt(process.env.MCB_ARENA_HEARTBEAT_MS, 10);
  if (process.env.MCB_ARENA_TICK_MS) config.arena.tickIntervalMs = parseInt(process.env.MCB_ARENA_TICK_MS, 10);
  if (process.env.MCB_ARENA_WINNER_CHECK_MS) config.arena.winnerCheckIntervalMs = parseInt(process.env.MCB_ARENA_WINNER_CHECK_MS, 10);
  if (process.env.MCB_ARENA_AUTO_RESTART_ROUNDS) config.arena.autoRestartRounds = parseBool(process.env.MCB_ARENA_AUTO_RESTART_ROUNDS);
  if (process.env.MCB_ARENA_AUTO_PREPARE_DELAY_MS) config.arena.autoPrepareDelayMs = parseInt(process.env.MCB_ARENA_AUTO_PREPARE_DELAY_MS, 10);
  if (process.env.MCB_ARENA_AUTO_START_DELAY_MS) config.arena.autoStartDelayMs = parseInt(process.env.MCB_ARENA_AUTO_START_DELAY_MS, 10);
  if (process.env.MCB_ARENA_LAUNCH_START_DELAY_MS) config.arena.launchStartDelayMs = parseInt(process.env.MCB_ARENA_LAUNCH_START_DELAY_MS, 10);
  if (process.env.MCB_ARENA_POST_ROUND_DELAY_MS) config.arena.postRoundDelayMs = parseInt(process.env.MCB_ARENA_POST_ROUND_DELAY_MS, 10);
  if (process.env.MCB_ARENA_SEARCH_RADIUS) config.arena.searchRadius = parseInt(process.env.MCB_ARENA_SEARCH_RADIUS, 10);
  if (process.env.MCB_ARENA_ATTACK_RANGE) config.arena.attackRange = parseFloat(process.env.MCB_ARENA_ATTACK_RANGE);
  if (process.env.MCB_ARENA_PREFERRED_ATTACK_DISTANCE) config.arena.preferredAttackDistance = parseFloat(process.env.MCB_ARENA_PREFERRED_ATTACK_DISTANCE);
  if (process.env.MCB_ARENA_CHASE_DISTANCE) config.arena.chaseDistance = parseFloat(process.env.MCB_ARENA_CHASE_DISTANCE);
  if (process.env.MCB_ARENA_ATTACK_COOLDOWN_MS) config.arena.attackCooldownMs = parseInt(process.env.MCB_ARENA_ATTACK_COOLDOWN_MS, 10);
  if (process.env.MCB_ARENA_TARGET_SWITCH_COOLDOWN_MS) config.arena.targetSwitchCooldownMs = parseInt(process.env.MCB_ARENA_TARGET_SWITCH_COOLDOWN_MS, 10);
  if (process.env.MCB_ARENA_HEAL_THRESHOLD) config.arena.healThreshold = parseInt(process.env.MCB_ARENA_HEAL_THRESHOLD, 10);
  if (process.env.MCB_ARENA_RETREAT_TO_SPAWN) config.arena.retreatToSpawn = parseBool(process.env.MCB_ARENA_RETREAT_TO_SPAWN);
  if (process.env.MCB_ARENA_RETREAT_WITHOUT_FOOD) config.arena.retreatWithoutFood = parseBool(process.env.MCB_ARENA_RETREAT_WITHOUT_FOOD);
  if (process.env.MCB_ARENA_STRAFE_ENABLED) config.arena.strafeEnabled = parseBool(process.env.MCB_ARENA_STRAFE_ENABLED);
  if (process.env.MCB_ARENA_STRAFE_SWAP_MS) config.arena.strafeSwapIntervalMs = parseInt(process.env.MCB_ARENA_STRAFE_SWAP_MS, 10);
  if (process.env.MCB_ARENA_JUMP_INTERVAL_MS) config.arena.jumpIntervalMs = parseInt(process.env.MCB_ARENA_JUMP_INTERVAL_MS, 10);
  if (process.env.MCB_ARENA_JUMP_CHANCE) config.arena.jumpChance = parseFloat(process.env.MCB_ARENA_JUMP_CHANCE);
  if (process.env.MCB_ARENA_AUTO_PREPARE_ON_SPAWN) config.arena.autoPrepareOnSpawn = parseBool(process.env.MCB_ARENA_AUTO_PREPARE_ON_SPAWN);
  if (process.env.MCB_ARENA_LOGIN_RECOVERY_ENABLED) config.arena.loginRecoveryEnabled = parseBool(process.env.MCB_ARENA_LOGIN_RECOVERY_ENABLED);
  if (process.env.MCB_ARENA_TARGET_PLAYERS_ONLY) config.arena.targetPlayersOnly = parseBool(process.env.MCB_ARENA_TARGET_PLAYERS_ONLY);
  if (process.env.MCB_ARENA_SERVER_CONTROL_ENABLED) config.arena.serverControl.enabled = parseBool(process.env.MCB_ARENA_SERVER_CONTROL_ENABLED);

  if (process.env.MCB_FOLLOW_DISTANCE) config.navigation.followDistance = parseInt(process.env.MCB_FOLLOW_DISTANCE, 10);
  if (process.env.MCB_GOAL_TIMEOUT_MS) config.navigation.goalReachTimeoutMs = parseInt(process.env.MCB_GOAL_TIMEOUT_MS, 10);
  if (process.env.MCB_STUCK_TIMEOUT_MS) config.navigation.stuckTimeoutMs = parseInt(process.env.MCB_STUCK_TIMEOUT_MS, 10);
  if (process.env.MCB_PROGRESS_MIN_DISTANCE) config.navigation.progressMinDistance = parseFloat(process.env.MCB_PROGRESS_MIN_DISTANCE);
  if (process.env.MCB_MAX_RECOVERY_ATTEMPTS) config.navigation.maxRecoveryAttempts = parseInt(process.env.MCB_MAX_RECOVERY_ATTEMPTS, 10);
  if (process.env.MCB_REPATH_COOLDOWN_MS) config.navigation.repathCooldownMs = parseInt(process.env.MCB_REPATH_COOLDOWN_MS, 10);
  if (process.env.MCB_ALLOW_DIG) config.navigation.allowDig = parseBool(process.env.MCB_ALLOW_DIG);
  if (process.env.MCB_HOME_ENABLED) config.navigation.home.enabled = parseBool(process.env.MCB_HOME_ENABLED);
  if (process.env.MCB_HOME_X) config.navigation.home.x = parseFloat(process.env.MCB_HOME_X);
  if (process.env.MCB_HOME_Y) config.navigation.home.y = parseFloat(process.env.MCB_HOME_Y);
  if (process.env.MCB_HOME_Z) config.navigation.home.z = parseFloat(process.env.MCB_HOME_Z);

  if (process.env.MCB_SURVIVAL_ENABLED) config.survival.enabled = parseBool(process.env.MCB_SURVIVAL_ENABLED);
  if (process.env.MCB_SURVIVAL_AUTOSTART) config.survival.autoStart = parseBool(process.env.MCB_SURVIVAL_AUTOSTART);
  if (process.env.MCB_SURVIVAL_TICK_MS) config.survival.tickIntervalMs = parseInt(process.env.MCB_SURVIVAL_TICK_MS, 10);
  if (process.env.MCB_FOOD_THRESHOLD) config.survival.foodThreshold = parseInt(process.env.MCB_FOOD_THRESHOLD, 10);
  if (process.env.MCB_SEARCH_RADIUS) config.survival.searchRadius = parseInt(process.env.MCB_SEARCH_RADIUS, 10);
  if (process.env.MCB_DROPS_RADIUS) config.survival.collectDropsRadius = parseInt(process.env.MCB_DROPS_RADIUS, 10);
  if (process.env.MCB_WOOD_GOAL) config.survival.woodGoal = parseInt(process.env.MCB_WOOD_GOAL, 10);
  if (process.env.MCB_PLANKS_GOAL) config.survival.planksGoal = parseInt(process.env.MCB_PLANKS_GOAL, 10);
  if (process.env.MCB_STICKS_GOAL) config.survival.sticksGoal = parseInt(process.env.MCB_STICKS_GOAL, 10);
  if (process.env.MCB_CRAFTING_TABLE_GOAL) config.survival.craftingTableGoal = parseInt(process.env.MCB_CRAFTING_TABLE_GOAL, 10);
  if (process.env.MCB_WOODEN_PICKAXE_GOAL) config.survival.woodenPickaxeGoal = parseInt(process.env.MCB_WOODEN_PICKAXE_GOAL, 10);
  if (process.env.MCB_RETREAT_HEALTH) config.survival.retreatHealthThreshold = parseInt(process.env.MCB_RETREAT_HEALTH, 10);
  if (process.env.MCB_RETREAT_COOLDOWN_MS) config.survival.retreatCooldownMs = parseInt(process.env.MCB_RETREAT_COOLDOWN_MS, 10);

  if (process.env.MCB_FSM_ENABLED) config.stateMachine.enabled = parseBool(process.env.MCB_FSM_ENABLED);
  if (process.env.MCB_FSM_TICK_MS) config.stateMachine.tickIntervalMs = parseInt(process.env.MCB_FSM_TICK_MS, 10);
  if (process.env.MCB_FSM_IDLE_GRACE_MS) config.stateMachine.idleGraceMs = parseInt(process.env.MCB_FSM_IDLE_GRACE_MS, 10);

  if (process.env.MCB_TASKS_ENABLED) config.tasks.enabled = parseBool(process.env.MCB_TASKS_ENABLED);
  if (process.env.MCB_AUTO_SURVIVAL_TASKS) config.tasks.autoSurvivalTasks = parseBool(process.env.MCB_AUTO_SURVIVAL_TASKS);
  if (process.env.MCB_TASK_MAX_QUEUE) config.tasks.maxQueueSize = parseInt(process.env.MCB_TASK_MAX_QUEUE, 10);
  if (process.env.MCB_TASK_RETRY_FAILED) config.tasks.retryFailedTasks = parseBool(process.env.MCB_TASK_RETRY_FAILED);
  if (process.env.MCB_TASK_MAX_RETRIES) config.tasks.maxRetries = parseInt(process.env.MCB_TASK_MAX_RETRIES, 10);
  if (process.env.MCB_TASK_FAILURE_COOLDOWN_MS) config.tasks.failureCooldownMs = parseInt(process.env.MCB_TASK_FAILURE_COOLDOWN_MS, 10);
  if (process.env.MCB_TASK_TIMEOUT_MS) config.tasks.taskTimeoutMs = parseInt(process.env.MCB_TASK_TIMEOUT_MS, 10);

  if (process.env.MCB_WEB_ENABLED) config.web.enabled = parseBool(process.env.MCB_WEB_ENABLED);
  if (process.env.MCB_WEB_HOST) config.web.host = process.env.MCB_WEB_HOST;
  if (process.env.MCB_WEB_PORT) config.web.port = parseInt(process.env.MCB_WEB_PORT, 10);

  if (process.env.MCB_BUILD_ENABLED) config.build.enabled = parseBool(process.env.MCB_BUILD_ENABLED);
  if (process.env.MCB_BUILD_PLACE_DELAY_MS) config.build.placeDelayMs = parseInt(process.env.MCB_BUILD_PLACE_DELAY_MS, 10);
  if (process.env.MCB_BUILD_FLY_HEIGHT) config.build.flyHeight = parseFloat(process.env.MCB_BUILD_FLY_HEIGHT);
  if (process.env.MCB_BUILD_TEMPLATE) config.build.defaultTemplate = process.env.MCB_BUILD_TEMPLATE;

  if (process.env.MCB_RECONNECT_ENABLED) config.reconnect.enabled = parseBool(process.env.MCB_RECONNECT_ENABLED);
  if (process.env.MCB_RECONNECT_DELAY_MS) config.reconnect.delayMs = parseInt(process.env.MCB_RECONNECT_DELAY_MS, 10);
  if (process.env.MCB_RECONNECT_MAX_ATTEMPTS) config.reconnect.maxAttempts = parseInt(process.env.MCB_RECONNECT_MAX_ATTEMPTS, 10);

  if (process.env.MCB_STORAGE_FILE) config.storage.file = process.env.MCB_STORAGE_FILE;
  if (process.env.MCB_LOG_DIR) config.logging.directory = process.env.MCB_LOG_DIR;

  validateConfig(config);
}

function validateConfig(config) {
  if (!Number.isInteger(config.server.port) || config.server.port < 1) {
    throw new Error('server.port must be a positive integer');
  }

  if (!Number.isInteger(config.rcon.port) || config.rcon.port < 1) {
    throw new Error('rcon.port must be a positive integer');
  }

  if (!Number.isInteger(config.rcon.timeoutMs) || config.rcon.timeoutMs < 1000) {
    throw new Error('rcon.timeoutMs must be >= 1000');
  }

  if (!Number.isInteger(config.bots.count) || config.bots.count < 1) {
    throw new Error('bots.count must be a positive integer');
  }

  if (!Number.isInteger(config.bots.maxCount) || config.bots.maxCount < 1) {
    throw new Error('bots.maxCount must be a positive integer');
  }

  if (config.bots.maxCount < config.bots.count) {
    throw new Error('bots.maxCount must be >= bots.count');
  }

  if (!Number.isInteger(config.bots.safeScaleLimit) || config.bots.safeScaleLimit < 1) {
    throw new Error('bots.safeScaleLimit must be a positive integer');
  }

  if (typeof config.bots.startOnBoot !== 'boolean') {
    throw new Error('bots.startOnBoot must be a boolean');
  }

  if (!Number.isInteger(config.bots.startIndex) || config.bots.startIndex < 1) {
    throw new Error('bots.startIndex must be a positive integer');
  }

  if (!Number.isInteger(config.bots.spawnIntervalMs) || config.bots.spawnIntervalMs < 0) {
    throw new Error('bots.spawnIntervalMs must be >= 0');
  }

  if (!['collector', 'builder'].includes(config.roles.defaultRole)) {
    throw new Error('roles.defaultRole must be collector or builder');
  }

  if (!Number.isInteger(config.roles.builderCount) || config.roles.builderCount < 0) {
    throw new Error('roles.builderCount must be >= 0');
  }

  if (!Number.isInteger(config.roles.collectorWoodGoal) || config.roles.collectorWoodGoal < 0) {
    throw new Error('roles.collectorWoodGoal must be >= 0');
  }

  if (!Number.isInteger(config.arena.heartbeatIntervalMs) || config.arena.heartbeatIntervalMs < 1000) {
    throw new Error('arena.heartbeatIntervalMs must be >= 1000');
  }

  if (!Number.isInteger(config.arena.tickIntervalMs) || config.arena.tickIntervalMs < 100) {
    throw new Error('arena.tickIntervalMs must be >= 100');
  }

  if (!Number.isInteger(config.arena.winnerCheckIntervalMs) || config.arena.winnerCheckIntervalMs < 100) {
    throw new Error('arena.winnerCheckIntervalMs must be >= 100');
  }

  if (!Number.isInteger(config.arena.autoPrepareDelayMs) || config.arena.autoPrepareDelayMs < 0) {
    throw new Error('arena.autoPrepareDelayMs must be >= 0');
  }

  if (!Number.isInteger(config.arena.autoStartDelayMs) || config.arena.autoStartDelayMs < 0) {
    throw new Error('arena.autoStartDelayMs must be >= 0');
  }

  if (!Number.isInteger(config.arena.launchStartDelayMs) || config.arena.launchStartDelayMs < 0) {
    throw new Error('arena.launchStartDelayMs must be >= 0');
  }

  if (!Number.isInteger(config.arena.postRoundDelayMs) || config.arena.postRoundDelayMs < 0) {
    throw new Error('arena.postRoundDelayMs must be >= 0');
  }

  if (!Number.isInteger(config.arena.searchRadius) || config.arena.searchRadius < 1) {
    throw new Error('arena.searchRadius must be >= 1');
  }

  if (!Number.isFinite(config.arena.attackRange) || config.arena.attackRange <= 0) {
    throw new Error('arena.attackRange must be > 0');
  }

  if (!Number.isFinite(config.arena.preferredAttackDistance) || config.arena.preferredAttackDistance <= 0) {
    throw new Error('arena.preferredAttackDistance must be > 0');
  }

  if (!Number.isFinite(config.arena.chaseDistance) || config.arena.chaseDistance <= 0) {
    throw new Error('arena.chaseDistance must be > 0');
  }

  if (!Number.isInteger(config.arena.attackCooldownMs) || config.arena.attackCooldownMs < 100) {
    throw new Error('arena.attackCooldownMs must be >= 100');
  }

  if (!Number.isInteger(config.arena.targetSwitchCooldownMs) || config.arena.targetSwitchCooldownMs < 0) {
    throw new Error('arena.targetSwitchCooldownMs must be >= 0');
  }

  if (!Number.isInteger(config.arena.healThreshold) || config.arena.healThreshold < 0) {
    throw new Error('arena.healThreshold must be >= 0');
  }

  if (!Number.isInteger(config.arena.strafeSwapIntervalMs) || config.arena.strafeSwapIntervalMs < 100) {
    throw new Error('arena.strafeSwapIntervalMs must be >= 100');
  }

  if (!Number.isInteger(config.arena.jumpIntervalMs) || config.arena.jumpIntervalMs < 100) {
    throw new Error('arena.jumpIntervalMs must be >= 100');
  }

  if (typeof config.arena.loginRecoveryEnabled !== 'boolean') {
    throw new Error('arena.loginRecoveryEnabled must be a boolean');
  }

  if (!Number.isFinite(config.arena.jumpChance) || config.arena.jumpChance < 0 || config.arena.jumpChance > 1) {
    throw new Error('arena.jumpChance must be between 0 and 1');
  }

  if (!Array.isArray(config.arena.spawnPoints)) {
    throw new Error('arena.spawnPoints must be an array');
  }

  for (const point of config.arena.spawnPoints) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.z)) {
      throw new Error('arena.spawnPoints must contain numeric x/y/z coordinates');
    }
  }

  if (config.arena.spawnGrid) {
    for (const key of ['centerX', 'centerZ', 'y', 'spacing']) {
      if (!Number.isFinite(config.arena.spawnGrid[key])) {
        throw new Error(`arena.spawnGrid.${key} must be a number`);
      }
    }

    for (const key of ['columns', 'rows']) {
      if (!Number.isInteger(config.arena.spawnGrid[key]) || config.arena.spawnGrid[key] < 1) {
        throw new Error(`arena.spawnGrid.${key} must be >= 1`);
      }
    }
  }

  if (config.arena.holdingZone) {
    for (const key of ['x', 'y', 'z']) {
      if (!Number.isFinite(config.arena.holdingZone[key])) {
        throw new Error(`arena.holdingZone.${key} must be a number`);
      }
    }
  }

  if (config.arena.runtimeDatapack) {
    if (typeof config.arena.runtimeDatapack.enabled !== 'boolean') {
      throw new Error('arena.runtimeDatapack.enabled must be a boolean');
    }
    if (typeof config.arena.runtimeDatapack.path !== 'string' || !config.arena.runtimeDatapack.path.trim()) {
      throw new Error('arena.runtimeDatapack.path must be a non-empty string');
    }
    if (typeof config.arena.runtimeDatapack.namespace !== 'string' || !config.arena.runtimeDatapack.namespace.trim()) {
      throw new Error('arena.runtimeDatapack.namespace must be a non-empty string');
    }
  }

  for (const key of [
    'sharedPrepareCommands',
    'sharedParticipantPrepareCommands',
    'perBotPrepareCommands',
    'perBotLoadoutCommands',
    'perHumanPrepareCommands',
    'perHumanLoadoutCommands',
    'sharedStartCommands',
    'perBotStartCommands',
    'perHumanStartCommands',
    'sharedStopCommands',
    'perBotStopCommands',
    'perHumanStopCommands',
    'perBotEliminatedCommands'
  ]) {
    if (!Array.isArray(config.arena.serverControl[key])) {
      throw new Error(`arena.serverControl.${key} must be an array`);
    }
    if (config.arena.serverControl[key].some((value) => typeof value !== 'string')) {
      throw new Error(`arena.serverControl.${key} must contain only strings`);
    }
  }

  if (!Number.isFinite(config.navigation.followDistance) || config.navigation.followDistance < 1) {
    throw new Error('navigation.followDistance must be >= 1');
  }

  if (!Number.isInteger(config.navigation.goalReachTimeoutMs) || config.navigation.goalReachTimeoutMs < 1000) {
    throw new Error('navigation.goalReachTimeoutMs must be >= 1000');
  }

  if (!Number.isInteger(config.navigation.stuckTimeoutMs) || config.navigation.stuckTimeoutMs < 1000) {
    throw new Error('navigation.stuckTimeoutMs must be >= 1000');
  }

  if (!Number.isFinite(config.navigation.progressMinDistance) || config.navigation.progressMinDistance <= 0) {
    throw new Error('navigation.progressMinDistance must be > 0');
  }

  if (!Number.isInteger(config.navigation.maxRecoveryAttempts) || config.navigation.maxRecoveryAttempts < 0) {
    throw new Error('navigation.maxRecoveryAttempts must be >= 0');
  }

  if (!Number.isInteger(config.navigation.repathCooldownMs) || config.navigation.repathCooldownMs < 0) {
    throw new Error('navigation.repathCooldownMs must be >= 0');
  }

  if (!Number.isFinite(config.navigation.home.x) || !Number.isFinite(config.navigation.home.y) || !Number.isFinite(config.navigation.home.z)) {
    throw new Error('navigation.home coordinates must be numbers');
  }

  if (!Number.isInteger(config.survival.tickIntervalMs) || config.survival.tickIntervalMs < 1000) {
    throw new Error('survival.tickIntervalMs must be >= 1000');
  }

  for (const key of [
    'foodThreshold',
    'searchRadius',
    'collectDropsRadius',
    'woodGoal',
    'planksGoal',
    'sticksGoal',
    'craftingTableGoal',
    'woodenPickaxeGoal',
    'retreatHealthThreshold',
    'retreatCooldownMs'
  ]) {
    if (!Number.isInteger(config.survival[key]) || config.survival[key] < 0) {
      throw new Error(`survival.${key} must be a non-negative integer`);
    }
  }

  if (!Number.isInteger(config.stateMachine.tickIntervalMs) || config.stateMachine.tickIntervalMs < 500) {
    throw new Error('stateMachine.tickIntervalMs must be >= 500');
  }

  if (!Number.isInteger(config.stateMachine.idleGraceMs) || config.stateMachine.idleGraceMs < 0) {
    throw new Error('stateMachine.idleGraceMs must be >= 0');
  }

  if (!Number.isInteger(config.tasks.maxQueueSize) || config.tasks.maxQueueSize < 1) {
    throw new Error('tasks.maxQueueSize must be >= 1');
  }

  if (!Number.isInteger(config.tasks.maxRetries) || config.tasks.maxRetries < 0) {
    throw new Error('tasks.maxRetries must be >= 0');
  }

  if (!Number.isInteger(config.tasks.failureCooldownMs) || config.tasks.failureCooldownMs < 0) {
    throw new Error('tasks.failureCooldownMs must be >= 0');
  }

  if (!Number.isInteger(config.tasks.taskTimeoutMs) || config.tasks.taskTimeoutMs < 1000) {
    throw new Error('tasks.taskTimeoutMs must be >= 1000');
  }

  if (!Number.isInteger(config.web.port) || config.web.port < 1) {
    throw new Error('web.port must be a positive integer');
  }

  if (!Number.isInteger(config.build.placeDelayMs) || config.build.placeDelayMs < 0) {
    throw new Error('build.placeDelayMs must be >= 0');
  }

  if (!Number.isFinite(config.build.flyHeight) || config.build.flyHeight <= 0) {
    throw new Error('build.flyHeight must be > 0');
  }

  if (!Number.isInteger(config.reconnect.delayMs) || config.reconnect.delayMs < 0) {
    throw new Error('reconnect.delayMs must be >= 0');
  }

  if (!Number.isInteger(config.reconnect.maxAttempts) || config.reconnect.maxAttempts < 0) {
    throw new Error('reconnect.maxAttempts must be >= 0');
  }
}

function parseBool(value) {
  return String(value).toLowerCase() === 'true';
}

function arrayClone(value) {
  return Array.isArray(value) ? value.slice() : [];
}

module.exports = {
  loadConfig,
  projectRoot
};
