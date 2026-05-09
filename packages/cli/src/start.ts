// thoth start — runtime bootstrap.
//
// Adapted from apex-workspace/services/slack-bridge/src/index.ts.
// Imports adjusted to use the @thoth-runtime/core barrel.

import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { exec } from 'child_process';
import { App, LogLevel } from '@slack/bolt';
import {
  authProbe,
  loadConfig,
  loadPersonaStack,
  SessionStore,
  Allowlist,
  registerHandlers,
  HonchoClient,
  buildPeerRoster,
  EpisodicStore,
  ensureEmbeddingsLoaded,
  skillDraftStore,
  dailyCostCap,
  IdleDetector,
  registerReactionHandlers,
  scheduledRunStore,
  SchedulingPoller,
  DashboardServer,
  partyStore,
  partyDailyCap,
  PartyOrchestrator,
  AnthropicStatusMonitor,
  startStatusAnnouncer,
  eventArchive,
  provenanceStore,
  harvestSkills,
  ambientBudget,
  AmbientAgent,
  logger,
  VERSION,
  type OrchestratorDeps,
} from '@thoth-runtime/core';

const BANNER = `
\x1b[36m████████╗██╗  ██╗ ██████╗ ████████╗██╗  ██╗
╚══██╔══╝██║  ██║██╔═══██╗╚══██╔══╝██║  ██║
   ██║   ███████║██║   ██║   ██║   ███████║
   ██║   ██╔══██║██║   ██║   ██║   ██╔══██║
   ██║   ██║  ██║╚██████╔╝   ██║   ██║  ██║
   ╚═╝   ╚═╝  ╚═╝ ╚═════╝    ╚═╝   ╚═╝  ╚═╝\x1b[0m
\x1b[2m   the lifelong-learning agent runtime · v${VERSION}\x1b[0m
`;

export async function start(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(BANNER);

  const bridgeStartedAt = Date.now();

  authProbe();

  const config = loadConfig();

  await fs.mkdir(config.SANDBOX_ROOT, { recursive: true });

  const persona = await loadPersonaStack(
    config.PERSONA_DIR,
    config.AETHER_RULES_PATH,
  );
  if (persona.totalChars < 100) {
    logger.warn(
      { totalChars: persona.totalChars, loadedFiles: persona.loadedFiles },
      'persona stack is empty/short — bot will run vanilla',
    );
  } else {
    logger.info(
      {
        totalChars: persona.totalChars,
        loadedFiles: persona.loadedFiles.length,
      },
      'persona stack loaded',
    );
  }

  const store = new SessionStore(config.DB_PATH);
  const allowlist = new Allowlist(config.ALLOWED_USERS);

  let honcho: HonchoClient | undefined;
  if (config.HONCHO_API_KEY && !config.HONCHO_DISABLED) {
    honcho = new HonchoClient({
      apiKey: config.HONCHO_API_KEY,
      workspaceId: config.HONCHO_WORKSPACE_ID,
      baseUrl: config.HONCHO_BASE_URL,
      dialecticTimeoutMs: config.HONCHO_DIALECTIC_TIMEOUT_MS,
      writeTimeoutMs: config.HONCHO_WRITE_TIMEOUT_MS,
    });
    try {
      await honcho.ensureWorkspace({
        bridge_version: VERSION,
        bootstrapped_at: new Date().toISOString(),
      });
      const roster = buildPeerRoster(allowlist);
      await honcho.ensurePeers(roster);
      logger.info(
        {
          workspace: config.HONCHO_WORKSPACE_ID,
          baseUrl: config.HONCHO_BASE_URL,
          peers: roster.map((p) => p.id),
          dialecticTimeoutMs: config.HONCHO_DIALECTIC_TIMEOUT_MS,
        },
        'honcho online — identity layer ready',
      );
    } catch (err) {
      logger.warn(
        { err: String(err) },
        'honcho bootstrap had issues but bridge will continue',
      );
    }
  } else if (config.HONCHO_DISABLED) {
    logger.warn('honcho disabled by HONCHO_DISABLED flag');
  } else {
    logger.warn('honcho disabled — HONCHO_API_KEY not set');
  }

  let partyOrchestrator: PartyOrchestrator | undefined;
  if (!config.PARTY_DISABLED) {
    partyStore.init(config.DB_PATH);
    partyDailyCap.init(config.DB_PATH);
    const personaDir =
      config.PARTY_PERSONA_DIR ||
      path.resolve(config.PERSONA_DIR, '..', 'thoth', 'party');
    const sandboxRoot = path.join(config.SANDBOX_ROOT, '_parties');
    await fs.mkdir(sandboxRoot, { recursive: true });
    partyOrchestrator = new PartyOrchestrator({
      claudeBin: config.CLAUDE_BIN,
      personaDir,
      sandboxRoot,
      dailyCapUsd: config.PARTY_DAILY_CAP_USD,
    });
    logger.info(
      {
        personaDir,
        sandboxRoot,
        defaultBudgetUsd: config.PARTY_DEFAULT_BUDGET_USD,
        dailyCapUsd: config.PARTY_DAILY_CAP_USD,
      },
      'party mode online',
    );
  } else {
    logger.warn('party mode disabled by PARTY_DISABLED flag');
  }

  if (!config.REFLECTION_DISABLED) {
    skillDraftStore.init(config.DB_PATH);
    dailyCostCap.init(config.DB_PATH);
    scheduledRunStore.init(config.DB_PATH);
    logger.info(
      {
        idleMin: config.REFLECTION_IDLE_MIN,
        maxBudgetUsd: config.REFLECTION_MAX_BUDGET_USD,
        dailyCapUsd: config.REFLECTION_DAILY_CAP_USD,
      },
      'reflection + scheduler stores ready',
    );
  } else {
    logger.warn('reflection disabled by REFLECTION_DISABLED flag');
  }

  let episodic: EpisodicStore | undefined;
  if (!config.EPISODIC_DISABLED) {
    episodic = new EpisodicStore(config.DB_PATH);
    try {
      const t0 = Date.now();
      await ensureEmbeddingsLoaded();
      logger.info(
        { warmupMs: Date.now() - t0, episodeCount: episodic.count() },
        'episodic memory online',
      );
    } catch (err) {
      logger.warn(
        { err: String(err) },
        'embedding model failed to warm; episodic recall will retry on first use',
      );
    }
  } else {
    logger.warn('episodic memory disabled by EPISODIC_DISABLED flag');
  }

  const app = new App({
    token: config.SLACK_BOT_TOKEN,
    appToken: config.SLACK_APP_TOKEN,
    ...(config.SLACK_SIGNING_SECRET
      ? { signingSecret: config.SLACK_SIGNING_SECRET }
      : {}),
    socketMode: true,
    logLevel:
      config.LOG_LEVEL === 'debug' ? LogLevel.DEBUG : LogLevel.WARN,
  });

  let orchestratorDeps: OrchestratorDeps | undefined;
  let idleDetector: IdleDetector | undefined;
  let schedulingPoller: SchedulingPoller | undefined;
  if (!config.REFLECTION_DISABLED && episodic) {
    orchestratorDeps = {
      client: app.client,
      honcho,
      episodic,
      sessionStore: store,
      claudeBin: config.CLAUDE_BIN,
      bridgeRepoRoot: config.BRIDGE_REPO_ROOT,
      founderUserIds: allowlist.list(),
      reflectionMaxBudgetUsd: config.REFLECTION_MAX_BUDGET_USD,
      dailyCapUsd: config.REFLECTION_DAILY_CAP_USD,
      reflectionDisabled: false,
    };
    idleDetector = new IdleDetector(
      orchestratorDeps,
      config.REFLECTION_IDLE_MIN * 60_000,
    );
    registerReactionHandlers({
      app,
      allowlist,
      episodic,
      honcho,
      bridgeRepoRoot: config.BRIDGE_REPO_ROOT,
    });
  }

  const handlerExports = registerHandlers({
    app,
    config,
    store,
    allowlist,
    personaPrompt: persona.prompt,
    honcho,
    episodic,
    orchestratorDeps,
    partyOrchestrator,
  });

  if (orchestratorDeps) {
    schedulingPoller = new SchedulingPoller({
      client: app.client,
      dispatch: handlerExports.dispatch,
    });
  }

  eventArchive.init(config.DB_PATH);
  eventArchive.start();

  let harvestInterval: NodeJS.Timeout | null = null;
  if (process.env.AUTO_HARVEST_DISABLED !== 'true' && episodic) {
    const HARVEST_INTERVAL_MS = 6 * 60 * 60 * 1000;
    const runHarvest = (): void => {
      if (!episodic) return;
      harvestSkills(
        { episodic, bridgeRepoRoot: config.BRIDGE_REPO_ROOT },
      )
        .then((r) => {
          if (r.proposed > 0 || r.clusters > 0) {
            logger.info(r, 'auto-harvest cycle');
          }
        })
        .catch((err) => logger.warn({ err: String(err) }, 'auto-harvest failed'));
    };
    setTimeout(runHarvest, 5 * 60 * 1000);
    harvestInterval = setInterval(runHarvest, HARVEST_INTERVAL_MS);
    logger.info({ intervalH: HARVEST_INTERVAL_MS / 3600000 }, 'auto-skill harvester scheduled');
  }

  provenanceStore.init(config.DB_PATH);

  ambientBudget.init(config.DB_PATH);
  let ambientAgent: AmbientAgent | undefined;
  if (process.env.AMBIENT_DISABLED !== 'true') {
    ambientAgent = new AmbientAgent({
      client: app.client,
      allowlistUserIds: allowlist.list(),
      announceChannelId: process.env.AMBIENT_ANNOUNCE_CHANNEL ?? null,
      dailyCapUsd: process.env.AMBIENT_DAILY_CAP_USD
        ? parseFloat(process.env.AMBIENT_DAILY_CAP_USD)
        : 1.0,
    });
    ambientAgent.start();
  } else {
    logger.warn('ambient agent disabled by AMBIENT_DISABLED');
  }

  const statusMonitor = new AnthropicStatusMonitor(
    path.join(config.BRIDGE_REPO_ROOT, 'runtime'),
  );
  await statusMonitor.init();
  if (process.env.ANTHROPIC_STATUS_DISABLED !== 'true') {
    statusMonitor.start();
    startStatusAnnouncer({
      client: app.client,
      allowlistUserIds: allowlist.list(),
      announceChannelId: process.env.ANTHROPIC_STATUS_ANNOUNCE_CHANNEL ?? null,
    });
  } else {
    logger.warn('anthropic status monitor disabled by ANTHROPIC_STATUS_DISABLED');
  }

  let dashboard: DashboardServer | undefined;
  if (!config.DASHBOARD_DISABLED) {
    dashboard = new DashboardServer({
      bridgeVersion: VERSION,
      startedAt: bridgeStartedAt,
      config: {
        HONCHO_WORKSPACE_ID: config.HONCHO_WORKSPACE_ID,
        HONCHO_DISABLED: config.HONCHO_DISABLED,
        EPISODIC_DISABLED: config.EPISODIC_DISABLED,
        REFLECTION_DISABLED: config.REFLECTION_DISABLED,
        REFLECTION_IDLE_MIN: config.REFLECTION_IDLE_MIN,
        REFLECTION_DAILY_CAP_USD: config.REFLECTION_DAILY_CAP_USD,
        DASHBOARD_PORT: config.DASHBOARD_PORT,
        DASHBOARD_BIND: config.DASHBOARD_BIND,
      },
      sessionStore: store,
      episodic,
      honcho,
      allowlist,
      bridgeRepoRoot: config.BRIDGE_REPO_ROOT,
      anthropicStatus: statusMonitor,
      ambientAgent,
      partyOrchestrator,
      slackClient: app.client,
      councilChannelId: process.env.COUNCIL_CHANNEL_ID ?? null,
      partyDailyCapUsd: config.PARTY_DAILY_CAP_USD,
    });
  } else {
    logger.warn('dashboard disabled by DASHBOARD_DISABLED flag');
  }

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down');
    idleDetector?.stop();
    schedulingPoller?.stop();
    statusMonitor.stop();
    try {
      await app.stop();
    } catch (err) {
      logger.warn({ err: String(err) }, 'app.stop threw');
    }
    try {
      await dashboard?.stop();
    } catch (err) {
      logger.warn({ err: String(err) }, 'dashboard.stop threw');
    }
    store.close();
    episodic?.close();
    skillDraftStore.close();
    eventArchive.close();
    provenanceStore.close();
    if (harvestInterval) clearInterval(harvestInterval);
    ambientAgent?.stop();
    ambientBudget.close();
    dailyCostCap.close();
    scheduledRunStore.close();
    partyStore.close();
    partyDailyCap.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.start();
  logger.info(
    {
      allowedUsers: allowlist.list(),
      sandboxRoot: config.SANDBOX_ROOT,
      personaDir: config.PERSONA_DIR,
      maxTurns: config.MAX_TURNS,
      maxBudgetUsd: config.MAX_BUDGET_USD,
      concurrencyCap: config.CONCURRENCY_CAP,
      honcho: honcho?.enabled
        ? { workspace: config.HONCHO_WORKSPACE_ID, online: true }
        : { online: false },
      episodic: episodic
        ? { online: true, episodes: episodic.count() }
        : { online: false },
      reflection: orchestratorDeps
        ? {
            online: true,
            idleMin: config.REFLECTION_IDLE_MIN,
            dailyCapUsd: config.REFLECTION_DAILY_CAP_USD,
          }
        : { online: false },
    },
    'thoth online (Socket Mode)',
  );

  idleDetector?.start();
  schedulingPoller?.start();

  if (dashboard) {
    try {
      await dashboard.start();
      const url = dashboard.url();
      // eslint-disable-next-line no-console
      console.log('\n  \x1b[36m▸\x1b[0m dashboard:  \x1b[1;36m' + url + '\x1b[0m\n');
      if (config.DASHBOARD_AUTO_OPEN) {
        const cmd =
          process.platform === 'win32'
            ? `start "" "${url}"`
            : process.platform === 'darwin'
              ? `open "${url}"`
              : `xdg-open "${url}"`;
        exec(cmd, (err) => {
          if (err) logger.debug({ err: String(err) }, 'auto-open browser failed');
        });
      }
    } catch (err) {
      logger.warn(
        { err: String(err), port: config.DASHBOARD_PORT },
        'dashboard failed to start — continuing without it',
      );
    }
  }
}
