'use strict';

const { Vec3 } = require('vec3');
const { getTemplate } = require('./buildTemplates');

const FACES = [
  new Vec3(0, -1, 0),
  new Vec3(0, 1, 0),
  new Vec3(1, 0, 0),
  new Vec3(-1, 0, 0),
  new Vec3(0, 0, 1),
  new Vec3(0, 0, -1)
];

class BuildController {
  constructor(bot, options) {
    this.bot = bot;
    this.username = options.username;
    this.logger = options.logger;
    this.stateStore = options.stateStore;
    this.navigationController = options.navigationController;
    this.config = options.build;
    this.activeBuild = null;
  }

  async startTemplate(templateName, origin) {
    if (!this.config.enabled) {
      return { ok: false, error: 'build-disabled' };
    }

    const template = getTemplate(templateName || this.config.defaultTemplate);
    if (!template) {
      return { ok: false, error: 'unknown-template' };
    }

    const buildOrigin = origin || this.getDefaultOrigin();
    this.activeBuild = {
      template: template.name,
      origin: buildOrigin,
      startedAt: new Date().toISOString(),
      placed: 0,
      total: template.blocks.length,
      status: 'running'
    };
    this.persistBuildState();

    this.logger.info(`[${this.username}] build start`, {
      template: template.name,
      origin: buildOrigin,
      totalBlocks: template.blocks.length
    });

    try {
      for (const entry of template.blocks) {
        await this.placeTemplateBlock(buildOrigin, entry);
        this.activeBuild.placed += 1;
        this.persistBuildState();
      }

      this.activeBuild.status = 'completed';
      this.activeBuild.completedAt = new Date().toISOString();
      this.persistBuildState();
      this.logger.info(`[${this.username}] build completed`, {
        template: template.name,
        placed: this.activeBuild.placed
      });
      return { ok: true };
    } catch (error) {
      this.activeBuild.status = 'failed';
      this.activeBuild.error = error.message;
      this.persistBuildState();
      this.logger.error(`[${this.username}] build failed`, {
        template: template.name,
        message: error.message
      });
      return { ok: false, error: error.message };
    }
  }

  getDefaultOrigin() {
    const pos = this.bot.entity.position.floored();
    return {
      x: pos.x + 5,
      y: pos.y + 1,
      z: pos.z + 5
    };
  }

  async placeTemplateBlock(origin, entry) {
    const target = new Vec3(origin.x + entry.x, origin.y + entry.y, origin.z + entry.z);
    const current = this.bot.blockAt(target);

    if (entry.block === 'air') {
      if (current && current.name !== 'air') {
        await this.bot.dig(current, true);
      }
      return;
    }

    if (current && current.name === entry.block) {
      return;
    }

    if (current && current.name !== 'air' && current.name !== entry.block) {
      if (!current.diggable) {
        throw new Error(`Target blocked by ${current.name} at ${target.x} ${target.y} ${target.z}`);
      }

      await this.bot.dig(current, true);
      await sleep(this.config.placeDelayMs);
    }

    const itemType = this.bot.registry.itemsByName[entry.block];
    if (!itemType) {
      throw new Error(`Unknown block item: ${entry.block}`);
    }

    const Item = require('prismarine-item')(this.bot.registry);
    await this.bot.creative.setInventorySlot(36, new Item(itemType.id, 1, 0));
    await this.bot.equip(this.bot.inventory.slots[36], 'hand');

    const support = this.findSupport(target);
    if (!support) {
      throw new Error(`No support block for placement at ${target.x} ${target.y} ${target.z}`);
    }

    await this.bot.creative.flyTo(target.offset(0.5, this.config.flyHeight, 0.5));
    await this.bot.lookAt(target.offset(0.5, 0.5, 0.5), true);
    await this.bot.placeBlock(support.referenceBlock, support.faceVector);
    await sleep(this.config.placeDelayMs);
  }

  findSupport(target) {
    for (const face of FACES) {
      const referencePos = target.minus(face);
      const referenceBlock = this.bot.blockAt(referencePos);
      if (referenceBlock && referenceBlock.name !== 'air') {
        return {
          referenceBlock,
          faceVector: face
        };
      }
    }

    return null;
  }

  persistBuildState() {
    this.stateStore.upsertBotState(this.username, {
      build: this.activeBuild
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  BuildController
};
