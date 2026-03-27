'use strict';

const FOOD_NAME_MATCHERS = ['bread', 'apple', 'beef', 'porkchop', 'mutton', 'chicken', 'carrot', 'potato', 'cod', 'salmon'];
const WEAPON_PRIORITY = ['netherite_sword', 'diamond_sword', 'iron_sword', 'stone_sword', 'wooden_sword'];
const ARMOR_PRIORITY = {
  head: ['netherite_helmet', 'diamond_helmet', 'iron_helmet', 'chainmail_helmet', 'golden_helmet', 'leather_helmet'],
  torso: ['netherite_chestplate', 'diamond_chestplate', 'iron_chestplate', 'chainmail_chestplate', 'golden_chestplate', 'leather_chestplate'],
  legs: ['netherite_leggings', 'diamond_leggings', 'iron_leggings', 'chainmail_leggings', 'golden_leggings', 'leather_leggings'],
  feet: ['netherite_boots', 'diamond_boots', 'iron_boots', 'chainmail_boots', 'golden_boots', 'leather_boots']
};

class ArenaCombatController {
  constructor(options) {
    this.bot = options.bot;
    this.username = options.username;
    this.logger = options.logger;
    this.stateStore = options.stateStore;
    this.navigationController = options.navigationController;
    this.config = options.arena || {};
    this.emitEvent = typeof options.emitEvent === 'function' ? options.emitEvent : () => {};
    this.setAutoRespawn = typeof options.setAutoRespawn === 'function' ? options.setAutoRespawn : () => {};

    this.enabled = !!this.config.enabled;
    this.interval = null;
    this.busy = false;
    this.state = 'BOOTING';
    this.reason = 'startup';
    this.lastTransitionAt = null;
    this.roundStatus = 'idle';
    this.roundId = 0;
    this.spawnPoint = null;
    this.participantUsernames = [];
    this.currentTargetId = null;
    this.currentTargetUsername = null;
    this.targetLockUntil = 0;
    this.eliminated = false;
    this.lastAttackAt = 0;
    this.lastHealth = null;
    this.lastLoadoutCheckAt = 0;
    this.lastStrafeSwapAt = 0;
    this.strafeDirection = 'left';
    this.lastJumpAt = 0;
    this.jumpReleaseTimeout = null;
    this.respawnPromise = null;
    this.stats = createStats();
  }

  setup() {
    if (!this.enabled) return;
    this.updateAutoRespawn(true, 'arena-runtime-boot');

    this.bot.once('spawn', () => {
      if (!this.spawnPoint && this.bot.entity && this.bot.entity.position) {
        const pos = this.bot.entity.position;
        this.spawnPoint = {
          x: round(pos.x),
          y: round(pos.y),
          z: round(pos.z)
        };
      }

      this.lastHealth = toNumber(this.bot.health);
      this.transition('LOBBY', 'spawn');
      this.persist();

      if (this.interval) {
        clearInterval(this.interval);
      }

      this.interval = setInterval(() => {
        this.tick().catch((error) => {
          this.logger.error(`[${this.username}] arena tick failed`, { message: error.message });
          this.clearCombatControls('tick-failed');
          this.transition('ERROR_RECOVERY', 'tick-failed');
          this.persist({
            lastError: error.message,
            lastErrorAt: new Date().toISOString()
          });
        });
      }, this.config.tickIntervalMs);
    });

    this.bot.on('health', () => {
      const currentHealth = toNumber(this.bot.health);
      if (this.lastHealth !== null && Number.isFinite(currentHealth) && currentHealth < this.lastHealth) {
        const delta = round(this.lastHealth - currentHealth);
        if (delta > 0.01) {
          this.stats.damageTaken += delta;
          this.emitEvent('took_damage', {
            amount: delta,
            health: currentHealth
          });
        }
      }

      this.lastHealth = Number.isFinite(currentHealth) ? currentHealth : this.lastHealth;
      this.persist();
    });

    this.bot.on('death', () => {
      const deathPosition = this.bot.entity && this.bot.entity.position
        ? {
            x: round(this.bot.entity.position.x),
            y: round(this.bot.entity.position.y),
            z: round(this.bot.entity.position.z)
          }
        : null;
      this.clearCombatControls('death');
      this.navigationController.stop('arena-death');
      this.clearTarget('death');
      this.stats.deaths += 1;
      this.eliminated = this.roundStatus === 'running';
      this.transition('DEAD', this.eliminated ? 'eliminated' : 'death');
      this.persist({
        eliminated: this.eliminated,
        lastDeathAt: new Date().toISOString()
      });
      this.emitEvent('died', {
        roundId: this.roundId,
        eliminated: this.eliminated,
        position: deathPosition
      });
    });

    this.bot.on('entityDead', (entity) => {
      if (!entity || entity.id !== this.currentTargetId) return;

      this.stats.kills += 1;
      this.emitEvent('killed_enemy', {
        roundId: this.roundId,
        target: {
          id: entity.id,
          username: entity.username || this.currentTargetUsername || null
        }
      });
      this.clearTarget('target-dead');
      this.transition('SEARCHING_TARGET', 'target-dead');
      this.persist();
    });

    this.bot.on('entityGone', (entity) => {
      if (!entity || entity.id !== this.currentTargetId) return;
      this.clearTarget('target-gone');
      this.transition('SEARCHING_TARGET', 'target-gone');
      this.persist();
    });
  }

  stop(reason) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.clearCombatControls(reason || 'arena-stop');
    this.navigationController.stop(reason || 'arena-stop');
    this.clearTarget(reason || 'arena-stop');
    this.targetLockUntil = 0;
    this.updateAutoRespawn(true, reason || 'arena-stop');
    this.transition('STOPPED', reason || 'arena-stop');
    this.persist({
      eliminated: this.eliminated
    });
  }

  async prepareRound(args) {
    if (!this.enabled) {
      return { ok: false, error: 'arena_disabled' };
    }

    const requestedRoundId = Number.isInteger(args && args.roundId) ? args.roundId : null;
    if (requestedRoundId !== null && this.isStaleRoundCommand(requestedRoundId)) {
      return {
        ok: true,
        skipped: true,
        reason: 'stale_round_command',
        roundId: this.roundId
      };
    }

    if (Number.isInteger(args && args.roundId)) {
      this.roundId = args.roundId;
    } else {
      this.roundId += 1;
    }

    this.roundStatus = 'preparing';
    this.eliminated = false;
    this.stats = createStats();
    this.lastAttackAt = 0;
    this.lastLoadoutCheckAt = 0;
    this.targetLockUntil = 0;
    this.lastStrafeSwapAt = 0;
    this.lastJumpAt = 0;
    this.clearCombatControls('prepare-round');
    this.clearTarget('prepare-round');
    this.navigationController.stop('arena-prepare');
    this.updateAutoRespawn(true, 'prepare-round');

    if (isCoordinateTriple(args && args.spawnPoint)) {
      this.spawnPoint = {
        x: round(args.spawnPoint.x),
        y: round(args.spawnPoint.y),
        z: round(args.spawnPoint.z)
      };
    }

    this.transition('PREPARING', 'prepare-round');
    this.participantUsernames = normalizeParticipants(args && args.participantUsernames);
    this.persist({
      participantUsernames: this.participantUsernames,
      preparedAt: new Date().toISOString(),
      eliminated: false
    });

    this.emitEvent('ready', {
      roundId: this.roundId
    });

    return {
      ok: true,
      roundId: this.roundId,
      spawnPoint: this.spawnPoint
    };
  }

  async startRound(args) {
    if (!this.enabled) {
      return { ok: false, error: 'arena_disabled' };
    }

    const requestedRoundId = Number.isInteger(args && args.roundId) ? args.roundId : null;
    if (requestedRoundId !== null && this.isStaleRoundCommand(requestedRoundId)) {
      return {
        ok: true,
        skipped: true,
        reason: 'stale_round_command',
        roundId: this.roundId
      };
    }

    if (Number.isInteger(args && args.roundId)) {
      this.roundId = args.roundId;
    }

    this.participantUsernames = normalizeParticipants(args && args.participantUsernames);
    this.roundStatus = 'preparing';
    this.eliminated = false;
    this.lastAttackAt = 0;
    this.lastLoadoutCheckAt = 0;
    this.targetLockUntil = 0;
    this.clearCombatControls('round-start');
    this.clearTarget('round-start');
    this.updateAutoRespawn(true, 'round-start-recovery');

    await this.ensureRespawned('round-start-respawn');

    try {
      await this.ensureCombatLoadout(true);
    } catch (error) {
      this.logger.warn(`[${this.username}] start round loadout check failed`, {
        message: error.message
      });
    }

    this.updateAutoRespawn(false, 'round-running');
    this.roundStatus = 'running';
    this.transition('SEARCHING_TARGET', 'round-start');
    this.persist({
      participantUsernames: this.participantUsernames,
      startedAt: new Date().toISOString(),
      eliminated: false
    });
    this.emitEvent('spawned', {
      roundId: this.roundId
    });
    return { ok: true, roundId: this.roundId };
  }

  async stopRound(args) {
    if (!this.enabled) {
      return { ok: false, error: 'arena_disabled' };
    }

    const requestedRoundId = Number.isInteger(args && args.roundId) ? args.roundId : null;
    if (requestedRoundId !== null && this.isStaleRoundCommand(requestedRoundId)) {
      return {
        ok: true,
        skipped: true,
        reason: 'stale_round_command',
        roundId: this.roundId
      };
    }
    this.adoptRoundId(requestedRoundId);

    this.roundStatus = 'stopped';
    this.eliminated = false;
    this.clearCombatControls('arena-stop-round');
    this.navigationController.stop('arena-stop-round');
    this.clearTarget('stop-round');
    this.targetLockUntil = 0;
    this.updateAutoRespawn(true, 'round-stop');
    this.transition('LOBBY', (args && args.reason) || 'round-stop');
    this.persist({
      stoppedAt: new Date().toISOString(),
      eliminated: false
    });
    return { ok: true, roundId: this.roundId };
  }

  async resetPosition(args) {
    if (!this.enabled) {
      return { ok: false, error: 'arena_disabled' };
    }

    const requestedRoundId = Number.isInteger(args && args.roundId) ? args.roundId : null;
    if (requestedRoundId !== null && this.isStaleRoundCommand(requestedRoundId)) {
      return {
        ok: true,
        skipped: true,
        reason: 'stale_round_command',
        roundId: this.roundId
      };
    }
    this.adoptRoundId(requestedRoundId);

    if (isCoordinateTriple(args && args.spawnPoint)) {
      this.spawnPoint = {
        x: round(args.spawnPoint.x),
        y: round(args.spawnPoint.y),
        z: round(args.spawnPoint.z)
      };
    }

    this.roundStatus = 'preparing';
    this.eliminated = false;
    this.lastLoadoutCheckAt = 0;
    this.clearCombatControls('reset-position');
    this.navigationController.stop('reset-position');
    this.clearTarget('reset-position');
    this.targetLockUntil = 0;
    this.updateAutoRespawn(true, 'reset-position');
    this.transition('PREPARING', 'reset-position');

    try {
      await this.ensureRespawned('prepare-sync-respawn');
    } catch (error) {
      this.logger.warn(`[${this.username}] reset position respawn failed`, {
        message: error.message
      });
    }

    this.persist({
      resetAt: new Date().toISOString(),
      eliminated: false
    });
    return { ok: true, spawnPoint: this.spawnPoint };
  }

  async tick() {
    if (!this.enabled || this.busy || !this.bot.entity) return;

    this.busy = true;
    try {
      if (this.roundStatus !== 'running') {
        this.clearCombatControls('non-combat');
        await this.tickNonCombatState();
        return;
      }

      if (this.eliminated) {
        this.clearCombatControls('eliminated');
        this.navigationController.stop('arena-eliminated');
        this.transition('DEAD', 'eliminated');
        this.persist({
          eliminated: true
        });
        return;
      }

      if (!this.bot.isAlive || toNumber(this.bot.health) <= 0) {
        this.clearCombatControls('waiting-respawn');
        this.transition('DEAD', 'waiting-respawn');
        this.persist({
          eliminated: this.eliminated
        });
        return;
      }

      await this.ensureCombatLoadout();

      if (await this.handleHealing()) {
        return;
      }

      const target = this.resolveTarget();
      if (!target) {
        this.clearTarget('no-target');
        this.clearCombatControls('no-target');
        this.transition('SEARCHING_TARGET', 'no-target');
        this.persist({
          eliminated: false
        });
        return;
      }

      this.adoptTarget(target);

      const distance = round(this.bot.entity.position.distanceTo(target.position));
      if (distance > this.config.attackRange) {
        this.clearCombatControls('closing-distance');
        this.transition('ENGAGING', 'closing-distance');
        const currentNavigationTask = this.navigationController.getCurrentTask();
        if (!currentNavigationTask || currentNavigationTask.type !== 'follow_entity' || currentNavigationTask.entityId !== target.id) {
          this.navigationController.followEntity(target, this.config.chaseDistance);
        }
        this.persist({
          eliminated: false
        });
        return;
      }

      this.navigationController.stop('attack-window');
      this.transition('ENGAGING', 'attack-window');
      await this.bot.lookAt(target.position.offset(0, 1.3, 0), true);
      this.applyCloseRangeMovement(distance);

      if (Date.now() - this.lastAttackAt >= this.config.attackCooldownMs) {
        this.lastAttackAt = Date.now();
        await this.bot.attack(target);
      }

      this.persist({
        eliminated: false
      });
    } finally {
      this.busy = false;
    }
  }

  async ensureRespawned(reason) {
    if (!this.bot || this.bot.isAlive) {
      return;
    }

    if (typeof this.bot.respawn !== 'function') {
      throw new Error('manual_respawn_unavailable');
    }

    if (this.respawnPromise) {
      await this.respawnPromise;
      return;
    }

    this.transition('RESPAWNING', reason || 'manual-respawn');
    this.persist({
      eliminated: false
    });

    this.respawnPromise = waitForRespawn(this.bot, 10000);

    try {
      this.bot.respawn();
      await this.respawnPromise;
      this.lastHealth = toNumber(this.bot.health);
      this.persist({
        eliminated: false
      });
    } finally {
      this.respawnPromise = null;
    }
  }

  async tickNonCombatState() {
    this.updateAutoRespawn(true, this.roundStatus === 'preparing' ? 'non-combat-preparing' : 'non-combat-idle');

    if (this.roundStatus !== 'preparing') {
      if (!this.bot.isAlive || toNumber(this.bot.health) <= 0) {
        try {
          await this.ensureRespawned('idle-round-respawn');
        } catch (error) {
          this.logger.warn(`[${this.username}] idle respawn failed`, {
            message: error.message
          });
          this.transition('DEAD', 'idle-respawn-failed');
          this.persist({
            eliminated: false,
            lastError: error.message,
            lastErrorAt: new Date().toISOString()
          });
          return;
        }
      }

      if (this.state !== 'LOBBY' || this.reason !== 'idle-round') {
        this.transition('LOBBY', 'idle-round');
      }
      this.persist({
        eliminated: this.eliminated
      });
      return;
    }

    if (!this.spawnPoint || !this.bot.entity) {
      this.transition('PREPARING', 'awaiting-spawn-point');
      this.persist({
        eliminated: false
      });
      return;
    }

    if (!this.bot.isAlive || toNumber(this.bot.health) <= 0) {
      this.transition('PREPARING', 'awaiting-respawn');
      this.persist({
        eliminated: false
      });
      return;
    }

    const distance = this.bot.entity.position.distanceTo(vec3Like(this.spawnPoint));
    this.navigationController.stop('prepared-awaiting-start');
    this.transition('PREPARING', distance <= 2.25 ? 'at-spawn-point' : 'awaiting-server-teleport');
    this.persist({
      eliminated: false
    });
  }

  updateAutoRespawn(enabled, reason) {
    try {
      this.setAutoRespawn(enabled, reason);
    } catch (error) {
      this.logger.warn(`[${this.username}] auto respawn toggle failed`, {
        enabled: !!enabled,
        reason: reason || 'unspecified',
        message: error.message
      });
    }
  }

  isStaleRoundCommand(roundId) {
    if (!Number.isInteger(roundId)) {
      return false;
    }
    if (!Number.isInteger(this.roundId) || this.roundId < 1) {
      return false;
    }
    return roundId < this.roundId;
  }

  adoptRoundId(roundId) {
    if (!Number.isInteger(roundId)) {
      return;
    }
    if (!Number.isInteger(this.roundId) || this.roundId < 1 || roundId > this.roundId) {
      this.roundId = roundId;
    }
  }

  async handleHealing() {
    const health = toNumber(this.bot.health);
    if (!Number.isFinite(health) || health > this.config.healThreshold) {
      return false;
    }

    const foodItem = findFood(this.bot);
    const hunger = toNumber(this.bot.food);
    const canEat = Number.isFinite(hunger) ? hunger < 20 : true;
    this.clearCombatControls('low-health');
    this.navigationController.stop('low-health');

    if (foodItem && canEat) {
      this.stats.healAttempts += 1;
      this.transition('HEALING', 'low-health');
      this.persist({
        lastHealAttemptAt: new Date().toISOString(),
        eliminated: false
      });

      try {
        await this.bot.equip(foodItem, 'hand');
        await this.bot.consume();
        this.emitEvent('equipped', {
          item: foodItem.name
        });
        this.persist({
          eliminated: false
        });
        return true;
      } catch (error) {
        const message = String(error && error.message ? error.message : '');
        if (/food is full/i.test(message)) {
          this.persist({
            eliminated: false,
            lastNeedFoodAt: new Date().toISOString()
          });
          return false;
        }
        this.logger.warn(`[${this.username}] failed to consume food`, {
          item: foodItem.name,
          message: error.message
        });
      }
    }

    if (!canEat) {
      // Hunger is full, so eating is impossible right now. Keep fighting.
      this.persist({
        eliminated: false,
        lastNeedFoodAt: new Date().toISOString()
      });
      return false;
    }

    if (this.config.retreatWithoutFood && this.config.retreatToSpawn && this.spawnPoint) {
      this.transition('RETREATING', 'low-health-no-food');
      if (!this.navigationController.isBusy()) {
        this.navigationController.goToCoordinates(this.spawnPoint);
      }
      this.persist({
        lastNeedFoodAt: new Date().toISOString(),
        eliminated: false
      });
      return true;
    }

    if (this.config.retreatWithoutFood) {
      this.transition('HEALING', 'low-health-no-food');
      this.persist({
        lastNeedFoodAt: new Date().toISOString(),
        eliminated: false
      });
      return true;
    }

    return false;
  }

  async ensureCombatLoadout(force) {
    const minimumIntervalMs = force ? 0 : 1500;
    if (Date.now() - this.lastLoadoutCheckAt < minimumIntervalMs) {
      return;
    }

    this.lastLoadoutCheckAt = Date.now();

    await this.tryEquip(() => this.equipBestWeapon());
    await this.tryEquip(() => this.equipArmorPiece('head', ARMOR_PRIORITY.head));
    await this.tryEquip(() => this.equipArmorPiece('torso', ARMOR_PRIORITY.torso));
    await this.tryEquip(() => this.equipArmorPiece('legs', ARMOR_PRIORITY.legs));
    await this.tryEquip(() => this.equipArmorPiece('feet', ARMOR_PRIORITY.feet));
  }

  async tryEquip(fn) {
    try {
      await fn();
    } catch (error) {
      this.logger.warn(`[${this.username}] equip step failed`, {
        message: error.message
      });
    }
  }

  async equipBestWeapon() {
    const current = this.bot.heldItem ? this.bot.heldItem.name : null;
    if (current && WEAPON_PRIORITY.includes(current)) {
      return;
    }

    const weapon = findItemByPriority(this.bot, WEAPON_PRIORITY);
    if (!weapon) {
      return;
    }

    await this.bot.equip(weapon, 'hand');
  }

  async equipArmorPiece(destination, names) {
    const item = findItemByPriority(this.bot, names);
    if (!item) {
      return;
    }

    const slot = armorSlotIndex(destination);
    if (slot === null) {
      return;
    }

    const equipped = this.bot.inventory.slots[slot];
    if (equipped && equipped.name === item.name) {
      return;
    }

    await this.bot.equip(item, destination);
  }

  resolveTarget() {
    const current = this.bot.entities[this.currentTargetId];
    const currentValid = isValidTarget(current, this.bot, this.username, this.config, this.participantUsernames);

    if (currentValid && Date.now() < this.targetLockUntil) {
      return current;
    }

    const candidates = Object.values(this.bot.entities)
      .filter((entity) => isValidTarget(entity, this.bot, this.username, this.config, this.participantUsernames))
      .map((entity) => ({
        entity,
        score: scoreTarget(this.bot, entity, this.currentTargetId)
      }))
      .sort((left, right) => left.score - right.score);

    const best = candidates.length ? candidates[0].entity : null;
    if (!best) {
      return currentValid ? current : null;
    }

    if (!currentValid) {
      return best;
    }

    const currentScore = scoreTarget(this.bot, current, this.currentTargetId);
    const bestScore = scoreTarget(this.bot, best, this.currentTargetId);
    if (best.id !== current.id && bestScore + 0.85 < currentScore) {
      return best;
    }

    return current;
  }

  adoptTarget(target) {
    if (!target) return;

    const isNewTarget = target.id !== this.currentTargetId;
    this.currentTargetId = target.id;
    this.currentTargetUsername = target.username || null;

    if (!isNewTarget) {
      return;
    }

    this.targetLockUntil = Date.now() + (this.config.targetSwitchCooldownMs || 0);
    this.stats.targetSwitches += 1;
    this.emitEvent('engaged_target', {
      roundId: this.roundId,
      target: {
        id: target.id,
        username: target.username || null
      }
    });
  }

  applyCloseRangeMovement(distance) {
    if (!canControlBot(this.bot)) {
      return;
    }

    const preferredDistance = Number.isFinite(this.config.preferredAttackDistance)
      ? this.config.preferredAttackDistance
      : Math.max(2, this.config.attackRange - 1);

    const tooFar = distance > preferredDistance + 0.4;
    const tooClose = distance < Math.max(1.5, preferredDistance - 0.55);

    this.bot.setControlState('sprint', true);
    this.bot.setControlState('forward', tooFar);
    this.bot.setControlState('back', tooClose);

    if (this.config.strafeEnabled) {
      this.updateStrafeDirection();
      const goLeft = this.strafeDirection === 'left' && distance <= this.config.attackRange + 1.2;
      const goRight = this.strafeDirection === 'right' && distance <= this.config.attackRange + 1.2;
      this.bot.setControlState('left', goLeft);
      this.bot.setControlState('right', goRight);
    } else {
      this.bot.setControlState('left', false);
      this.bot.setControlState('right', false);
    }

    this.tryCombatJump(distance);
  }

  updateStrafeDirection() {
    const now = Date.now();
    if (now - this.lastStrafeSwapAt < this.config.strafeSwapIntervalMs) {
      return;
    }

    this.lastStrafeSwapAt = now;
    this.strafeDirection = this.strafeDirection === 'left' ? 'right' : 'left';
  }

  tryCombatJump(distance) {
    if (!canControlBot(this.bot)) return;
    if (!Number.isFinite(this.config.jumpChance) || this.config.jumpChance <= 0) return;
    if (distance > this.config.attackRange + 0.8) return;

    const now = Date.now();
    if (now - this.lastJumpAt < this.config.jumpIntervalMs) {
      return;
    }

    if (Math.random() > this.config.jumpChance) {
      return;
    }

    this.lastJumpAt = now;
    this.bot.setControlState('jump', true);

    if (this.jumpReleaseTimeout) {
      clearTimeout(this.jumpReleaseTimeout);
    }

    this.jumpReleaseTimeout = setTimeout(() => {
      if (canControlBot(this.bot)) {
        this.bot.setControlState('jump', false);
      }
      this.jumpReleaseTimeout = null;
    }, 180);
  }

  clearCombatControls() {
    if (!this.bot) return;

    if (this.jumpReleaseTimeout) {
      clearTimeout(this.jumpReleaseTimeout);
      this.jumpReleaseTimeout = null;
    }

    if (!canControlBot(this.bot)) {
      return;
    }

    for (const control of ['forward', 'back', 'left', 'right', 'jump', 'sprint']) {
      this.bot.setControlState(control, false);
    }
  }

  clearTarget(reason) {
    if (!this.currentTargetId && !this.currentTargetUsername) return;

    this.currentTargetId = null;
    this.currentTargetUsername = null;
    this.targetLockUntil = 0;
    this.persist({
      lastTargetClearReason: reason || 'cleared',
      lastTargetClearAt: new Date().toISOString()
    });
  }

  transition(nextState, reason) {
    if (this.state === nextState && this.reason === reason) return;

    this.state = nextState;
    this.reason = reason || 'unspecified';
    this.lastTransitionAt = new Date().toISOString();

    this.logger.info(`[${this.username}] arena state transition`, {
      to: this.state,
      reason: this.reason,
      roundStatus: this.roundStatus,
      roundId: this.roundId
    });
  }

  persist(extraArena) {
    const vitals = {
      health: toNumber(this.bot.health),
      food: toNumber(this.bot.food),
      alive: !!this.bot.isAlive
    };
    const gear = {
      mainHand: this.bot.heldItem ? this.bot.heldItem.name : null,
      head: getArmorName(this.bot, 'head'),
      torso: getArmorName(this.bot, 'torso'),
      legs: getArmorName(this.bot, 'legs'),
      feet: getArmorName(this.bot, 'feet')
    };

    this.stateStore.upsertBotState(this.username, {
      vitals,
      gear,
      ai: {
        state: this.state,
        reason: this.reason,
        lastTransitionAt: this.lastTransitionAt
      },
      arena: {
        enabled: this.enabled,
        roundId: this.roundId,
        roundStatus: this.roundStatus,
        state: this.state,
        reason: this.reason,
        eliminated: this.eliminated,
        spawnPoint: this.spawnPoint,
        participantUsernames: this.participantUsernames.slice(),
        target: this.currentTargetId
          ? {
              id: this.currentTargetId,
              username: this.currentTargetUsername
            }
          : null,
        stats: { ...this.stats },
        updatedAt: new Date().toISOString(),
        ...(extraArena || {})
      }
    });
  }
}

function createStats() {
  return {
    kills: 0,
    deaths: 0,
    damageTaken: 0,
    targetSwitches: 0,
    healAttempts: 0
  };
}

function findFood(bot) {
  return bot.inventory.items().find((item) => FOOD_NAME_MATCHERS.some((matcher) => item.name.includes(matcher))) || null;
}

function findItemByPriority(bot, names) {
  for (const name of names) {
    const item = bot.inventory.items().find((entry) => entry.name === name);
    if (item) {
      return item;
    }
  }

  return null;
}

function isValidTarget(entity, bot, selfUsername, config, participantUsernames) {
  if (!entity || !entity.position) return false;
  if (entity.type !== 'player') return false;
  if (!entity.username || entity.username === selfUsername) return false;
  if (Array.isArray(participantUsernames) && participantUsernames.length && !participantUsernames.includes(entity.username)) {
    return false;
  }
  if (!bot || !bot.entity) return false;
  if (bot.entity.position.distanceTo(entity.position) > config.searchRadius) return false;
  if (config.targetPlayersOnly === false) return true;
  return true;
}

function scoreTarget(bot, entity, currentTargetId) {
  const distance = bot.entity.position.distanceTo(entity.position);
  const health = toNumber(entity.health);
  let score = distance;

  if (Number.isFinite(health)) {
    score -= (20 - clamp(health, 0, 20)) * 0.28;
  }

  if (entity.id === currentTargetId) {
    score -= 0.25;
  }

  return score;
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function toNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function vec3Like(position) {
  return {
    x: position.x,
    y: position.y,
    z: position.z
  };
}

function isCoordinateTriple(value) {
  return !!value
    && Number.isFinite(value.x)
    && Number.isFinite(value.y)
    && Number.isFinite(value.z);
}

function normalizeParticipants(usernames) {
  return Array.isArray(usernames) ? usernames.filter((value) => typeof value === 'string') : [];
}

function armorSlotIndex(destination) {
  switch (destination) {
    case 'head':
      return 5;
    case 'torso':
      return 6;
    case 'legs':
      return 7;
    case 'feet':
      return 8;
    default:
      return null;
  }
}

function waitForRespawn(bot, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    };
    const onRespawn = () => finish(resolve);
    const onSpawn = () => finish(resolve);
    const timer = setTimeout(() => {
      finish(reject, new Error('manual_respawn_timeout'));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      bot.off('respawn', onRespawn);
      bot.off('spawn', onSpawn);
    };

    bot.on('respawn', onRespawn);
    bot.on('spawn', onSpawn);
  });
}

function getArmorName(bot, destination) {
  const slot = armorSlotIndex(destination);
  if (slot === null || !bot || !bot.inventory || !Array.isArray(bot.inventory.slots)) {
    return null;
  }

  const item = bot.inventory.slots[slot];
  return item ? item.name : null;
}

function canControlBot(bot) {
  return !!(bot && typeof bot.setControlState === 'function');
}

module.exports = {
  ArenaCombatController
};
