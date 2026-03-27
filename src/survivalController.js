'use strict';

const minecraftData = require('minecraft-data');
const { plugin: collectBlockPlugin } = require('mineflayer-collectblock');
const { plugin: toolPlugin } = require('mineflayer-tool');

const LOG_NAME_MATCHERS = ['log', 'stem', 'hyphae'];
const FOOD_NAME_MATCHERS = ['bread', 'apple', 'beef', 'porkchop', 'mutton', 'chicken', 'carrot', 'potato', 'cod', 'salmon'];

class SurvivalController {
  constructor(bot, options) {
    this.bot = bot;
    this.username = options.username;
    this.role = options.role || 'collector';
    this.roles = options.roles || {};
    this.logger = options.logger;
    this.stateStore = options.stateStore;
    this.navigationController = options.navigationController;
    this.survival = options.survival;
    this.coordination = options.coordination;
    this.enabled = !!this.survival.enabled;
    this.running = false;
    this.interval = null;
    this.busy = false;
    this.mcData = null;
    this.pendingImmediateTick = false;
    this.lastRetreatAt = 0;
    this.reservedResourceKey = null;
    this.harvestedWoodUnits = 0;

    this.bot.loadPlugin(collectBlockPlugin);
    this.bot.loadPlugin(toolPlugin);
  }

  setup() {
    this.bot.once('spawn', () => {
      this.mcData = minecraftData(this.bot.version);
      this.logger.info(`[${this.username}] survival ready`, {
        enabled: this.enabled,
        autoStart: this.survival.autoStart
      });

      this.stateStore.upsertBotState(this.username, {
        survival: {
          role: this.role,
          enabled: this.enabled,
          running: false,
          lastAction: null,
          harvestedWoodUnits: 0
        }
      });

      if (this.enabled && this.survival.autoStart) {
        this.start();
      }
    });
  }

  start() {
    if (!this.enabled || this.running) return;

    this.running = true;
    this.interval = setInterval(() => {
      this.tick().catch((error) => {
        this.logger.error(`[${this.username}] survival tick failed`, { message: error.message });
        this.updateState('tick_failed', { lastError: error.message });
      });
    }, this.survival.tickIntervalMs);

    this.logger.info(`[${this.username}] survival started`);
    this.updateState('started');
    this.requestImmediateTick('start');
  }

  stop(reason) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.running = false;
    this.updateState(reason || 'stopped');
  }

  isRunning() {
    return this.running;
  }

  getSnapshot() {
    const state = this.stateStore.getBotState(this.username);
    return state ? state.survival || null : null;
  }

  getResourceSnapshot() {
    const logs = this.countInventoryByMatcher(matchesWoodName);
    const planks = this.countInventoryByMatcher((name) => name.endsWith('_planks'));
    return {
      role: this.role,
      wood: logs,
      logs,
      planks,
      harvestedWoodUnits: this.harvestedWoodUnits,
      woodUnits: logs + Math.floor(planks / 4) + this.harvestedWoodUnits,
      sticks: this.countInventoryByName('stick'),
      craftingTable: this.countInventoryByName('crafting_table'),
      woodenPickaxe: this.countInventoryByName('wooden_pickaxe'),
      foodItems: this.bot.inventory.items().filter((item) => FOOD_NAME_MATCHERS.some((matcher) => item.name.includes(matcher))).length
    };
  }

  needsWood() {
    const snapshot = this.getResourceSnapshot();
    const goal = this.role === 'collector'
      ? Math.max(this.survival.woodGoal, this.roles.collectorWoodGoal || 0)
      : this.survival.woodGoal;
    return snapshot.woodUnits < goal;
  }

  requestImmediateTick(reason) {
    if (!this.running || this.pendingImmediateTick) return;

    this.pendingImmediateTick = true;
    setTimeout(() => {
      this.pendingImmediateTick = false;
      this.tick().catch((error) => {
        this.logger.error(`[${this.username}] survival immediate tick failed`, {
          message: error.message,
          reason
        });
        this.updateState('tick_failed', { lastError: error.message });
      });
    }, 0);
  }

  async tick() {
    if (!this.running || this.busy || !this.bot.entity || !this.mcData) return;
    this.busy = true;

    try {
      if (await this.handleLowHealth()) return;
      if (await this.tryEat()) return;
      if (this.role === 'builder') {
        this.updateState('builder_idle', {
          gameMode: this.getGameMode()
        });
        return;
      }
      if (await this.collectNearbyDrops()) return;
      if (await this.ensurePlanks()) return;
      if (await this.ensureSticks()) return;
      if (await this.ensureCraftingTable()) return;
      if (await this.ensureWoodenPickaxe()) return;
      if (await this.ensureWood()) return;

      this.updateState('idle');
    } finally {
      this.busy = false;
    }
  }

  async handleLowHealth() {
    if (!this.bot.health || this.bot.health > this.survival.retreatHealthThreshold) {
      return false;
    }

    const now = Date.now();
    const navigationTask = this.navigationController.getCurrentTask();
    const retreatActive = navigationTask && navigationTask.type === 'go_to';
    if (now - this.lastRetreatAt < this.survival.retreatCooldownMs || retreatActive) {
      this.updateState('low_health_wait', { health: this.bot.health });
      return true;
    }

    if (!this.navigationController.navigation.home.enabled) {
      this.updateState('low_health_no_home', { health: this.bot.health });
      return true;
    }

    this.logger.warn(`[${this.username}] retreating due to low health`, { health: this.bot.health });
    this.updateState('retreating', { health: this.bot.health });
    this.lastRetreatAt = now;
    this.navigationController.returnHome();
    return true;
  }

  async tryEat() {
    if (typeof this.bot.food !== 'number' || this.bot.food >= this.survival.foodThreshold) {
      return false;
    }

    const foodItem = this.findBestFood();
    if (!foodItem) {
      this.updateState('hungry_no_food', { food: this.bot.food });
      return false;
    }

    this.logger.info(`[${this.username}] eating`, { item: foodItem.name, food: this.bot.food });
    this.updateState('eating', { item: foodItem.name });

    await this.bot.equip(foodItem, 'hand');
    await this.bot.consume();
    this.requestImmediateTick('after-eat');
    return true;
  }

  async collectNearbyDrops() {
    const entities = Object.values(this.bot.entities).filter((entity) => {
      return entity.name === 'item' && this.distanceTo(entity.position) <= this.survival.collectDropsRadius;
    });

    if (!entities.length) return false;

    const target = entities[0];
    this.logger.info(`[${this.username}] collecting drop`, {
      entityId: target.id,
      distance: round(this.distanceTo(target.position))
    });
    this.updateState('collecting_drop');

    await this.bot.collectBlock.collect(target);
    this.requestImmediateTick('after-collect-drop');
    return true;
  }

  async ensureWood() {
    const snapshot = this.getResourceSnapshot();
    const goal = this.role === 'collector'
      ? Math.max(this.survival.woodGoal, this.roles.collectorWoodGoal || 0)
      : this.survival.woodGoal;

    if (snapshot.woodUnits >= goal) {
      return false;
    }

    const block = await this.findNearestLogBlock();
    if (!block) {
      this.updateState('searching_wood_failed', { radius: this.survival.searchRadius });
      return false;
    }

    const reservationKey = toResourceKey(block.position);
    if (!await this.coordination.reserveResource(reservationKey, this.username)) {
      this.updateState('wood_reserved_by_other', {
        block: block.name,
        resourceKey: reservationKey
      });
      return false;
    }

    this.reservedResourceKey = reservationKey;

    this.logger.info(`[${this.username}] collecting wood`, {
      name: block.name,
      position: block.position
    });
    this.updateState('collecting_wood', { block: block.name });

    try {
      await this.bot.tool.equipForBlock(block);
      await this.bot.collectBlock.collect(block);
      if (this.isCreativeMode()) {
        this.harvestedWoodUnits += 1;
      }
    } finally {
      await this.releaseReservedResource();
    }
    this.requestImmediateTick('after-collect-wood');
    return true;
  }

  async ensurePlanks() {
    const planksCount = this.countInventoryByMatcher((name) => name.endsWith('_planks'));
    if (planksCount >= this.survival.planksGoal) {
      return false;
    }

    const logItem = this.findInventoryItem(matchesWoodName);
    if (!logItem) return false;

    const planksRecipe = this.findRecipeByResultName('_planks');
    if (!planksRecipe) return false;

    this.logger.info(`[${this.username}] crafting planks`);
    this.updateState('crafting_planks');
    await this.bot.craft(planksRecipe, 1, null);
    this.requestImmediateTick('after-craft-planks');
    return true;
  }

  async ensureSticks() {
    const sticksCount = this.countInventoryByName('stick');
    if (sticksCount >= this.survival.sticksGoal) {
      return false;
    }

    const recipe = this.findRecipeExact('stick');
    if (!recipe) return false;

    this.logger.info(`[${this.username}] crafting sticks`);
    this.updateState('crafting_sticks');
    await this.bot.craft(recipe, 1, null);
    this.requestImmediateTick('after-craft-sticks');
    return true;
  }

  async ensureCraftingTable() {
    const current = this.countInventoryByName('crafting_table');
    if (current >= this.survival.craftingTableGoal) {
      return false;
    }

    const recipe = this.findRecipeExact('crafting_table');
    if (!recipe) return false;

    this.logger.info(`[${this.username}] crafting crafting_table`);
    this.updateState('crafting_table');
    await this.bot.craft(recipe, 1, null);
    this.requestImmediateTick('after-craft-table');
    return true;
  }

  async ensureWoodenPickaxe() {
    const current = this.countInventoryByName('wooden_pickaxe');
    if (current >= this.survival.woodenPickaxeGoal) {
      return false;
    }

    const tableBlock = this.findNearbyBlockByName('crafting_table');
    const recipe = this.findRecipeExact('wooden_pickaxe', tableBlock || null);
    if (!recipe) return false;

    this.logger.info(`[${this.username}] crafting wooden_pickaxe`, {
      withTable: !!tableBlock
    });
    this.updateState('crafting_pickaxe');
    await this.bot.craft(recipe, 1, tableBlock || null);
    this.requestImmediateTick('after-craft-pickaxe');
    return true;
  }

  findBestFood() {
    return this.bot.inventory.items().find((item) => FOOD_NAME_MATCHERS.some((matcher) => item.name.includes(matcher)));
  }

  findInventoryItem(predicate) {
    return this.bot.inventory.items().find((item) => predicate(item.name));
  }

  countInventoryByName(name) {
    return this.bot.inventory.items()
      .filter((item) => item.name === name)
      .reduce((sum, item) => sum + item.count, 0);
  }

  countInventoryByMatcher(predicate) {
    return this.bot.inventory.items()
      .filter((item) => predicate(item.name))
      .reduce((sum, item) => sum + item.count, 0);
  }

  findRecipeByResultName(namePart, craftingTable) {
    const recipes = this.bot.recipesAll(null, craftingTable || null, 1) || [];
    return recipes.find((recipe) => {
      const resultItem = this.mcData.items[recipe.result.id];
      return resultItem && resultItem.name.includes(namePart);
    }) || null;
  }

  findRecipeExact(itemName, craftingTable) {
    const item = this.mcData.itemsByName[itemName];
    if (!item) return null;

    const recipes = this.bot.recipesFor(item.id, null, 1, craftingTable || null);
    return recipes && recipes.length ? recipes[0] : null;
  }

  async findNearestLogBlock() {
    const blocks = this.bot.findBlocks({
      maxDistance: this.survival.searchRadius,
      count: 20,
      matching: (block) => !!block && matchesWoodName(block.name)
    }) || [];

    for (const position of blocks) {
      const resourceKey = toResourceKey(position);
      if (await this.coordination.isResourceReservedByOther(resourceKey, this.username)) {
        continue;
      }

      const block = this.bot.blockAt(position);
      if (block) {
        return block;
      }
    }

    return null;
  }

  findNearbyBlockByName(name) {
    return this.bot.findBlock({
      maxDistance: 6,
      matching: (block) => !!block && block.name === name
    });
  }

  updateState(action, extra) {
    this.bot.emit('survival_action', action);
    this.stateStore.upsertBotState(this.username, {
      survival: {
        role: this.role,
        enabled: this.enabled,
        running: this.running,
        lastAction: action,
        harvestedWoodUnits: this.harvestedWoodUnits,
        reservedResource: this.reservedResourceKey,
        updatedAt: new Date().toISOString(),
        ...(extra || {})
      }
    });
  }

  async releaseReservedResource() {
    if (!this.reservedResourceKey) return;
    await this.coordination.releaseResource(this.reservedResourceKey, this.username);
    this.reservedResourceKey = null;
  }

  distanceTo(position) {
    return this.bot.entity.position.distanceTo(position);
  }

  isCreativeMode() {
    const gameMode = this.getGameMode();
    return gameMode === 'creative' || gameMode === 1;
  }

  getGameMode() {
    return this.bot.game ? this.bot.game.gameMode : null;
  }
}

function matchesWoodName(name) {
  return LOG_NAME_MATCHERS.some((matcher) => name.includes(matcher));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function toResourceKey(position) {
  return `${position.x}:${position.y}:${position.z}`;
}

module.exports = {
  SurvivalController
};
