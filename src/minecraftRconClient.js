'use strict';

const net = require('net');

const PACKET_TYPE_RESPONSE_VALUE = 0;
const PACKET_TYPE_COMMAND = 2;
const PACKET_TYPE_AUTH = 3;
const RESPONSE_IDLE_MS = 5;
const COMMAND_ERROR_MARKERS = [
  'incorrect argument for command',
  'unknown or incomplete command',
  'unknown command'
];
const COMMAND_SOFT_ERROR_MARKERS = [
  'no entity was found',
  'no player was found',
  'player not found'
];

class MinecraftRconClient {
  constructor(options) {
    this.config = options.config || {};
    this.logger = options.logger;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.nextRequestId = 1;
    this.pending = new Map();
    this.executionQueue = Promise.resolve();
  }

  isEnabled() {
    return !!this.config.enabled;
  }

  async executeMany(commands) {
    const safeCommands = Array.isArray(commands)
      ? commands.filter((command) => typeof command === 'string' && command.trim())
      : [];

    const task = async () => {
      if (!this.isEnabled()) {
        return {
          ok: false,
          error: 'rcon_disabled',
          commands: []
        };
      }

      if (!safeCommands.length) {
        return {
          ok: true,
          commands: []
        };
      }

      await this.connect();

      const results = [];
      try {
        await this.authenticate();
        for (let index = 0; index < safeCommands.length; index += 1) {
          const command = safeCommands[index];
          const response = await this.sendCommand(command);
          results.push({
            command,
            response
          });
        }
      } finally {
        this.close();
      }

      const failures = results
        .map((entry) => ({
          command: entry.command,
          response: entry.response,
          error: getCommandFailure(entry.response)
        }))
        .filter((entry) => entry.error);
      const softFailures = results
        .map((entry) => ({
          command: entry.command,
          response: entry.response,
          error: getCommandSoftFailure(entry.response)
        }))
        .filter((entry) => entry.error);

      if (failures.length) {
        this.logger.warn('[rcon] command failures detected', {
          count: failures.length,
          failures
        });
      }
      if (softFailures.length) {
        this.logger.info('[rcon] benign command responses detected', {
          count: softFailures.length,
          responses: softFailures
        });
      }

      return {
        ok: failures.length === 0,
        commands: results,
        failures,
        softFailures
      };
    };

    const run = this.executionQueue.then(task, task);
    this.executionQueue = run.catch(() => null);
    return run;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.close();

      const socket = net.createConnection({
        host: this.config.host,
        port: this.config.port
      });

      const onError = (error) => {
        cleanup();
        reject(error);
      };

      const onConnect = () => {
        cleanup();
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        this.socket.on('data', (chunk) => {
          if (socket !== this.socket) {
            return;
          }
          this.handleData(chunk);
        });
        this.socket.on('error', (error) => {
          if (socket !== this.socket) {
            return;
          }
          this.handleSocketFailure(error);
        });
        this.socket.on('close', () => {
          if (socket !== this.socket) {
            return;
          }
          this.handleSocketClose();
        });
        resolve();
      };

      const cleanup = () => {
        socket.off('error', onError);
        socket.off('connect', onConnect);
      };

      socket.setTimeout(this.config.timeoutMs, () => {
        socket.destroy(new Error('rcon_timeout'));
      });
      socket.once('error', onError);
      socket.once('connect', onConnect);
    });
  }

  authenticate() {
    const requestId = this.allocateRequestId();
    return this.sendPacket(requestId, PACKET_TYPE_AUTH, this.config.password || '')
      .then((response) => {
        if (!response || response.requestId === -1) {
          throw new Error('rcon_auth_failed');
        }

        this.logger.info('[rcon] authenticated', {
          host: this.config.host,
          port: this.config.port
        });
        return response;
      });
  }

  sendCommand(command) {
    const requestId = this.allocateRequestId();
    return this.sendPacket(requestId, PACKET_TYPE_COMMAND, command)
      .then((response) => {
        this.logger.info('[rcon] command executed', {
          command
        });
        return response ? response.body : '';
      });
  }

  sendPacket(requestId, type, body) {
    if (!this.socket) {
      return Promise.reject(new Error('rcon_not_connected'));
    }

    const payload = Buffer.from(String(body || ''), 'utf8');
    const length = 4 + 4 + payload.length + 2;
    const packet = Buffer.alloc(4 + length);
    packet.writeInt32LE(length, 0);
    packet.writeInt32LE(requestId, 4);
    packet.writeInt32LE(type, 8);
    payload.copy(packet, 12);
    packet.writeInt16LE(0, 12 + payload.length);

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error('rcon_response_timeout'));
      }, this.config.timeoutMs);

      this.pending.set(requestId, {
        requestId,
        resolve,
        reject,
        timeout,
        bodyParts: [],
        idleTimer: null,
        expectedType: type
      });

      this.socket.write(packet, (error) => {
        if (error) {
          this.rejectPending(requestId, error);
        }
      });
    });
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);

    while (this.buffer.length >= 4) {
      const packetLength = this.buffer.readInt32LE(0);
      if (this.buffer.length < packetLength + 4) {
        return;
      }

      const packet = this.buffer.subarray(4, packetLength + 4);
      this.buffer = this.buffer.subarray(packetLength + 4);

      const requestId = packet.readInt32LE(0);
      const type = packet.readInt32LE(4);
      const body = packet.subarray(8, packet.length - 2).toString('utf8');
      this.resolvePacket({
        requestId,
        type,
        body
      });
    }
  }

  resolvePacket(packet) {
    if (packet.requestId === -1) {
      for (const requestId of this.pending.keys()) {
        const pending = this.pending.get(requestId);
        if (pending && pending.expectedType === PACKET_TYPE_AUTH) {
          this.rejectPending(requestId, new Error('rcon_auth_failed'));
          return;
        }
      }
      return;
    }

    const pending = this.pending.get(packet.requestId);
    if (!pending) return;

    pending.bodyParts.push(packet.body || '');

    if (pending.idleTimer) {
      clearTimeout(pending.idleTimer);
    }

    pending.idleTimer = setTimeout(() => {
      clearTimeout(pending.timeout);
      this.pending.delete(packet.requestId);
      pending.resolve({
        requestId: packet.requestId,
        type: packet.type,
        body: pending.bodyParts.join('')
      });
    }, RESPONSE_IDLE_MS);
  }

  handleSocketFailure(error) {
    for (const requestId of this.pending.keys()) {
      this.rejectPending(requestId, error);
    }
  }

  handleSocketClose() {
    this.socket = null;
  }

  rejectPending(requestId, error) {
    const pending = this.pending.get(requestId);
    if (!pending) return;

    clearTimeout(pending.timeout);
    if (pending.idleTimer) {
      clearTimeout(pending.idleTimer);
    }
    this.pending.delete(requestId);
    pending.reject(error);
  }

  allocateRequestId() {
    const value = this.nextRequestId;
    this.nextRequestId += 1;
    return value;
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    for (const requestId of this.pending.keys()) {
      this.rejectPending(requestId, new Error('rcon_closed'));
    }
    this.buffer = Buffer.alloc(0);
  }
}

function getCommandFailure(response) {
  if (typeof response !== 'string') {
    return null;
  }

  const normalized = response.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const marker of COMMAND_ERROR_MARKERS) {
    if (normalized.includes(marker)) {
      return response.trim();
    }
  }

  return null;
}

function getCommandSoftFailure(response) {
  if (typeof response !== 'string') {
    return null;
  }

  const normalized = response.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  for (const marker of COMMAND_SOFT_ERROR_MARKERS) {
    if (normalized.includes(marker)) {
      return response.trim();
    }
  }

  return null;
}

module.exports = {
  MinecraftRconClient
};
