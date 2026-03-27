'use strict';

const PARTICIPANT_READY_TIMEOUT_MS = 120000;

class ArenaController {
  constructor(options) {
    this.config = options.arena || {};
    this.logger = options.logger;
    this.stateStore = options.stateStore;
    this.botManager = options.botManager;
    this.rconClient = options.rconClient;
    this.datapackManager = options.datapackManager || null;
    this.roundId = 0;
    this.recentEvents = [];
    this.finalizingRound = false;
    this.autoPrepareTimeout = null;
    this.autoStartTimeout = null;
    this.winnerInterval = null;
    this.eliminatedUsernames = new Set();
    this.currentRoundParticipants = [];
    this.currentRoundPlayers = [];
    this.activeControlCommand = null;
    this.loginRecoveryQueue = new Set();
    this.loginRecoveryTimer = null;

    this.syncState({
      status: this.config.enabled ? 'idle' : 'disabled',
      enabled: !!this.config.enabled,
      roundId: this.roundId,
      recentEvents: [],
      winner: null,
      requestedBotCount: 0,
      playerUsernames: [],
      launchStatus: {
        state: 'idle'
      },
      serverControl: {
        enabled: !!(this.config.serverControl && this.config.serverControl.enabled),
        rconEnabled: !!(this.rconClient && this.rconClient.isEnabled())
      }
    });

    if (this.config.enabled) {
      this.winnerInterval = setInterval(() => {
        this.checkRoundOutcome().catch((error) => {
          this.logger.error('[arena] round outcome check failed', {
            message: error.message
          });
        });
      }, this.config.winnerCheckIntervalMs);
    }
  }

  async runCommand(command, args) {
    if (this.activeControlCommand && command !== 'shutdown') {
      return {
        ok: false,
        error: 'arena_command_in_progress',
        activeCommand: this.activeControlCommand
      };
    }

    this.activeControlCommand = command;
    switch (command) {
      case 'launch_match':
        return this.withCommandGuard(() => this.launchMatch(args || {}));
      case 'prepare_round':
        return this.withCommandGuard(() => this.prepareRound(args || {}));
      case 'start_round':
        return this.withCommandGuard(() => this.startRound(args || {}));
      case 'stop_round':
        return this.withCommandGuard(() => this.stopRound(args || {}));
      case 'reset_position':
        return this.withCommandGuard(() => this.resetPosition(args || {}));
      case 'shutdown':
        return this.withCommandGuard(() => this.shutdown(args || {}));
      default:
        this.activeControlCommand = null;
        return { ok: false, error: 'unknown_arena_command' };
    }
  }

  async launchMatch(args) {
    this.clearAutoRoundTimers();
    await this.ensureRosterForArgs(args || {});
    const participantUsernames = this.resolveParticipantUsernames(args, this.currentRoundParticipants, {
      defaultToAll: true
    });
    const playerUsernames = this.resolvePlayerUsernames(args);
    if (!participantUsernames.length) {
      const result = { ok: false, error: 'no_participants_selected' };
      this.syncState({
        launchStatus: {
          state: 'error',
          message: result.error,
          at: new Date().toISOString()
        }
      });
      return result;
    }

    const inactiveUsernames = this.getInactiveParticipants(participantUsernames);
    this.syncState({
      launchStatus: {
        state: 'launching',
        botCount: participantUsernames.length,
        playerCount: playerUsernames.length,
        at: new Date().toISOString()
      },
      requestedBotCount: participantUsernames.length,
      playerUsernames: playerUsernames.slice()
    });

    if (inactiveUsernames.length) {
      await this.botManager.runArenaCommand('stop_round', {
        reason: 'not-selected-for-match',
        participantUsernames: inactiveUsernames
      });
    }

    const prepare = await this.prepareRound({
      ...args,
      participantUsernames,
      playerUsernames
    });

    if (!prepare.ok) {
      this.syncState({
        launchStatus: {
          state: 'error',
          botCount: participantUsernames.length,
          playerCount: playerUsernames.length,
          at: new Date().toISOString(),
          message: 'prepare_failed'
        }
      });

      return {
        ok: false,
        prepare,
        participantUsernames,
        playerUsernames
      };
    }

    await delay(this.getLaunchStartDelayMs());

    const start = await this.startRound({
      ...args,
      participantUsernames,
      playerUsernames
    });

    const ok = !!(prepare.ok && start.ok);
    this.syncState({
      launchStatus: {
        state: ok ? 'started' : 'error',
        botCount: participantUsernames.length,
        playerCount: playerUsernames.length,
        at: new Date().toISOString(),
        message: ok ? 'match_started' : 'match_start_failed'
      }
    });

    return {
      ok,
      prepare,
      start,
      participantUsernames,
      playerUsernames
    };
  }

  async prepareRound(args) {
    const startedAt = Date.now();
    this.clearAutoRoundTimers();
    this.finalizingRound = false;
    await this.ensureRosterForArgs(args || {});
    this.roundId = Number.isInteger(args.roundId) ? args.roundId : this.roundId + 1;
    this.eliminatedUsernames.clear();
    this.currentRoundParticipants = this.resolveParticipantUsernames(args, this.currentRoundParticipants, {
      defaultToAll: true
    });
    this.currentRoundPlayers = this.resolvePlayerUsernames(args, this.currentRoundPlayers);

    if (!this.currentRoundParticipants.length) {
      return { ok: false, error: 'no_participants_selected' };
    }

    this.logger.info('[arena] prepare round started', {
      roundId: this.roundId,
      participantCount: this.currentRoundParticipants.length,
      playerCount: this.currentRoundPlayers.length
    });

    await this.botManager.ensureParticipantsOnline(this.currentRoundParticipants);
    const readiness = await this.botManager.waitForParticipantsReady(
      this.currentRoundParticipants,
      PARTICIPANT_READY_TIMEOUT_MS
    );
    if (!readiness.ok) {
      return {
        ok: false,
        error: 'participants_not_ready',
        unavailable: readiness.unavailable
      };
    }

    const inactiveUsernames = this.getInactiveParticipants(this.currentRoundParticipants);
    if (inactiveUsernames.length) {
      await this.botManager.runArenaCommand('stop_round', {
        reason: 'not-selected-for-match',
        participantUsernames: inactiveUsernames
      });
    }

    const workerPreparePromise = this.botManager.runArenaCommand('prepare_round', {
      ...args,
      roundId: this.roundId,
      participantUsernames: this.currentRoundParticipants
    });
    const orchestrationPromise = this.shouldUseRuntimeDatapack()
      ? this.runRuntimePreparePhase(this.roundId, this.currentRoundParticipants, this.currentRoundPlayers)
      : this.runLegacyPreparePhase(this.roundId, this.currentRoundParticipants, this.currentRoundPlayers);

    const [result, orchestration] = await Promise.all([
      workerPreparePromise,
      orchestrationPromise
    ]);
    const workerOk = isWorkerBatchSuccessful(result);

    const resetWorkers = orchestration.ok
      ? await this.botManager.runArenaCommand('reset_position', {
          ...args,
          roundId: this.roundId,
          participantUsernames: this.currentRoundParticipants
        })
      : {
          ok: false,
          skipped: true,
          error: 'server_prepare_failed'
        };
    const resetOk = isWorkerBatchSuccessful(resetWorkers);
    const ok = !!(orchestration.ok && workerOk && resetOk);
    const durationMs = Date.now() - startedAt;

    this.logger.info('[arena] prepare round completed', {
      roundId: this.roundId,
      ok,
      durationMs,
      workerPrepareOk: workerOk,
      serverPrepareOk: !!orchestration.ok,
      workerResetOk: resetOk,
      workerPrepareError: workerOk ? null : getWorkerBatchError(result),
      serverPrepareError: orchestration.ok ? null : (orchestration.error || 'server_prepare_failed'),
      workerResetError: resetOk ? null : getWorkerBatchError(resetWorkers)
    });

    this.syncState({
      status: 'preparing',
      roundId: this.roundId,
      winner: null,
      nextRound: null,
      requestedBotCount: this.currentRoundParticipants.length,
      eliminatedUsernames: [],
      participantUsernames: this.currentRoundParticipants.slice(),
      playerUsernames: this.currentRoundPlayers.slice(),
      lastCommand: 'prepare_round',
      lastCommandAt: new Date().toISOString(),
      lastServerPhase: orchestration,
      lastWorkerPhase: {
        prepare: result,
        reset: resetWorkers
      },
      launchStatus: {
        state: ok ? 'prepared' : 'error',
        botCount: this.currentRoundParticipants.length,
        playerCount: this.currentRoundPlayers.length,
        at: new Date().toISOString(),
        message: ok ? 'round_prepared' : (orchestration.error || getWorkerBatchError(resetWorkers) || 'prepare_round_failed')
      }
    });

    return {
      ok,
      error: ok ? null : 'prepare_round_failed',
      orchestration,
      workers: {
        prepare: result,
        reset: resetWorkers
      }
    };
  }

  async startRound(args) {
    this.clearAutoRoundTimers();
    this.finalizingRound = false;
    await this.ensureRosterForArgs(args || {});

    if (this.roundId < 1) {
      this.roundId = 1;
    }

    this.eliminatedUsernames.clear();
    this.currentRoundParticipants = this.resolveParticipantUsernames(args, this.currentRoundParticipants, {
      defaultToAll: true
    });
    this.currentRoundPlayers = this.resolvePlayerUsernames(args, this.currentRoundPlayers);
    if (!this.currentRoundParticipants.length) {
      return { ok: false, error: 'no_participants_selected' };
    }

    await this.botManager.ensureParticipantsOnline(this.currentRoundParticipants);
    const readiness = await this.botManager.waitForParticipantsReady(
      this.currentRoundParticipants,
      PARTICIPANT_READY_TIMEOUT_MS
    );
    if (!readiness.ok) {
      return {
        ok: false,
        error: 'participants_not_ready',
        unavailable: readiness.unavailable
      };
    }

    const orchestration = this.shouldUseRuntimeDatapack()
      ? await this.runRuntimeFunctionPhase('start_round', this.roundId, this.currentRoundParticipants, this.currentRoundPlayers)
      : await this.runLegacyStartPhase(this.roundId, this.currentRoundParticipants, this.currentRoundPlayers);
    const result = orchestration.ok
      ? await this.botManager.runArenaCommand('start_round', {
          ...args,
          roundId: this.roundId,
          participantUsernames: this.currentRoundParticipants
        })
      : {
          ok: false,
          skipped: true,
          error: 'server_start_failed'
        };
    const workerOk = isWorkerBatchSuccessful(result);
    const ok = !!(orchestration.ok && workerOk);

    this.syncState({
      status: 'running',
      roundId: this.roundId,
      winner: null,
      nextRound: null,
      requestedBotCount: this.currentRoundParticipants.length,
      eliminatedUsernames: [],
      participantUsernames: this.currentRoundParticipants.slice(),
      playerUsernames: this.currentRoundPlayers.slice(),
      startedAt: new Date().toISOString(),
      lastCommand: 'start_round',
      lastCommandAt: new Date().toISOString(),
      lastServerPhase: orchestration,
      lastWorkerPhase: result,
      launchStatus: {
        state: ok ? 'started' : 'error',
        botCount: this.currentRoundParticipants.length,
        playerCount: this.currentRoundPlayers.length,
        at: new Date().toISOString(),
        message: ok ? 'round_started' : (orchestration.error || getWorkerBatchError(result) || 'start_round_failed')
      }
    });

    return {
      ok,
      error: ok ? null : 'start_round_failed',
      orchestration,
      workers: result
    };
  }

  async stopRound(args) {
    this.clearAutoRoundTimers();
    this.finalizingRound = false;
    const targetParticipants = this.resolveParticipantUsernames(args, this.currentRoundParticipants, {
      defaultToAll: true
    });
    const targetPlayers = this.resolvePlayerUsernames(args, this.currentRoundPlayers);
    const [result, orchestration] = await Promise.all([
      this.botManager.runArenaCommand('stop_round', {
        ...args,
        roundId: this.roundId,
        participantUsernames: targetParticipants
      }),
      this.shouldUseRuntimeDatapack()
        ? this.runRuntimeFunctionPhase('stop_round', this.roundId, targetParticipants, targetPlayers)
        : this.runServerPhase('stop', this.roundId, {
            participantUsernames: targetParticipants,
            playerUsernames: targetPlayers
          })
    ]);
    const ok = !!(orchestration.ok && isWorkerBatchSuccessful(result));

    this.syncState({
      status: 'stopped',
      roundId: this.roundId,
      winner: null,
      nextRound: null,
      requestedBotCount: targetParticipants.length,
      eliminatedUsernames: Array.from(this.eliminatedUsernames),
      participantUsernames: targetParticipants.slice(),
      playerUsernames: targetPlayers.slice(),
      stoppedAt: new Date().toISOString(),
      lastCommand: 'stop_round',
      lastCommandAt: new Date().toISOString(),
      lastServerPhase: orchestration,
      launchStatus: {
        state: ok ? 'stopped' : 'error',
        botCount: targetParticipants.length,
        playerCount: targetPlayers.length,
        at: new Date().toISOString(),
        message: ok ? 'round_stopped' : (orchestration.error || 'stop_round_failed')
      }
    });

    return {
      ok,
      error: ok ? null : 'stop_round_failed',
      orchestration,
      workers: result
    };
  }

  async resetPosition(args) {
    this.clearAutoRoundTimers();
    this.finalizingRound = false;
    await this.ensureRosterForArgs(args || {});
    this.eliminatedUsernames.clear();
    this.roundId = Number.isInteger(args && args.roundId) ? args.roundId : this.roundId + 1;
    this.currentRoundParticipants = this.resolveParticipantUsernames(args, this.currentRoundParticipants, {
      defaultToAll: true
    });
    this.currentRoundPlayers = this.resolvePlayerUsernames(args, this.currentRoundPlayers);

    if (!this.currentRoundParticipants.length) {
      return { ok: false, error: 'no_participants_selected' };
    }

    await this.botManager.ensureParticipantsOnline(this.currentRoundParticipants);
    const readiness = await this.botManager.waitForParticipantsReady(
      this.currentRoundParticipants,
      PARTICIPANT_READY_TIMEOUT_MS
    );
    if (!readiness.ok) {
      return {
        ok: false,
        error: 'participants_not_ready',
        unavailable: readiness.unavailable
      };
    }

    const inactiveUsernames = this.getInactiveParticipants(this.currentRoundParticipants);
    if (inactiveUsernames.length) {
      await this.botManager.runArenaCommand('stop_round', {
        reason: 'not-selected-for-reset',
        participantUsernames: inactiveUsernames
      });
    }

    const stopWorkers = await this.botManager.runArenaCommand('stop_round', {
      ...args,
      roundId: this.roundId,
      reason: 'reset-position-sync-stop',
      participantUsernames: this.currentRoundParticipants
    });
    const stopOrchestration = this.shouldUseRuntimeDatapack()
      ? await this.runRuntimeFunctionPhase('stop_round', this.roundId, this.currentRoundParticipants, this.currentRoundPlayers)
      : await this.runServerPhase('stop', this.roundId, {
          participantUsernames: this.currentRoundParticipants,
          playerUsernames: this.currentRoundPlayers
        });

    const orchestration = this.shouldUseRuntimeDatapack()
      ? await this.runRuntimePreparePhase(this.roundId, this.currentRoundParticipants, this.currentRoundPlayers)
      : await this.runLegacyPreparePhase(this.roundId, this.currentRoundParticipants, this.currentRoundPlayers);
    const result = orchestration.ok
      ? await this.botManager.runArenaCommand('reset_position', {
          ...args,
          roundId: this.roundId,
          participantUsernames: this.currentRoundParticipants
        })
      : {
          ok: false,
          skipped: true,
          error: 'server_reset_failed'
        };
    const stopOk = !!(stopOrchestration.ok && isWorkerBatchSuccessful(stopWorkers));
    const resetOk = !!(orchestration.ok && isWorkerBatchSuccessful(result));
    const ok = !!(stopOk && resetOk);

    this.syncState({
      status: 'preparing',
      roundId: this.roundId,
      winner: null,
      nextRound: null,
      requestedBotCount: this.currentRoundParticipants.length,
      eliminatedUsernames: [],
      participantUsernames: this.currentRoundParticipants.slice(),
      playerUsernames: this.currentRoundPlayers.slice(),
      resetAt: new Date().toISOString(),
      lastCommand: 'reset_position',
      lastCommandAt: new Date().toISOString(),
      lastServerPhase: {
        stop: stopOrchestration,
        prepare: orchestration
      },
      lastWorkerPhase: {
        stop: stopWorkers,
        reset: result
      },
      launchStatus: {
        state: ok ? 'prepared' : 'error',
        botCount: this.currentRoundParticipants.length,
        playerCount: this.currentRoundPlayers.length,
        at: new Date().toISOString(),
        message: ok
          ? 'positions_reset'
          : (stopOrchestration.error
            || getWorkerBatchError(stopWorkers)
            || orchestration.error
            || getWorkerBatchError(result)
            || 'reset_position_failed')
      }
    });

    return {
      ok,
      error: ok ? null : 'reset_position_failed',
      orchestration: {
        stop: stopOrchestration,
        prepare: orchestration
      },
      workers: {
        stop: stopWorkers,
        reset: result
      }
    };
  }

  async shutdown() {
    this.clearAutoRoundTimers();
    if (this.loginRecoveryTimer) {
      clearTimeout(this.loginRecoveryTimer);
      this.loginRecoveryTimer = null;
    }
    this.loginRecoveryQueue.clear();
    if (this.winnerInterval) {
      clearInterval(this.winnerInterval);
      this.winnerInterval = null;
    }
    this.eliminatedUsernames.clear();
    this.currentRoundParticipants = [];
    this.currentRoundPlayers = [];

    const result = await this.botManager.stopAll('arena-shutdown');
    this.syncState({
      status: 'shutdown',
      roundId: this.roundId,
      nextRound: null,
      requestedBotCount: 0,
      eliminatedUsernames: [],
      participantUsernames: [],
      playerUsernames: [],
      launchStatus: {
        state: 'idle'
      },
      lastCommand: 'shutdown',
      lastCommandAt: new Date().toISOString()
    });
    return { ok: true, result };
  }

  handleWorkerHeartbeat(username, payload) {
    this.syncDerivedState();
    if (!payload) return;

    this.stateStore.upsertBotState(username, {
      worker: {
        ...(this.stateStore.getBotState(username) && this.stateStore.getBotState(username).worker
          ? this.stateStore.getBotState(username).worker
          : {}),
        lastHeartbeatAt: payload.sentAt || new Date().toISOString()
      }
    });
  }

  handleWorkerEvent(username, name, payload) {
    const event = {
      username,
      name,
      payload: payload || null,
      at: new Date().toISOString()
    };

    this.recentEvents.push(event);
    if (this.recentEvents.length > 60) {
      this.recentEvents.shift();
    }

    this.logger.info(`[arena] worker event ${name}`, {
      username,
      payload: payload || null
    });

    this.syncState({
      recentEvents: this.recentEvents.slice()
    });

    if (name === 'logged_in' && this.config.loginRecoveryEnabled === true) {
      this.enqueueLoginRecovery(username);
    }

    if (name === 'died' && this.isTrackedEliminationEvent(username, payload)) {
      this.eliminatedUsernames.add(username);
      this.syncState({
        eliminatedUsernames: Array.from(this.eliminatedUsernames)
      });
      void this.applyElimination(username, payload || null);
    }

    this.syncDerivedState();
  }

  enqueueLoginRecovery(username) {
    if (!this.config.enabled || !username) return;

    this.loginRecoveryQueue.add(username);
    if (this.loginRecoveryTimer) return;

    this.loginRecoveryTimer = setTimeout(() => {
      this.loginRecoveryTimer = null;
      this.flushLoginRecoveryQueue().catch((error) => {
        this.logger.warn('[arena] login recovery flush failed', {
          message: error.message
        });
      });
    }, 250);
  }

  async flushLoginRecoveryQueue() {
    if (!this.loginRecoveryQueue.size) return;
    if (!this.config.enabled) {
      this.loginRecoveryQueue.clear();
      return;
    }

    const serverControl = this.config.serverControl || {};
    const rconEnabled = !!(this.rconClient && this.rconClient.isEnabled());
    if (!serverControl.enabled || !rconEnabled) {
      this.loginRecoveryQueue.clear();
      return;
    }

    const arenaState = this.stateStore.getArenaState() || {};
    if (this.activeControlCommand || arenaState.status === 'preparing' || arenaState.status === 'running') {
      this.loginRecoveryTimer = setTimeout(() => {
        this.loginRecoveryTimer = null;
        this.flushLoginRecoveryQueue().catch((error) => {
          this.logger.warn('[arena] login recovery retry failed', {
            message: error.message
          });
        });
      }, 450);
      return;
    }

    const managed = new Set(this.botManager.getUsernames());
    const usernames = Array.from(this.loginRecoveryQueue).filter((username) => managed.has(username));
    this.loginRecoveryQueue.clear();
    if (!usernames.length) return;

    const allUsernames = this.botManager.getUsernames();
    const commands = [];
    for (const username of usernames) {
      const zone = getStagingSpawnPoint(this.config, allUsernames, username);
      commands.push(
        `gamemode survival ${username}`,
        `tag ${username} remove arena_participant`,
        `tag ${username} remove arena_bot`,
        `spawnpoint ${username} ${zone.x} ${zone.y} ${zone.z}`,
        `tp ${username} ${zone.x} ${zone.y} ${zone.z}`,
        `effect clear ${username}`
      );
    }

    const result = await this.rconClient.executeMany(commands);
    if (!result.ok) {
      this.logger.warn('[arena] login recovery commands failed', {
        count: usernames.length,
        error: getRconBatchError(result) || 'login_recovery_failed'
      });
      return;
    }

    this.logger.info('[arena] login recovery applied', {
      count: usernames.length
    });
  }

  async checkRoundOutcome() {
    const arenaState = this.stateStore.getArenaState() || {};
    if (arenaState.status !== 'running') return;
    if (this.finalizingRound) return;

    const tracked = this.getTrackedArenaBots();
    if (tracked.length < 2) return;

    const active = tracked.filter((bot) => bot.online && !bot.eliminated);
    if (active.length > 1) return;

    const winner = active.length === 1 ? active[0].username : null;
    await this.finalizeRound(winner, active.length === 0 ? 'all_eliminated' : 'winner_detected');
  }

  async finalizeRound(winnerUsername, reason) {
    if (this.finalizingRound) return;
    this.finalizingRound = true;

    this.logger.info('[arena] finalizing round', {
      roundId: this.roundId,
      winner: winnerUsername,
      reason
    });

    const workerResult = await this.botManager.runArenaCommand('stop_round', {
      roundId: this.roundId,
      reason,
      participantUsernames: this.currentRoundParticipants
    });
    const orchestration = this.shouldUseRuntimeDatapack()
      ? await this.runRuntimeFunctionPhase('stop_round', this.roundId, this.currentRoundParticipants, this.currentRoundPlayers)
      : await this.runServerPhase('stop', this.roundId, {
          participantUsernames: this.currentRoundParticipants,
          playerUsernames: this.currentRoundPlayers
        });

    const winner = winnerUsername
      ? {
          username: winnerUsername,
          roundId: this.roundId,
          decidedAt: new Date().toISOString()
        }
      : null;

    this.syncState({
      status: 'finished',
      roundId: this.roundId,
      winner,
      requestedBotCount: this.currentRoundParticipants.length,
      eliminatedUsernames: Array.from(this.eliminatedUsernames),
      participantUsernames: this.currentRoundParticipants.slice(),
      playerUsernames: this.currentRoundPlayers.slice(),
      finishedAt: new Date().toISOString(),
      lastCommand: 'auto_finish_round',
      lastCommandAt: new Date().toISOString(),
      lastServerPhase: orchestration,
      lastFinishReason: reason,
      lastWorkerPhase: workerResult,
      launchStatus: {
        state: 'finished',
        botCount: this.currentRoundParticipants.length,
        playerCount: this.currentRoundPlayers.length,
        at: new Date().toISOString(),
        message: winnerUsername ? `winner:${winnerUsername}` : `finished:${reason}`
      }
    });

    this.finalizingRound = false;

    if (this.config.autoRestartRounds) {
      this.scheduleNextRound();
    }
  }

  scheduleNextRound() {
    this.clearAutoRoundTimers();
    const nextRoundId = this.roundId + 1;

    this.syncState({
      nextRound: {
        roundId: nextRoundId,
        prepareAt: new Date(Date.now() + this.config.postRoundDelayMs + this.config.autoPrepareDelayMs).toISOString(),
        startDelayMs: this.config.autoStartDelayMs
      }
    });

    this.autoPrepareTimeout = setTimeout(async () => {
      try {
        await this.prepareRound({ roundId: nextRoundId, automatic: true });
      } catch (error) {
        this.logger.error('[arena] auto prepare failed', {
          message: error.message
        });
        return;
      }

      this.autoStartTimeout = setTimeout(async () => {
        try {
          await this.startRound({ roundId: nextRoundId, automatic: true });
        } catch (error) {
          this.logger.error('[arena] auto start failed', {
            message: error.message
          });
        }
      }, this.config.autoStartDelayMs);
    }, this.config.postRoundDelayMs + this.config.autoPrepareDelayMs);
  }

  clearAutoRoundTimers() {
    if (this.autoPrepareTimeout) {
      clearTimeout(this.autoPrepareTimeout);
      this.autoPrepareTimeout = null;
    }

    if (this.autoStartTimeout) {
      clearTimeout(this.autoStartTimeout);
      this.autoStartTimeout = null;
    }
  }

  getTrackedArenaBots() {
    const state = this.stateStore.getAllState();
    return this.currentRoundParticipants.map((username) => {
      const bot = state.bots && state.bots[username] ? state.bots[username] : {};
      return {
        username,
        online: !!(bot.worker && bot.worker.online),
        roundId: bot.arena ? bot.arena.roundId : this.roundId,
        roundStatus: bot.arena ? bot.arena.roundStatus : 'running',
        eliminated: this.eliminatedUsernames.has(username) || !!(bot.arena && bot.arena.eliminated)
      };
    });
  }

  async applyElimination(username, payload) {
    const serverControl = this.config.serverControl || {};
    const rconEnabled = !!(this.rconClient && this.rconClient.isEnabled());

    if (!serverControl.enabled || !rconEnabled) {
      return;
    }

    const participant = this.botManager.getArenaParticipants(this.currentRoundParticipants).find((entry) => entry.username === username);
    if (!participant) return;

    const botState = this.stateStore.getBotState(username) || {};
    const deathPosition = payload && payload.position
      ? payload.position
      : (botState.position || participant.spawnPoint || null);

    const commands = renderTemplates(serverControl.perBotEliminatedCommands || [], {
      roundId: this.roundId,
      username: participant.username,
      x: participant.spawnPoint && participant.spawnPoint.x,
      y: participant.spawnPoint && participant.spawnPoint.y,
      z: participant.spawnPoint && participant.spawnPoint.z,
      deathX: deathPosition && deathPosition.x,
      deathY: deathPosition && deathPosition.y,
      deathZ: deathPosition && deathPosition.z
    }).filter((command) => {
      if (this.config.eliminationDropsEnabled === true) {
        return true;
      }
      return !/\bsummon\s+item\b/i.test(command);
    });

    if (!commands.length) return;

    try {
      await this.rconClient.executeMany(commands);
    } catch (error) {
      this.logger.error('[arena] elimination server commands failed', {
        username,
        message: error.message
      });
    }
  }

  shouldUseRuntimeDatapack() {
    return !!(this.datapackManager && this.datapackManager.isEnabled() && this.rconClient && this.rconClient.isEnabled());
  }

  async runLegacyPreparePhase(roundId, participantUsernames, playerUsernames) {
    const sharedOrchestration = await this.runServerPhase('prepare', roundId, {
      includeShared: true,
      includePerBot: false,
      participantUsernames,
      playerUsernames
    });
    const perBotOrchestration = await this.runServerPhase('prepare', roundId, {
      includeShared: false,
      includePerBot: true,
      participantUsernames,
      playerUsernames
    });

    return {
      ok: !!(sharedOrchestration.ok && perBotOrchestration.ok),
      phase: 'prepare',
      mode: 'legacy_rcon',
      shared: sharedOrchestration,
      perBot: perBotOrchestration
    };
  }

  async runLegacyStartPhase(roundId, participantUsernames, playerUsernames) {
    const sharedOrchestration = await this.runServerPhase('start', roundId, {
      includeShared: true,
      includePerBot: false,
      participantUsernames,
      playerUsernames
    });
    const perBotOrchestration = await this.runServerPhase('start', roundId, {
      includeShared: false,
      includePerBot: true,
      participantUsernames,
      playerUsernames
    });

    return {
      ok: !!(sharedOrchestration.ok && perBotOrchestration.ok),
      phase: 'start',
      mode: 'legacy_rcon',
      shared: sharedOrchestration,
      perBot: perBotOrchestration
    };
  }

  async runRuntimePreparePhase(roundId, participantUsernames, playerUsernames) {
    const participants = this.botManager.getArenaParticipants(participantUsernames);
    const totalCount = participants.length + (Array.isArray(playerUsernames) ? playerUsernames.length : 0);
    const playerParticipants = buildPlayerParticipants(
      playerUsernames,
      participants.length,
      (index) => this.botManager.getArenaSpawnPoint(index, totalCount)
    );
    const sync = this.datapackManager.syncRound({
      roundId,
      participants,
      playerParticipants
    });

    if (!sync.ok) {
      return {
        ok: false,
        phase: 'prepare',
        mode: 'runtime_datapack',
        error: 'datapack_sync_failed'
      };
    }

    return this.executeRuntimeFunction(sync, 'prepare_round');
  }

  async runRuntimeFunctionPhase(functionName, roundId, participantUsernames, playerUsernames) {
    const participants = this.botManager.getArenaParticipants(participantUsernames);
    const totalCount = participants.length + (Array.isArray(playerUsernames) ? playerUsernames.length : 0);
    const playerParticipants = buildPlayerParticipants(
      playerUsernames,
      participants.length,
      (index) => this.botManager.getArenaSpawnPoint(index, totalCount)
    );
    const sync = this.datapackManager.syncRound({
      roundId,
      participants,
      playerParticipants
    });

    if (!sync.ok) {
      return {
        ok: false,
        phase: functionName.replace('_round', ''),
        mode: 'runtime_datapack',
        error: 'datapack_sync_failed'
      };
    }

    return this.executeRuntimeFunction(sync, functionName);
  }

  async executeRuntimeFunction(sync, functionName) {
    const commands = [];
    if (sync.changed) {
      commands.push('reload');
    }
    commands.push(`function ${sync.namespace}:${functionName}`);

    try {
      const result = await this.rconClient.executeMany(commands);
      if (!result.ok) {
        const error = getRconBatchError(result) || 'runtime_command_failed';
        this.logger.error('[arena] runtime datapack command failed', {
          functionName,
          error
        });
        return {
          ok: false,
          phase: functionName.replace('_round', ''),
          mode: 'runtime_datapack',
          datapackChanged: !!sync.changed,
          commandCount: commands.length,
          commands,
          result,
          error
        };
      }

      return {
        ok: true,
        phase: functionName.replace('_round', ''),
        mode: 'runtime_datapack',
        datapackChanged: !!sync.changed,
        commandCount: commands.length,
        commands,
        result
      };
    } catch (error) {
      this.logger.error('[arena] runtime datapack phase failed', {
        functionName,
        message: error.message
      });
      return {
        ok: false,
        phase: functionName.replace('_round', ''),
        mode: 'runtime_datapack',
        datapackChanged: !!sync.changed,
        commandCount: commands.length,
        commands,
        error: error.message
      };
    }
  }

  async runServerPhase(phase, roundId, options) {
    const serverControl = this.config.serverControl || {};
    const rconEnabled = !!(this.rconClient && this.rconClient.isEnabled());
    const includeShared = !options || options.includeShared !== false;
    const includePerBot = !options || options.includePerBot !== false;

    if (!serverControl.enabled) {
      return {
        ok: true,
        skipped: true,
        reason: 'server_control_disabled',
        phase
      };
    }

    if (!rconEnabled) {
      const result = {
        ok: false,
        phase,
        error: 'rcon_disabled'
      };
      this.syncState({
        lastServerPhase: result
      });
      return result;
    }

    const participantUsernames = this.resolveParticipantUsernames(options, this.currentRoundParticipants);
    const playerUsernames = this.resolvePlayerUsernames(options, this.currentRoundPlayers);
    const participants = this.botManager.getArenaParticipants(participantUsernames);
    const totalCount = participants.length + playerUsernames.length;
    const playerParticipants = buildPlayerParticipants(
      playerUsernames,
      participants.length,
      (index) => this.botManager.getArenaSpawnPoint(index, totalCount)
    );
    const commands = renderPhaseCommands(serverControl, phase, participants, playerParticipants, roundId, {
      includeShared,
      includePerBot
    });

    if (!commands.length) {
      return {
        ok: true,
        skipped: true,
        reason: 'no_commands',
        phase
      };
    }

    try {
      const result = await this.rconClient.executeMany(commands);
      if (!result.ok) {
        const error = getRconBatchError(result) || 'rcon_command_failed';
        this.logger.error('[arena] server phase failed', {
          phase,
          error
        });
        return {
          ok: false,
          phase,
          commandCount: commands.length,
          commands,
          result,
          error
        };
      }

      return {
        ok: true,
        phase,
        commandCount: commands.length,
        commands,
        result
      };
    } catch (error) {
      this.logger.error('[arena] server phase failed', {
        phase,
        message: error.message
      });
      return {
        ok: false,
        phase,
        commandCount: commands.length,
        commands,
        error: error.message
      };
    }
  }

  syncDerivedState() {
    const state = this.stateStore.getAllState();
    const managedUsernames = this.botManager.getUsernames();
    const onlineCount = managedUsernames.filter((username) => {
      const bot = state.bots && state.bots[username] ? state.bots[username] : null;
      return !!(bot && bot.worker && bot.worker.online);
    }).length;
    const defaultArenaBotCount = managedUsernames.length;
    const activeArenaCount = this.currentRoundParticipants.filter((username) => {
      const bot = state.bots && state.bots[username] ? state.bots[username] : null;
      return !!(bot && bot.worker && bot.worker.online) && !this.eliminatedUsernames.has(username);
    }).length;

    this.syncState({
      participantCount: (this.currentRoundParticipants.length || defaultArenaBotCount) + this.currentRoundPlayers.length,
      playerCount: this.currentRoundPlayers.length,
      onlineCount,
      aliveCount: activeArenaCount,
      requestedBotCount: this.currentRoundParticipants.length,
      eliminatedUsernames: Array.from(this.eliminatedUsernames),
      participantUsernames: this.currentRoundParticipants.slice(),
      playerUsernames: this.currentRoundPlayers.slice(),
      serverControl: {
        enabled: !!(this.config.serverControl && this.config.serverControl.enabled),
        rconEnabled: !!(this.rconClient && this.rconClient.isEnabled())
      }
    });
  }

  async bootstrapServer() {
    const serverControl = this.config.serverControl || {};
    const commands = Array.isArray(serverControl.bootstrapCommands)
      ? serverControl.bootstrapCommands.filter((command) => typeof command === 'string' && command.trim())
      : [];

    if (!serverControl.enabled) {
      return { ok: true, skipped: true, reason: 'server_control_disabled' };
    }

    if (!(this.rconClient && this.rconClient.isEnabled())) {
      return { ok: false, error: 'rcon_disabled' };
    }

    if (!commands.length) {
      return { ok: true, skipped: true, reason: 'no_bootstrap_commands' };
    }

    try {
      const result = await this.rconClient.executeMany(commands);
      if (!result.ok) {
        const error = getRconBatchError(result) || 'bootstrap_failed';
        this.logger.error('[arena] bootstrap failed', { error });
        return {
          ok: false,
          commandCount: commands.length,
          commands,
          result,
          error
        };
      }

      this.logger.info('[arena] bootstrap completed', {
        commandCount: commands.length
      });
      return {
        ok: true,
        commandCount: commands.length,
        commands,
        result
      };
    } catch (error) {
      this.logger.error('[arena] bootstrap failed', {
        message: error.message
      });
      return {
        ok: false,
        commandCount: commands.length,
        commands,
        error: error.message
      };
    }
  }

  syncState(patch) {
    this.stateStore.upsertArenaState({
      ...(this.stateStore.getArenaState() || {}),
      ...patch
    });
  }

  resolveParticipantUsernames(args, fallback, options) {
    const pool = this.botManager.getUsernames();
    if (!pool.length) {
      return [];
    }

    const defaultToAll = !!(options && options.defaultToAll);
    const fallbackList = Array.isArray(fallback) && fallback.length
      ? fallback
      : pool.slice();

    if (args && Array.isArray(args.participantUsernames) && args.participantUsernames.length) {
      return filterKnownUsernames(args.participantUsernames, pool);
    }

    if (args && Number.isInteger(args.botCount)) {
      const requestedBotCount = clamp(args.botCount, 1, pool.length);
      return pool.slice(0, requestedBotCount);
    }

    if (defaultToAll) {
      return pool.slice();
    }

    return filterKnownUsernames(fallbackList, pool);
  }

  resolvePlayerUsernames(args, fallback) {
    const fallbackList = Array.isArray(fallback) ? fallback : [];

    if (args && Array.isArray(args.playerUsernames) && args.playerUsernames.length) {
      return normalizePlayerUsernames(args.playerUsernames);
    }

    return normalizePlayerUsernames(fallbackList);
  }

  getInactiveParticipants(activeParticipants) {
    const active = new Set(Array.isArray(activeParticipants) ? activeParticipants : []);
    return this.botManager.getUsernames().filter((username) => !active.has(username));
  }

  getLaunchStartDelayMs() {
    if (Number.isInteger(this.config.launchStartDelayMs) && this.config.launchStartDelayMs >= 0) {
      return this.config.launchStartDelayMs;
    }

    return 900;
  }

  isTrackedEliminationEvent(username, payload) {
    const arenaState = this.stateStore.getArenaState() || {};
    if (arenaState.status !== 'running') {
      return false;
    }

    if (!this.currentRoundParticipants.includes(username)) {
      return false;
    }

    if (!payload || payload.eliminated !== true) {
      return false;
    }

    if (Number.isInteger(payload.roundId) && payload.roundId !== this.roundId) {
      return false;
    }

    return true;
  }

  async withCommandGuard(fn) {
    try {
      return await fn();
    } finally {
      this.activeControlCommand = null;
    }
  }

  async ensureRosterForArgs(args) {
    if (!this.botManager || typeof this.botManager.setActiveBotCount !== 'function') {
      return;
    }

    const requested = args && Number.isInteger(args.botCount)
      ? args.botCount
      : this.botManager.getUsernames().length;
    const minimum = requested > 0 ? requested : this.botManager.getUsernames().length;
    if (minimum > this.botManager.getUsernames().length) {
      await this.botManager.setActiveBotCount(minimum, {
        reason: 'arena-command'
      });
    }
  }
}

function renderPhaseCommands(serverControl, phase, participants, playerParticipants, roundId, options) {
  const safeParticipants = Array.isArray(participants) ? participants : [];
  const safePlayerParticipants = Array.isArray(playerParticipants) ? playerParticipants : [];
  const includeShared = !options || options.includeShared !== false;
  const includePerBot = !options || options.includePerBot !== false;
  const commands = [];
  const sharedTemplates = getSharedTemplates(serverControl, phase);
  const sharedParticipantTemplates = getSharedParticipantTemplates(serverControl, phase);
  const perBotTemplates = getPerBotTemplates(serverControl, phase);
  const perHumanTemplates = getPerHumanTemplates(serverControl, phase);

  if (includeShared) {
    commands.push(...renderTemplates(sharedTemplates, { roundId }));
  }

  if (includePerBot) {
    for (const participant of safeParticipants) {
      commands.push(...renderTemplates(perBotTemplates, {
        roundId,
        username: participant.username,
        x: participant.spawnPoint && participant.spawnPoint.x,
        y: participant.spawnPoint && participant.spawnPoint.y,
        z: participant.spawnPoint && participant.spawnPoint.z
      }));
    }

    for (const participant of safePlayerParticipants) {
      commands.push(...renderTemplates(perHumanTemplates, {
        roundId,
        username: participant.username,
        x: participant.spawnPoint && participant.spawnPoint.x,
        y: participant.spawnPoint && participant.spawnPoint.y,
        z: participant.spawnPoint && participant.spawnPoint.z
      }));
    }

    commands.push(...renderTemplates(sharedParticipantTemplates, {
      roundId
    }));
  }

  return commands.filter(Boolean);
}

function getSharedTemplates(serverControl, phase) {
  switch (phase) {
    case 'prepare':
      return serverControl.sharedPrepareCommands || [];
    case 'start':
      return serverControl.sharedStartCommands || [];
    case 'stop':
      return serverControl.sharedStopCommands || [];
    default:
      return [];
  }
}

function getPerBotTemplates(serverControl, phase) {
  switch (phase) {
    case 'prepare':
      return [
        ...(serverControl.perBotPrepareCommands || []),
        ...(serverControl.perBotLoadoutCommands || [])
      ];
    case 'start':
      return serverControl.perBotStartCommands || [];
    case 'stop':
      return serverControl.perBotStopCommands || [];
    default:
      return [];
  }
}

function getSharedParticipantTemplates(serverControl, phase) {
  switch (phase) {
    case 'prepare':
      return serverControl.sharedParticipantPrepareCommands || [];
    default:
      return [];
  }
}

function getPerHumanTemplates(serverControl, phase) {
  switch (phase) {
    case 'prepare':
      return [
        ...(serverControl.perHumanPrepareCommands || []),
        ...(serverControl.perHumanLoadoutCommands || [])
      ];
    case 'start':
      return serverControl.perHumanStartCommands || [];
    case 'stop':
      return serverControl.perHumanStopCommands || [];
    default:
      return [];
  }
}

function renderTemplates(templates, context) {
  return (Array.isArray(templates) ? templates : [])
    .map((template) => renderTemplate(template, context))
    .filter(Boolean);
}

function renderTemplate(template, context) {
  if (typeof template !== 'string' || !template.trim()) {
    return null;
  }

  const rendered = template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => {
    const value = context[key];
    return value === undefined || value === null ? '' : String(value);
  }).trim();

  return rendered || null;
}

function filterKnownUsernames(usernames, knownUsernames) {
  const known = new Set(Array.isArray(knownUsernames) ? knownUsernames : []);
  return Array.from(new Set(
    (Array.isArray(usernames) ? usernames : []).filter((username) => known.has(username))
  ));
}

function normalizePlayerUsernames(usernames) {
  return Array.from(new Set(
    (Array.isArray(usernames) ? usernames : [])
      .map((username) => typeof username === 'string' ? username.trim() : '')
      .filter(Boolean)
  ));
}

function buildPlayerParticipants(playerUsernames, startIndex, getSpawnPoint) {
  const safeUsernames = normalizePlayerUsernames(playerUsernames);
  const participants = [];

  for (let index = 0; index < safeUsernames.length; index += 1) {
    const spawnPoint = typeof getSpawnPoint === 'function'
      ? getSpawnPoint(startIndex + index)
      : null;

    participants.push({
      username: safeUsernames[index],
      spawnPoint
    });
  }

  return participants;
}

function getHoldingZone(config) {
  const zone = config && config.holdingZone ? config.holdingZone : null;
  if (!zone) {
    return { x: 0, y: -60, z: 120 };
  }

  return {
    x: Number.isFinite(zone.x) ? Math.round(zone.x) : 0,
    y: Number.isFinite(zone.y) ? Math.round(zone.y) : -60,
    z: Number.isFinite(zone.z) ? Math.round(zone.z) : 120
  };
}

function getStagingSpawnPoint(config, usernames, username) {
  const base = getHoldingZone(config);
  const staging = config && config.stagingSpawn ? config.stagingSpawn : null;
  if (!staging || staging.enabled === false) {
    return base;
  }

  const safeUsernames = Array.isArray(usernames) ? usernames : [];
  const total = safeUsernames.length;
  const index = safeUsernames.indexOf(username);
  if (index < 0 || total < 1) {
    return base;
  }

  const columns = sanitizePositiveInt(staging.columns, 10);
  const spacing = sanitizePositiveNumber(staging.spacing, 4);
  const rows = Math.max(1, Math.ceil(total / columns));
  const row = Math.floor(index / columns);
  const col = index % columns;
  const xOffset = (col - (columns - 1) / 2) * spacing;
  const zOffset = (row - (rows - 1) / 2) * spacing;
  const y = Number.isFinite(staging.y) ? Math.round(staging.y) : base.y;

  return {
    x: round(base.x + xOffset),
    y,
    z: round(base.z + zOffset)
  };
}

function sanitizePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function sanitizePositiveNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function round(value) {
  return Math.round(value * 10) / 10;
}

function isWorkerBatchSuccessful(result) {
  if (!result || result.ok === false) {
    return false;
  }

  const results = Array.isArray(result.results) ? result.results : [];
  return results.every((entry) => entry && entry.result && entry.result.ok !== false);
}

function getWorkerBatchError(result) {
  if (!result) {
    return null;
  }

  if (typeof result.error === 'string' && result.error) {
    return result.error;
  }

  const results = Array.isArray(result.results) ? result.results : [];
  const failed = results.find((entry) => entry && entry.result && entry.result.ok === false);
  if (!failed || !failed.result) {
    return null;
  }

  return failed.result.error || `worker_failed:${failed.username || 'unknown'}`;
}

function getRconBatchError(result) {
  if (!result) {
    return null;
  }

  if (typeof result.error === 'string' && result.error) {
    return result.error;
  }

  const failures = Array.isArray(result.failures) ? result.failures : [];
  if (!failures.length) {
    return null;
  }

  const first = failures[0];
  return first.error || first.response || first.command || 'rcon_command_failed';
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
  ArenaController
};
