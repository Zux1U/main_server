'use strict';

const path = require('path');
const { loadConfig } = require('./config');
const { Logger } = require('./logger');
const { StateStore } = require('./stateStore');
const { BotManager } = require('./botManager');
const { ArenaController } = require('./arenaController');
const { MinecraftRconClient } = require('./minecraftRconClient');
const { ArenaDatapackManager } = require('./arenaDatapackManager');
const { WebServer } = require('./webServer');

async function main() {
  const config = loadConfig();
  const logger = new Logger(path.resolve(config._meta.projectRoot, config.logging.directory));
  const stateStore = new StateStore(path.resolve(config._meta.projectRoot, config.storage.file));
  const botManager = new BotManager(config, logger, stateStore);
  const rconClient = new MinecraftRconClient({
    config: config.rcon,
    logger
  });
  const arenaDatapackManager = new ArenaDatapackManager({
    projectRoot: config._meta.projectRoot,
    arena: config.arena,
    logger
  });
  const arenaController = new ArenaController({
    arena: config.arena,
    logger,
    stateStore,
    botManager,
    rconClient,
    datapackManager: arenaDatapackManager
  });
  botManager.setArenaController(arenaController);
  const webServer = new WebServer({
    config: config.web,
    logger,
    stateStore,
    botManager,
    arenaController
  });

  logger.info('Booting mc-bot-colony', {
    configPath: config._meta.configPath,
    server: config.server,
    bots: config.bots,
    arena: {
      enabled: !!(config.arena && config.arena.enabled),
      loginRecoveryEnabled: !!(config.arena && config.arena.loginRecoveryEnabled),
      runtimeDatapackEnabled: !!(config.arena && config.arena.runtimeDatapack && config.arena.runtimeDatapack.enabled),
      serverControlEnabled: !!(config.arena && config.arena.serverControl && config.arena.serverControl.enabled)
    },
    reconnect: config.reconnect,
    web: config.web
  });

  webServer.start();

  if (config.arena && config.arena.enabled) {
    const bootstrap = await arenaController.bootstrapServer();
    if (!bootstrap.ok && !bootstrap.skipped) {
      logger.warn('Arena bootstrap did not complete cleanly', {
        error: bootstrap.error || 'bootstrap_failed'
      });
    }
  }

  process.once('SIGINT', () => {
    logger.warn('Received SIGINT');
    webServer.stop();
    botManager.stopAll('SIGINT')
      .catch((error) => {
        logger.error('bot manager stop failed', { message: error.message });
      })
      .finally(() => {
        setTimeout(() => process.exit(0), 1000);
      });
  });

  process.once('SIGTERM', () => {
    logger.warn('Received SIGTERM');
    webServer.stop();
    botManager.stopAll('SIGTERM')
      .catch((error) => {
        logger.error('bot manager stop failed', { message: error.message });
      })
      .finally(() => {
        setTimeout(() => process.exit(0), 1000);
      });
  });

  if (config.bots.startOnBoot === false) {
    await botManager.setActiveBotCount(0, {
      reason: 'startup-wait-web'
    });
    logger.info('Worker autostart disabled, waiting for web launch command', {
      capacity: botManager.maxBotCount
    });
  } else {
    await botManager.startAll();
  }
}

main().catch((error) => {
  console.error('[fatal]', error);
  process.exit(1);
});
