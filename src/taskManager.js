'use strict';

class TaskManager {
  constructor(options) {
    this.username = options.username;
    this.role = options.role || 'collector';
    this.roles = options.roles || {};
    this.logger = options.logger;
    this.stateStore = options.stateStore;
    this.navigationController = options.navigationController;
    this.survivalController = options.survivalController;
    this.buildController = options.buildController;
    this.config = options.tasks;
    this.survival = options.survival;

    this.queue = [];
    this.currentTask = null;
    this.counter = 0;
    this.lastFailureAtByType = new Map();
    this.failureCountByType = new Map();
  }

  enqueue(taskInput) {
    if (!this.config.enabled) return null;
    if (this.queue.length >= this.config.maxQueueSize) {
      this.logger.warn(`[${this.username}] task queue full`, { maxQueueSize: this.config.maxQueueSize });
      return null;
    }

    const task = {
      id: `${this.username}-task-${++this.counter}`,
      type: taskInput.type,
      payload: taskInput.payload || {},
      priority: taskInput.priority || 50,
      retries: taskInput.retries || 0,
      source: taskInput.source || 'manual',
      status: 'created',
      createdAt: new Date().toISOString()
    };

    this.queue.push(task);
    this.sortQueue();
    this.persist();
    this.logger.info(`[${this.username}] task enqueued`, task);
    return task;
  }

  ensureTask(taskInput) {
    const exists = (this.currentTask && this.matches(this.currentTask, taskInput))
      || this.queue.some((task) => this.matches(task, taskInput));
    if (exists) return null;
    return this.enqueue(taskInput);
  }

  tick() {
    if (!this.config.enabled) return;
    if (this.currentTask && this.isTaskTimedOut(this.currentTask)) {
      this.failCurrentTask('task-timeout');
    }
    if (this.currentTask) return;
    this.planAutonomousTasks();
    if (!this.queue.length) return;

    this.currentTask = this.queue.shift();
    this.currentTask.status = 'running';
    this.currentTask.startedAt = new Date().toISOString();
    this.currentTask.lastProgressAt = new Date().toISOString();
    this.currentTask.blockedReason = null;
    this.persist();
    this.logger.info(`[${this.username}] task started`, this.currentTask);
    this.executeCurrentTask();
  }

  handleNavigationIdle() {
    if (!this.currentTask) return;
    if (this.currentTask.type === 'go_to' || this.currentTask.type === 'return_home') {
      this.completeCurrentTask('navigation-complete');
    }
  }

  handleNavigationFailure(reason) {
    if (!this.currentTask) return;
    this.markTaskBlocked(`navigation:${reason || 'failed'}`);
    if (this.currentTask.type === 'go_to' || this.currentTask.type === 'return_home') {
      this.failCurrentTask(reason || 'navigation-failed');
    }
  }

  handleSurvivalAction(action) {
    if (!this.currentTask) return;
    if (this.currentTask.type === 'collect_wood') {
      this.markTaskProgress(`survival:${action}`);
      if (action === 'retreating' || action === 'low_health_wait' || action === 'low_health_no_home') {
        this.failCurrentTask('blocked-by-low-health');
        return;
      }

      const snapshot = this.survivalController.getResourceSnapshot();
      const targetWoodUnits = this.currentTask.payload.targetWoodUnits || 0;
      if (snapshot.woodUnits >= targetWoodUnits) {
        this.completeCurrentTask('wood-goal-reached');
        return;
      }

      if (action === 'searching_wood_failed') {
        this.failCurrentTask('wood-not-found');
      }
    }
  }

  clearQueue(reason) {
    if (this.currentTask) {
      this.failCurrentTask(reason || 'queue-cleared');
    }

    for (const task of this.queue) {
      task.status = 'cancelled';
      task.completedAt = new Date().toISOString();
      task.result = reason || 'queue-cleared';
    }

    this.queue = [];
    this.persist();
  }

  getSnapshot() {
    return {
      currentTask: this.currentTask,
      queue: this.queue
    };
  }

  executeCurrentTask() {
    if (!this.currentTask) return;

    switch (this.currentTask.type) {
      case 'go_to':
        this.navigationController.goToCoordinates(this.currentTask.payload);
        break;
      case 'return_home':
        this.navigationController.returnHome();
        break;
      case 'collect_wood': {
        const snapshot = this.survivalController.getResourceSnapshot();
        const roleGoal = this.role === 'collector'
          ? Math.max(this.survival.woodGoal, this.roles.collectorWoodGoal || 0)
          : this.survival.woodGoal;
        const targetWoodUnits = this.currentTask.source === 'manual'
          ? snapshot.woodUnits + 1
          : Math.max(snapshot.woodUnits + 1, roleGoal);
        this.currentTask.payload = {
          ...this.currentTask.payload,
          startWoodUnits: snapshot.woodUnits,
          targetWoodUnits
        };
        this.persist();
        this.survivalController.requestImmediateTick('task-collect-wood');
        break;
      }
      case 'build_template':
        this.buildController.startTemplate(this.currentTask.payload.template, this.currentTask.payload.origin)
          .then((result) => {
            if (!this.currentTask || this.currentTask.type !== 'build_template') return;
            if (result.ok) {
              this.completeCurrentTask('build-complete');
            } else {
              this.failCurrentTask(result.error || 'build-failed');
            }
          })
          .catch((error) => {
            if (!this.currentTask || this.currentTask.type !== 'build_template') return;
            this.failCurrentTask(error.message);
          });
        break;
      default:
        this.failCurrentTask('unknown-task-type');
        break;
    }
  }

  completeCurrentTask(result) {
    if (!this.currentTask) return;
    this.failureCountByType.set(this.currentTask.type, 0);
    this.currentTask.status = 'completed';
    this.currentTask.completedAt = new Date().toISOString();
    this.currentTask.result = result || 'completed';
    this.logger.info(`[${this.username}] task completed`, this.currentTask);
    this.currentTask = null;
    this.persist();
  }

  failCurrentTask(result) {
    if (!this.currentTask) return;
    this.lastFailureAtByType.set(this.currentTask.type, Date.now());
    this.failureCountByType.set(
      this.currentTask.type,
      (this.failureCountByType.get(this.currentTask.type) || 0) + 1
    );
    this.currentTask.status = 'failed';
    this.currentTask.completedAt = new Date().toISOString();
    this.currentTask.result = result || 'failed';
    this.logger.warn(`[${this.username}] task failed`, this.currentTask);
    const failedTask = this.currentTask;
    this.currentTask = null;
    this.persist();
    this.retryTaskIfNeeded(failedTask);
  }

  persist() {
    this.stateStore.upsertBotState(this.username, {
      tasks: {
        currentTask: this.currentTask,
        queue: this.queue
      }
    });
  }

  markTaskProgress(reason) {
    if (!this.currentTask) return;
    this.currentTask.lastProgressAt = new Date().toISOString();
    this.currentTask.blockedReason = null;
    this.currentTask.lastProgressReason = reason || 'progress';
    this.persist();
  }

  markTaskBlocked(reason) {
    if (!this.currentTask) return;
    this.currentTask.blockedReason = reason || 'blocked';
    this.persist();
  }

  sortQueue() {
    this.queue.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  }

  matches(task, taskInput) {
    return task.type === taskInput.type && JSON.stringify(task.payload || {}) === JSON.stringify(taskInput.payload || {});
  }

  planAutonomousTasks() {
    if (!this.config.autoSurvivalTasks) return;
    if (this.currentTask || this.queue.length) return;
    if (this.navigationController.isBusy()) return;
    if (this.survivalController.bot.health && this.survivalController.bot.health <= this.survival.retreatHealthThreshold) return;
    if (this.role !== 'collector') return;

    const lastWoodFailureAt = this.lastFailureAtByType.get('collect_wood') || 0;
    const cooldownActive = Date.now() - lastWoodFailureAt < this.config.failureCooldownMs;
    const repeatedFailures = this.failureCountByType.get('collect_wood') || 0;

    if (!cooldownActive && repeatedFailures < 3 && this.survivalController.needsWood()) {
      this.enqueue({
        type: 'collect_wood',
        priority: 30,
        source: 'autonomous'
      });
    }
  }

  retryTaskIfNeeded(task) {
    if (!this.config.retryFailedTasks) return;
    if (!task) return;
    if (task.retries >= this.config.maxRetries) return;
    if (!['go_to', 'return_home', 'collect_wood', 'build_template'].includes(task.type)) return;
    if (task.type === 'collect_wood' && this.survivalController.bot.health && this.survivalController.bot.health <= this.survival.retreatHealthThreshold) {
      return;
    }

    const retriedTask = {
      type: task.type,
      payload: task.payload,
      priority: task.priority,
      retries: task.retries + 1,
      source: task.source || 'retry'
    };

    setTimeout(() => {
      this.enqueue(retriedTask);
    }, this.config.failureCooldownMs);
  }

  isTaskTimedOut(task) {
    if (!task || !task.startedAt) return false;
    return Date.now() - new Date(task.startedAt).getTime() >= this.config.taskTimeoutMs;
  }
}

module.exports = {
  TaskManager
};
