// @thoth-runtime/core — barrel exports.
//
// v0.5 ships as a monolith. All subsystems are accessible from this
// single import path. v0.6 will split slack + dashboard into peer
// packages (@thoth-runtime/transport-slack, @thoth-runtime/dashboard)
// when the Discord transport lands per SPEC-discord-transport.

export const VERSION = '0.5.0';

// Auth
export { authProbe } from './auth/probe';

// Configuration
export { loadConfig } from './config';
export type { Config } from './config';

// Bootstrap
export { loadPersonaStack } from './bootstrap/persona-loader';

// Logger
export { logger } from './logger';

// Claude subprocess
export * from './claude/spawn';
export * from './claude/stream-parser';

// Memory layers
export { HonchoClient } from './memory/honcho';
export { buildPeerRoster } from './memory/peers';
export { EpisodicStore } from './memory/episodic';
export { ensureEmbeddingsLoaded } from './memory/embeddings';
export * from './memory/recall';

// Reflection
export { dailyCostCap } from './reflection/daily-cap';
export { IdleDetector } from './reflection/idle-detector';
export type { OrchestratorDeps } from './reflection/orchestrator';
export * from './reflection/orchestrator';
export * from './reflection/parser';
export * from './reflection/prompts';
export * from './reflection/runner';
export * from './reflection/writers/honcho';
export * from './reflection/writers/memory';
export * from './reflection/writers/persona';
export * from './reflection/writers/skill';

// Sessions
export { SessionStore } from './session/store';

// Policy
export { Allowlist } from './policy/allowlist';

// Security
export * from './security/redact';

// Skills
export { skillDraftStore } from './skills/store';
export { harvestSkills } from './skills/harvest';
export * from './skills/manager';
export * from './skills/compile-from-party';
export * from './skills/marketplace';

// Party (multi-agent council)
export { partyStore } from './party/store';
export { partyDailyCap } from './party/budget';
export { PartyOrchestrator } from './party/orchestrator';
export * from './party/agents';
export * from './party/confidence';
export * from './party/slack-formatter';

// Ambient agents
export { ambientBudget } from './ambient/budget';
export { AmbientAgent } from './ambient/triggers';

// Scheduling
export { scheduledRunStore } from './scheduling/store';
export { SchedulingPoller } from './scheduling/poller';

// Provenance
export { provenanceStore } from './provenance/store';

// Status monitor (Anthropic)
export { AnthropicStatusMonitor } from './status/anthropic-status';
export { startStatusAnnouncer } from './status/slack-announcer';

// Slack transport (collapsed into core for v0.5)
export { registerHandlers } from './slack/handler';
export { registerReactionHandlers } from './slack/reactions';
export * from './slack/streaming';
export * from './slack/identity';

// Dashboard (collapsed into core for v0.5)
export { DashboardServer } from './dashboard/server';
export { eventArchive } from './dashboard/event-archive';
export * from './dashboard/event-bus';
