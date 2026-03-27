'use strict';

const { pathfinder, Movements, goals } = require('mineflayer-pathfinder');

class NavigationController {
  constructor(bot, options) {
    this.bot = bot;
    this.logger = options.logger;
    this.stateStore = options.stateStore;
    this.username = options.username;
    this.navigation = options.navigation;
    this.goalTimeout = null;
    this.currentTask = null;
    this.lastProgressAt = 0;
    this.lastProgressPosition = null;
    this.stuckInterval = null;
    this.recoveryAttempts = 0;
    this.lastRecoveryAt = 0;
    this.lastFollowLogAt = 0;
    this.lastFollowLogKey = '';

    this.bot.loadPlugin(pathfinder);
  }

  setup() {
    this.bot.once('spawn', () => {
      const movements = new Movements(this.bot);
      movements.canDig = !!this.navigation.allowDig;
      this.bot.pathfinder.setMovements(movements);
      this.logger.info(`[${this.username}] navigation ready`, {
        allowDig: movements.canDig,
        home: this.navigation.home
      });
      this.startStuckMonitor();
    });

    this.bot.on('goal_reached', () => {
      this.logger.info(`[${this.username}] goal reached`, {
        task: this.currentTask ? this.currentTask.type : 'unknown'
      });
      this.clearGoalTimeout();
      this.stateStore.upsertBotState(this.username, {
        navigationTask: null,
        navigationStatus: 'idle'
      });
      this.currentTask = null;
      this.lastProgressPosition = null;
      this.recoveryAttempts = 0;
      this.bot.emit('navigation_controller_idle');
    });

    this.bot.on('path_reset', (reason) => {
      if (!this.currentTask) return;

      if (reason === 'goal_updated' || reason === 'chunk_loaded' || reason === 'goal_moved') return;

      this.logger.debug(`[${this.username}] path reset`, {
        task: this.currentTask.type,
        reason
      });
    });

    this.bot.on('path_update', (result) => {
      if (!this.currentTask) return;

      if (result.status === 'success' || result.status === 'partial') {
        this.markProgress();
      }

      if (result.status === 'noPath') {
        this.failCurrentTask('noPath');
      }
    });

    this.bot.on('move', () => {
      if (!this.currentTask || !this.bot.entity) return;

      if (!this.lastProgressPosition) {
        this.markProgress();
        return;
      }

      const moved = this.bot.entity.position.distanceTo(this.lastProgressPosition);
      if (moved >= this.navigation.progressMinDistance) {
        this.markProgress();
      }
    });
  }

  goToCoordinates(target) {
    if (!this.bot.pathfinder) return;

    const goal = new goals.GoalNear(target.x, target.y, target.z, 1);
    this.currentTask = {
      type: 'go_to',
      target
    };
    this.recoveryAttempts = 0;

    this.logger.info(`[${this.username}] go_to`, target);
    this.stateStore.upsertBotState(this.username, {
      navigationTask: this.currentTask,
      navigationStatus: 'moving'
    });

    this.bot.pathfinder.setGoal(goal);
    this.startGoalTimeout();
    this.markProgress();
  }

  followPlayer(playerName) {
    const player = this.bot.players[playerName];
    if (!player || !player.entity) {
      this.logger.warn(`[${this.username}] follow failed`, {
        player: playerName,
        reason: 'player-not-visible'
      });
      this.stateStore.upsertBotState(this.username, {
        navigationTask: null,
        navigationStatus: 'follow_failed',
        lastNavigationFailure: 'player-not-visible'
      });
      return;
    }

    this.currentTask = {
      type: 'follow',
      player: playerName
    };
    this.recoveryAttempts = 0;

    const goal = new goals.GoalFollow(player.entity, this.navigation.followDistance);
    this.logger.info(`[${this.username}] follow`, {
      player: playerName,
      distance: this.navigation.followDistance
    });

    this.stateStore.upsertBotState(this.username, {
      navigationTask: this.currentTask,
      navigationStatus: 'following'
    });

    this.bot.pathfinder.setGoal(goal, true);
    this.clearGoalTimeout();
    this.markProgress();
  }

  followEntity(entity, distance) {
    if (!entity || !entity.position) {
      this.logger.warn(`[${this.username}] follow entity failed`, {
        reason: 'entity-not-visible'
      });
      this.stateStore.upsertBotState(this.username, {
        navigationTask: null,
        navigationStatus: 'follow_failed',
        lastNavigationFailure: 'entity-not-visible'
      });
      return;
    }

    const followDistance = Number.isFinite(distance) ? distance : this.navigation.followDistance;
    this.currentTask = {
      type: 'follow_entity',
      entityId: entity.id,
      entityUsername: entity.username || null,
      distance: followDistance
    };
    this.recoveryAttempts = 0;

    const goal = new goals.GoalFollow(entity, followDistance);
    this.logFollowEntity(entity, followDistance);

    this.stateStore.upsertBotState(this.username, {
      navigationTask: this.currentTask,
      navigationStatus: 'following_entity'
    });

    this.bot.pathfinder.setGoal(goal, true);
    this.clearGoalTimeout();
    this.markProgress();
  }

  returnHome() {
    if (!this.navigation.home.enabled) {
      this.logger.warn(`[${this.username}] home disabled`);
      return;
    }

    this.goToCoordinates({
      x: this.navigation.home.x,
      y: this.navigation.home.y,
      z: this.navigation.home.z
    });
  }

  stop(reason) {
    this.clearGoalTimeout();
    this.currentTask = null;
    this.lastProgressPosition = null;
    this.lastProgressAt = 0;
    this.recoveryAttempts = 0;

    if (this.bot.pathfinder) {
      this.bot.pathfinder.setGoal(null);
    }

    this.stateStore.upsertBotState(this.username, {
      navigationTask: null,
      navigationStatus: reason || 'stopped'
    });
  }

  isBusy() {
    return !!this.currentTask;
  }

  getCurrentTask() {
    return this.currentTask;
  }

  logFollowEntity(entity, followDistance) {
    const key = `${entity.id}:${entity.username || ''}:${followDistance}`;
    const now = Date.now();
    if (this.lastFollowLogKey === key && now - this.lastFollowLogAt < 1500) {
      return;
    }

    this.lastFollowLogKey = key;
    this.lastFollowLogAt = now;

    this.logger.info(`[${this.username}] follow entity`, {
      entityId: entity.id,
      username: entity.username || null,
      distance: followDistance
    });
  }

  startStuckMonitor() {
    if (this.stuckInterval) {
      clearInterval(this.stuckInterval);
    }

    this.stuckInterval = setInterval(() => {
      if (!this.currentTask) return;
      if (!this.lastProgressAt) return;
      if (this.currentTask.type === 'follow' || this.currentTask.type === 'follow_entity') return;

      const stalledFor = Date.now() - this.lastProgressAt;
      if (stalledFor >= this.navigation.stuckTimeoutMs) {
        this.tryRecoverOrFail('stuck-timeout');
      }
    }, 1000);
  }

  startGoalTimeout() {
    this.clearGoalTimeout();

    if (this.currentTask && (this.currentTask.type === 'follow' || this.currentTask.type === 'follow_entity')) {
      return;
    }

    this.goalTimeout = setTimeout(() => {
      this.failCurrentTask('goal-timeout');
    }, this.navigation.goalReachTimeoutMs);
  }

  clearGoalTimeout() {
    if (this.goalTimeout) {
      clearTimeout(this.goalTimeout);
      this.goalTimeout = null;
    }
  }

  failCurrentTask(reason) {
    if (!this.currentTask) return;

    this.logger.warn(`[${this.username}] navigation failed`, {
      task: this.currentTask,
      reason
    });

    this.stateStore.upsertBotState(this.username, {
      navigationTask: null,
      navigationStatus: 'failed',
      lastNavigationFailure: reason
    });

    this.bot.emit('navigation_controller_failed', reason);
    this.currentTask = null;
    this.lastProgressPosition = null;
    this.lastProgressAt = 0;
    this.recoveryAttempts = 0;
    this.clearGoalTimeout();
    this.bot.pathfinder.setGoal(null);
  }

  markProgress() {
    this.lastProgressAt = Date.now();
    this.recoveryAttempts = 0;
    if (this.bot.entity) {
      this.lastProgressPosition = this.bot.entity.position.clone();
    }
  }

  tryRecoverOrFail(reason) {
    if (!this.currentTask) return;

    const now = Date.now();
    if (now - this.lastRecoveryAt < this.navigation.repathCooldownMs) {
      return;
    }

    if (this.recoveryAttempts >= this.navigation.maxRecoveryAttempts) {
      this.failCurrentTask(reason);
      return;
    }

    this.recoveryAttempts += 1;
    this.lastRecoveryAt = now;
    this.logger.warn(`[${this.username}] attempting navigation recovery`, {
      task: this.currentTask,
      reason,
      attempt: this.recoveryAttempts
    });

    this.stateStore.upsertBotState(this.username, {
      navigationRecovery: {
        attempt: this.recoveryAttempts,
        reason,
        lastRecoveryAt: new Date().toISOString()
      }
    });

    if (this.recoveryAttempts === 1) {
      this.repathCurrentGoal();
      return;
    }

    if (this.recoveryAttempts === 2) {
      this.tryJumpRecovery();
      this.repathCurrentGoal();
      return;
    }

    this.trySideStepRecovery();
    this.repathCurrentGoal();
  }

  repathCurrentGoal() {
    if (!this.currentTask) return;

    if (this.currentTask.type === 'go_to') {
      this.goToCoordinates(this.currentTask.target);
      return;
    }

    if (this.currentTask.type === 'follow') {
      this.followPlayer(this.currentTask.player);
      return;
    }

    if (this.currentTask.type === 'follow_entity') {
      const entity = this.bot.entities[this.currentTask.entityId];
      if (entity) {
        this.followEntity(entity, this.currentTask.distance);
      }
    }
  }

  tryJumpRecovery() {
    this.bot.setControlState('jump', true);
    setTimeout(() => {
      this.bot.setControlState('jump', false);
    }, 250);
  }

  trySideStepRecovery() {
    const direction = this.recoveryAttempts % 2 === 0 ? 'left' : 'right';
    this.bot.setControlState(direction, true);
    setTimeout(() => {
      this.bot.setControlState(direction, false);
    }, 500);
    this.tryJumpRecovery();
  }
}

module.exports = {
  NavigationController
};
