'use strict';

const http = require('http');

class WebServer {
  constructor(options) {
    this.config = options.config;
    this.logger = options.logger;
    this.stateStore = options.stateStore;
    this.botManager = options.botManager;
    this.arenaController = options.arenaController;
    this.server = null;
  }

  start() {
    if (!this.config.enabled) return;

    this.server = http.createServer(async (req, res) => {
      try {
        await this.route(req, res);
      } catch (error) {
        this.logger.error('web request failed', { message: error.message });
        sendJson(res, 500, { error: 'internal_error', message: error.message });
      }
    });

    this.server.listen(this.config.port, this.config.host, () => {
      this.logger.info('web panel ready', {
        url: `http://${this.config.host}:${this.config.port}`
      });
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  async route(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);

    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderPage());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/api/state') {
      sendJson(res, 200, {
        state: this.stateStore.getAllState(),
        logs: this.logger.getRecentEntries(120),
        bots: this.botManager.getBotSummaries(),
        manager: this.botManager.getManagerState()
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/workers/scale') {
      const body = await readJson(req);
      const result = await this.botManager.setActiveBotCount(body && body.count, {
        reason: 'web-scale'
      });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/arena/command') {
      const body = await readJson(req);
      const result = await this.arenaController.runCommand(body.command, body.args || {});
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/arena/launch') {
      const body = await readJson(req);
      const result = await this.arenaController.runCommand('launch_match', body || {});
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/command') {
      const body = await readJson(req);
      const result = await this.botManager.runCommand(body);
      sendJson(res, 200, result);
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  }
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new Error('request too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function renderPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mc-bot-colony arena panel</title>
  <style>
    :root {
      --bg: #11161c;
      --panel: #1a222c;
      --panel-2: #212d38;
      --text: #e8eef5;
      --muted: #99a8b6;
      --accent: #7cc8ff;
      --success: #8de08a;
      --warn: #ffca6a;
      --danger: #ff7b88;
      --border: #31404c;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: var(--text);
      font-family: Consolas, "Segoe UI", monospace;
      background:
        radial-gradient(circle at top left, rgba(124, 200, 255, 0.18), transparent 30%),
        radial-gradient(circle at top right, rgba(141, 224, 138, 0.12), transparent 24%),
        linear-gradient(180deg, #0d1318, var(--bg));
    }
    .wrap {
      max-width: 1480px;
      margin: 0 auto;
      padding: 20px;
    }
    h1 { margin: 0 0 14px; font-size: 30px; }
    .lead { color: var(--muted); margin-bottom: 18px; }
    .grid {
      display: grid;
      grid-template-columns: 1.35fr 0.95fr;
      gap: 16px;
    }
    .panel {
      background: linear-gradient(180deg, var(--panel), var(--panel-2));
      border: 1px solid var(--border);
      border-radius: 18px;
      padding: 16px;
      box-shadow: 0 14px 48px rgba(0, 0, 0, 0.2);
    }
    .row {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 12px;
    }
    .stack {
      display: grid;
      gap: 12px;
      margin-bottom: 14px;
    }
    .stats {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
      gap: 10px;
      margin-bottom: 14px;
    }
    .stat {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      background: rgba(0, 0, 0, 0.12);
    }
    .stat .k { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
    .stat .v { font-size: 21px; }
    .bots {
      display: grid;
      gap: 12px;
    }
    .bot {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      background: rgba(0,0,0,0.14);
    }
    .title { font-size: 18px; margin-bottom: 6px; }
    .meta { color: var(--muted); font-size: 13px; margin-bottom: 10px; }
    .statusBox {
      border: 1px solid var(--border);
      border-radius: 14px;
      padding: 12px;
      background: rgba(0, 0, 0, 0.12);
      color: var(--muted);
      min-height: 46px;
    }
    .pill {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 999px;
      border: 1px solid var(--border);
      margin-right: 6px;
      margin-bottom: 6px;
      font-size: 12px;
    }
    button, input {
      background: #121920;
      color: var(--text);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px 10px;
      font: inherit;
    }
    button {
      cursor: pointer;
      background: #1d2b36;
    }
    button:hover { border-color: var(--accent); }
    button.danger:hover { border-color: var(--danger); }
    pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--muted);
      font-size: 12px;
      max-height: 650px;
      overflow: auto;
    }
    .accent { color: var(--accent); }
    .success { color: var(--success); }
    .warn { color: var(--warn); }
    .danger { color: var(--danger); }
    @media (max-width: 1000px) {
      .grid { grid-template-columns: 1fr; }
      .stats { grid-template-columns: repeat(2, 1fr); }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>mc-bot-colony arena panel</h1>
    <div class="lead">1) Set bot count and start workers. 2) Prepare round. 3) Start PvP.</div>
    <div class="grid">
      <section class="panel">
        <div id="arenaStats" class="stats"></div>
        <div class="stack">
          <div class="row">
            <input id="matchBotCount" type="number" min="1" step="1" placeholder="bot count" style="width: 140px">
            <input id="matchPlayers" placeholder="human players: user1, user2" style="min-width: 240px; flex: 1">
            <button data-arena-control="1" onclick="applyBotCount()">Start Workers</button>
            <button data-arena-control="1" onclick="launchMatch()">Launch PvP (auto)</button>
            <button data-arena-control="1" onclick="runArena('prepare_round', collectMatchArgs())">Prepare</button>
            <button data-arena-control="1" onclick="runArena('start_round', collectMatchArgs())">Start</button>
          </div>
          <div class="row">
            <button data-arena-control="1" onclick="runArena('stop_round')">Stop</button>
            <button data-arena-control="1" onclick="runArena('reset_position')">Reset</button>
            <button data-arena-control="1" class="danger" onclick="runArena('shutdown')">Shutdown Workers</button>
          </div>
          <div id="launchStatus" class="statusBox">Arena status: idle</div>
        </div>
        <div id="bots" class="bots"></div>
      </section>
      <section class="panel">
        <div class="row">
          <input id="legacyTarget" placeholder="bot username or all" value="all" style="flex: 1">
          <input id="legacyCommand" placeholder="legacy command for fallback/debug" style="flex: 1">
          <button onclick="runLegacy()">Send</button>
        </div>
        <pre id="logs">Loading...</pre>
      </section>
    </div>
  </div>
  <script>
    let arenaCommandPending = false;
    let latestState = null;

    async function api(path, options) {
      const response = await fetch(path, {
        headers: { 'Content-Type': 'application/json' },
        ...options
      });
      return response.json();
    }

    function setArenaBusy(isBusy, label) {
      arenaCommandPending = !!isBusy;
      const controls = document.querySelectorAll('[data-arena-control=\"1\"]');
      controls.forEach(button => {
        button.disabled = arenaCommandPending;
      });
      if (arenaCommandPending) {
        document.getElementById('launchStatus').textContent = 'Arena status: ' + (label || 'processing');
      }
    }

    function renderArenaStats(state, bots, manager) {
      const arena = state.arena || {};
      const activeCount = manager && Number.isFinite(manager.activeCount) ? manager.activeCount : bots.length;
      const capacity = manager && Number.isFinite(manager.capacity) ? manager.capacity : activeCount;
      const online = manager && Number.isFinite(manager.onlineCount)
        ? manager.onlineCount
        : bots.filter(bot => bot.state && bot.state.worker && bot.state.worker.online).length;
      const alive = arena.aliveCount ?? bots.filter(bot => bot.state && bot.state.vitals && bot.state.vitals.alive).length;
      const roundId = arena.roundId || 0;
      const status = arena.status || 'idle';
      const winner = arena.winner && arena.winner.username ? arena.winner.username : '-';
      const requestedBotCount = arena.requestedBotCount || 0;
      const playerCount = Array.isArray(arena.playerUsernames) ? arena.playerUsernames.length : 0;
      const serverControl = arena.serverControl || {};
      const serverMode = serverControl.enabled
        ? (serverControl.rconEnabled ? 'rcon-ready' : 'rcon-off')
        : 'manual';
      return [
        statCard('round', roundId),
        statCard('status', status),
        statCard('active bots', activeCount),
        statCard('capacity', capacity),
        statCard('match bots', requestedBotCount || '-'),
        statCard('players', playerCount || '-'),
        statCard('online', online + '/' + activeCount),
        statCard('alive', String(alive)),
        statCard('winner', winner),
        statCard('server', serverMode)
      ].join('');
    }

    function statCard(label, value) {
      return '<div class="stat"><div class="k">' + label + '</div><div class="v">' + value + '</div></div>';
    }

    function botCard(bot) {
      const state = bot.state || {};
      const arena = state.arena || {};
      const vitals = state.vitals || {};
      const gear = state.gear || {};
      const worker = state.worker || {};
      const pos = state.position ? state.position.x + ', ' + state.position.y + ', ' + state.position.z : 'unknown';
      const target = arena.target ? (arena.target.username || arena.target.id) : 'none';
      const stats = arena.stats || {};
      const eliminated = arena.eliminated ? 'yes' : 'no';
      const onlineClass = worker.online ? 'success' : 'danger';
      const lastLoginAt = state.lastLoginAt ? new Date(state.lastLoginAt).toLocaleTimeString() : '-';
      const lastSpawnAt = state.lastSpawnAt ? new Date(state.lastSpawnAt).toLocaleTimeString() : '-';
      return \`
        <div class="bot">
          <div class="title">\${bot.username}</div>
          <div class="meta">
            worker: <span class="\${onlineClass}">\${worker.online ? 'online' : 'offline'}</span>
            | mode: <span class="accent">\${state.runtimeMode || worker.mode || 'unknown'}</span>
            | arena: <span class="accent">\${arena.state || 'idle'}</span>
            | round: <span class="warn">\${arena.roundStatus || 'idle'}</span>
          </div>
          <div class="row">
            <span class="pill">hp \${vitals.health ?? 'n/a'}</span>
            <span class="pill">food \${vitals.food ?? 'n/a'}</span>
            <span class="pill">alive \${vitals.alive ? 'yes' : 'no'}</span>
            <span class="pill">eliminated \${eliminated}</span>
            <span class="pill">target \${target}</span>
            <span class="pill">pos \${pos}</span>
          </div>
          <div class="row">
            <span class="pill">login \${lastLoginAt}</span>
            <span class="pill">spawn \${lastSpawnAt}</span>
          </div>
          <div class="row">
            <span class="pill">weapon \${gear.mainHand || 'none'}</span>
            <span class="pill">head \${gear.head || 'none'}</span>
            <span class="pill">chest \${gear.torso || 'none'}</span>
            <span class="pill">legs \${gear.legs || 'none'}</span>
            <span class="pill">feet \${gear.feet || 'none'}</span>
          </div>
          <div class="row">
            <span class="pill">kills \${stats.kills || 0}</span>
            <span class="pill">deaths \${stats.deaths || 0}</span>
            <span class="pill">damage \${stats.damageTaken || 0}</span>
            <span class="pill">switches \${stats.targetSwitches || 0}</span>
            <span class="pill">heals \${stats.healAttempts || 0}</span>
          </div>
        </div>
      \`;
    }

    async function refreshState() {
      const data = await api('/api/state');
      const bots = data.bots || [];
      const state = data.state || {};
      const manager = data.manager || {};
      latestState = state;
      document.getElementById('arenaStats').innerHTML = renderArenaStats(state, bots, manager);
      document.getElementById('bots').innerHTML = bots.map(botCard).join('') || '<div class="bot">No bots yet</div>';
      document.getElementById('logs').textContent = (data.logs || []).map(item => item.line).join('\\n');
      syncLaunchStatus(state);
    }

    async function applyBotCount() {
      if (arenaCommandPending) {
        document.getElementById('launchStatus').textContent = 'Arena status: controller busy';
        return;
      }

      const raw = Number.parseInt(document.getElementById('matchBotCount').value, 10);
      if (!Number.isFinite(raw) || raw < 1) {
        document.getElementById('launchStatus').textContent = 'Arena status: set bot count first';
        return;
      }

      try {
        setArenaBusy(true, 'starting workers...');
        const result = await api('/api/workers/scale', {
          method: 'POST',
          body: JSON.stringify({ count: raw })
        });
        if (result && result.ok) {
          const clampSuffix = result.clamped
            ? (' | capped_to_safe: ' + result.activeCount + ' (safe ' + (result.safeCapacity || '?') + ')')
            : '';
          document.getElementById('launchStatus').textContent = 'Arena status: workers_ready | active: ' + result.activeCount + clampSuffix;
        } else {
          document.getElementById('launchStatus').textContent = 'Arena status: error | worker_scale_failed';
        }
      } catch (error) {
        document.getElementById('launchStatus').textContent = 'Arena status: error | ' + (error && error.message ? error.message : 'request_failed');
      } finally {
        setArenaBusy(false);
      }
      await refreshState();
    }

    function collectMatchArgs() {
      const raw = Number.parseInt(document.getElementById('matchBotCount').value, 10);
      const rawPlayers = document.getElementById('matchPlayers').value;
      const args = {
        playerUsernames: String(rawPlayers || '')
          .split(',')
          .map(value => value.trim())
          .filter(Boolean)
      };
      if (Number.isFinite(raw) && raw > 0) {
        args.botCount = raw;
      }
      return args;
    }

    function extractArenaError(result) {
      if (!result) {
        return 'command_failed';
      }
      if (result.activeCommand) {
        return 'arena_command_in_progress: ' + result.activeCommand;
      }
      if (Array.isArray(result.unavailable) && result.unavailable.length) {
        return (result.error || 'participants_not_ready') + ': ' + result.unavailable.join(', ');
      }
      if (result.error) {
        return result.error;
      }
      if (result.prepare && result.prepare.error) {
        return result.prepare.error;
      }
      if (result.start && result.start.error) {
        return result.start.error;
      }
      if (result.orchestration && result.orchestration.error) {
        return result.orchestration.error;
      }
      if (result.workers && Array.isArray(result.workers.results)) {
        const failedWorker = result.workers.results.find(entry => entry && entry.result && entry.result.ok === false);
        if (failedWorker && failedWorker.result && failedWorker.result.error) {
          return failedWorker.username + ': ' + failedWorker.result.error;
        }
      }
      return 'command_failed';
    }

    function syncLaunchStatus(state) {
      if (arenaCommandPending) {
        return;
      }
      const arena = state && state.arena ? state.arena : {};
      const launchStatus = arena.launchStatus || { state: 'idle' };
      const runtimeStatus = arena.status || 'idle';
      const botCount = arena.requestedBotCount || launchStatus.botCount || 0;
      const players = Array.isArray(arena.playerUsernames) ? arena.playerUsernames : [];
      const message = runtimeStatus === 'running'
        ? 'running'
        : runtimeStatus === 'preparing'
          ? 'preparing'
          : runtimeStatus === 'finished'
            ? (arena.winner && arena.winner.username ? ('winner:' + arena.winner.username) : 'finished')
            : runtimeStatus === 'stopped'
              ? 'stopped'
              : runtimeStatus === 'idle'
                ? (launchStatus.state === 'error'
                    ? ('error:' + (launchStatus.message || 'command_failed'))
                    : 'idle')
                : (runtimeStatus || launchStatus.state || 'idle');
      const winner = arena.winner && arena.winner.username ? arena.winner.username : '';
      document.getElementById('launchStatus').textContent =
        'Arena status: ' + message
        + (botCount ? ' | bots: ' + botCount : '')
        + (players.length ? ' | players: ' + players.join(', ') : '')
        + (winner ? ' | winner: ' + winner : '');
      if (players.length || launchStatus.state !== 'idle') {
        document.getElementById('matchPlayers').value = players.join(', ');
      }
    }

    async function runArena(command, args) {
      if (arenaCommandPending) {
        document.getElementById('launchStatus').textContent = 'Arena status: controller busy';
        return;
      }

      try {
        setArenaBusy(true, 'running ' + command + '...');
        const result = await api('/api/arena/command', {
          method: 'POST',
          body: JSON.stringify({ command, args: args || {} })
        });
        if (result && (result.error || result.ok === false)) {
          document.getElementById('launchStatus').textContent = 'Arena status: error | ' + extractArenaError(result);
        }
      } catch (error) {
        document.getElementById('launchStatus').textContent = 'Arena status: error | ' + (error && error.message ? error.message : 'request_failed');
      } finally {
        setArenaBusy(false);
      }
      await refreshState();
    }

    async function launchMatch() {
      if (arenaCommandPending) {
        document.getElementById('launchStatus').textContent = 'Arena status: controller busy';
        return;
      }

      const arena = latestState && latestState.arena ? latestState.arena : {};
      const status = arena.status || 'idle';
      const args = collectMatchArgs();

      try {
        const endpoint = status === 'preparing' ? '/api/arena/command' : '/api/arena/launch';
        const payload = status === 'preparing'
          ? { command: 'start_round', args }
          : args;
        const label = status === 'preparing' ? 'starting prepared round...' : 'launching...';
        setArenaBusy(true, label);
        const result = await api(endpoint, {
          method: 'POST',
          body: JSON.stringify(payload)
        });
        if (result && result.ok) {
          document.getElementById('launchStatus').textContent = status === 'preparing'
            ? 'Arena status: prepared round started'
            : 'Arena status: round_started';
        } else {
          document.getElementById('launchStatus').textContent = 'Arena status: error | ' + extractArenaError(result);
        }
      } catch (error) {
        document.getElementById('launchStatus').textContent = 'Arena status: error | ' + (error && error.message ? error.message : 'request_failed');
      } finally {
        setArenaBusy(false);
      }
      await refreshState();
    }

    async function runLegacy() {
      const target = document.getElementById('legacyTarget').value.trim() || 'all';
      const command = document.getElementById('legacyCommand').value.trim();
      if (!command) return;
      await api('/api/command', {
        method: 'POST',
        body: JSON.stringify({ target, command, args: {} })
      });
      await refreshState();
    }

    refreshState();
    setInterval(refreshState, 500);
  </script>
</body>
</html>`;
}

module.exports = {
  WebServer
};
