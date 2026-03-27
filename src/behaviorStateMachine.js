'use strict';

class BehaviorStateMachine {
  constructor(options) {
    this.bot = options.bot;
    this.username = options.username;
    this.logger = options.logger;
    this.stateStore = options.stateStore;
    this.navigationController = options.navigationController;
    this.survivalController = options.survivalController;
    this.taskManager = options.taskManager;
    this.navigation = options.navigation;
    this.survival = options.survival;
    this.tasks = options.tasks;
    this.config = options.stateMachine;

    this.state = 'booting';
    this.reason = 'startup';
    this.interval = null;
    this.lastTransitionAt = null;
    this.manualUntil = 0;
  }

  setup() {
    if (!this.config.enabled) return;

    this.bot.once('spawn', () => {
      this.transition('idle', 'spawn');
      this.interval = setInterval(() => this.tick(), this.config.tickIntervalMs);
    });
  }

  stop(reason) {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    this.transition('stopped', reason || 'stop');
  }

  markManualNavigation(reason) {
    this.manualUntil = Date.now() + this.config.idleGraceMs;
    this.transition('manual_navigation', reason || 'manual-command');
  }

  tick() {
    if (!this.bot.entity) return;

    if (this.bot.health && this.bot.health <= this.survival.retreatHealthThreshold) {
      if (this.state !== 'flee' && this.state !== 'return_home') {
        this.transition('flee', 'low-health');
        this.navigationController.returnHome();
      }
      return;
    }

    if (Date.now() < this.manualUntil) {
      if (this.state !== 'manual_navigation') {
        this.transition('manual_navigation', 'manual-active');
      }
      return;
    }

    if (this.navigationController.isBusy()) {
      if (this.state !== 'manual_navigation' && this.state !== 'return_home') {
        this.transition('manual_navigation', 'navigation-active');
      }
      return;
    }

    if (this.tasks.enabled && this.taskManager) {
      const snapshot = this.taskManager.getSnapshot();
      if (snapshot.currentTask) {
        this.transition('task_running', snapshot.currentTask.type);
        return;
      }
    }

    if (this.survival.enabled) {
      if (!this.survivalController.isRunning()) {
        this.survivalController.start();
      }

      const survivalSnapshot = this.survivalController.getSnapshot();
      if (survivalSnapshot && survivalSnapshot.lastAction === 'retreating') {
        this.transition('return_home', 'survival-retreat');
        return;
      }

      this.transition('survive', survivalSnapshot ? survivalSnapshot.lastAction || 'survival-loop' : 'survival-loop');
      return;
    }

    this.transition('idle', 'no-active-system');
  }

  transition(nextState, reason) {
    if (this.state === nextState && this.reason === reason) return;

    const previous = this.state;
    this.state = nextState;
    this.reason = reason;
    this.lastTransitionAt = new Date().toISOString();

    this.logger.info(`[${this.username}] state transition`, {
      from: previous,
      to: nextState,
      reason
    });

    this.stateStore.upsertBotState(this.username, {
      ai: {
        state: nextState,
        reason,
        lastTransitionAt: this.lastTransitionAt
      }
    });
  }
}

module.exports = {
  BehaviorStateMachine
};
