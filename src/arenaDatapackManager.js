'use strict';

const fs = require('fs');
const path = require('path');

class ArenaDatapackManager {
  constructor(options) {
    this.projectRoot = options.projectRoot;
    this.logger = options.logger;
    this.arena = options.arena || {};
    this.serverControl = this.arena.serverControl || {};
    this.runtimeDatapack = this.arena.runtimeDatapack || {};
    this.namespace = sanitizeNamespace(this.runtimeDatapack.namespace || 'mc_arena_runtime');
    this.datapackPath = resolveDatapackPath(
      this.projectRoot,
      this.runtimeDatapack.path || '../mc-paper-local/world_arena_flat/datapacks/mc_arena_runtime'
    );
  }

  isEnabled() {
    return !!(this.serverControl.enabled && this.runtimeDatapack.enabled !== false);
  }

  getFunctionReference(name) {
    return `${this.namespace}:${name}`;
  }

  syncRound(options) {
    if (!this.isEnabled()) {
      return {
        ok: true,
        skipped: true,
        reason: 'runtime_datapack_disabled'
      };
    }

    const participants = Array.isArray(options && options.participants) ? options.participants : [];
    const playerParticipants = Array.isArray(options && options.playerParticipants) ? options.playerParticipants : [];
    const holdingZone = getHoldingZone(this.arena);
    const files = buildRuntimeFiles({
      namespace: this.namespace,
      participants,
      playerParticipants,
      holdingZone,
      serverControl: this.serverControl
    });

    let changed = false;
    for (const [relativePath, content] of Object.entries(files)) {
      const targetPath = path.join(this.datapackPath, relativePath);
      if (writeFileIfChanged(targetPath, content)) {
        changed = true;
      }
    }

    if (changed) {
      this.logger.info('[arena-datapack] runtime files updated', {
        datapackPath: this.datapackPath,
        namespace: this.namespace,
        participants: participants.length,
        players: playerParticipants.length
      });
    }

    return {
      ok: true,
      changed,
      namespace: this.namespace,
      datapackPath: this.datapackPath,
      prepareFunction: this.getFunctionReference('prepare_round'),
      startFunction: this.getFunctionReference('start_round'),
      stopFunction: this.getFunctionReference('stop_round')
    };
  }
}

function buildRuntimeFiles(options) {
  const namespace = options.namespace;
  const participants = options.participants;
  const playerParticipants = options.playerParticipants;
  const holdingZone = options.holdingZone;
  const serverControl = options.serverControl || {};

  return {
    'pack.mcmeta': JSON.stringify({
      pack: {
        description: 'mc-bot-colony runtime arena datapack',
        min_format: [94, 1],
        max_format: [94, 1]
      }
    }, null, 2),
    'data/minecraft/tags/function/load.json': JSON.stringify({
      values: [`${namespace}:load`]
    }, null, 2),
    'data/minecraft/tags/function/tick.json': JSON.stringify({
      values: [`${namespace}:tick`]
    }, null, 2),
    [`data/${namespace}/function/load.mcfunction`]: renderLines([
      'scoreboard objectives add mc_arena_deaths deathCount',
      'scoreboard objectives add mc_arena_state dummy',
      'scoreboard players add $state mc_arena_state 0'
    ]),
    [`data/${namespace}/function/tick.mcfunction`]: renderLines([
      'execute if score $state mc_arena_state matches 1 as @a[tag=arena_human,tag=arena_participant,scores={mc_arena_deaths=1..}] run function ' + `${namespace}:eliminate_human`
    ]),
    [`data/${namespace}/function/eliminate_human.mcfunction`]: renderLines([
      'tag @s remove arena_participant',
      'tag @s remove arena_human',
      'scoreboard players set @s mc_arena_deaths 0'
    ]),
    [`data/${namespace}/function/start_round.mcfunction`]: renderLines([
      'scoreboard players set $state mc_arena_state 1'
    ]),
    [`data/${namespace}/function/stop_round.mcfunction`]: renderLines([
      'scoreboard players set $state mc_arena_state 0',
      'tag @a remove arena_participant',
      'tag @a remove arena_human',
      'tag @a remove arena_bot'
    ]),
    [`data/${namespace}/function/prepare_round.mcfunction`]: renderPrepareRound({
      participants,
      playerParticipants,
      serverControl,
      holdingZone,
      namespace
    })
  };
}

function renderPrepareRound(options) {
  const participants = options.participants;
  const playerParticipants = options.playerParticipants;
  const serverControl = options.serverControl;
  const lines = [];

  lines.push('function ' + `${options.namespace}:stop_round`);
  lines.push(...toArray(serverControl.sharedPrepareCommands));

  for (const participant of participants) {
    lines.push(`tag ${participant.username} add arena_bot`);
    lines.push(...renderTemplates(serverControl.perBotPrepareCommands, {
      username: participant.username,
      x: participant.spawnPoint && participant.spawnPoint.x,
      y: participant.spawnPoint && participant.spawnPoint.y,
      z: participant.spawnPoint && participant.spawnPoint.z
    }));
  }

  for (const participant of playerParticipants) {
    lines.push(`tag ${participant.username} add arena_human`);
    lines.push(...renderTemplates(serverControl.perHumanPrepareCommands, {
      username: participant.username,
      x: participant.spawnPoint && participant.spawnPoint.x,
      y: participant.spawnPoint && participant.spawnPoint.y,
      z: participant.spawnPoint && participant.spawnPoint.z
    }));
  }

  lines.push(...toArray(serverControl.sharedParticipantPrepareCommands));
  lines.push('scoreboard players set @a[tag=arena_participant] mc_arena_deaths 0');
  lines.push('scoreboard players set $state mc_arena_state 0');

  return renderLines(lines);
}

function renderTemplates(templates, context) {
  return toArray(templates)
    .map((template) => {
      if (typeof template !== 'string' || !template.trim()) {
        return null;
      }

      const rendered = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
        const value = context[key];
        return value === undefined || value === null ? '' : String(value);
      }).trim();

      return rendered || null;
    })
    .filter(Boolean);
}

function renderLines(lines) {
  return toArray(lines).filter(Boolean).join('\n') + '\n';
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveDatapackPath(projectRoot, configuredPath) {
  if (path.isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return path.resolve(projectRoot, configuredPath);
}

function sanitizeNamespace(value) {
  return String(value || 'mc_arena_runtime')
    .trim()
    .replace(/[^a-z0-9_:\-./]/gi, '_')
    .replace(/:/g, '_');
}

function getHoldingZone(arena) {
  const zone = arena && arena.holdingZone ? arena.holdingZone : null;
  if (zone && Number.isFinite(zone.x) && Number.isFinite(zone.y) && Number.isFinite(zone.z)) {
    return {
      x: zone.x,
      y: zone.y,
      z: zone.z
    };
  }

  return {
    x: 0,
    y: -60,
    z: 120
  };
}

function writeFileIfChanged(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    const current = fs.readFileSync(filePath, 'utf8');
    if (current === content) {
      return false;
    }
  }

  fs.writeFileSync(filePath, content);
  return true;
}

module.exports = {
  ArenaDatapackManager
};
