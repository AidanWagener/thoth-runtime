// @thoth-runtime/sdk
//
// Public types + plugin lifecycle for Thoth.

export const SDK_VERSION = '0.5.0';

// === Transport interface ============================================

export interface Transport {
  readonly name: string;
  init(runtime: TransportRuntime, config: unknown): Promise<void>;
  shutdown(): Promise<void>;
  send(event: SendEvent): Promise<MessageRef>;
  update(ref: MessageRef, event: SendEvent): Promise<void>;
}

export interface TransportRuntime {
  dispatchMessage(input: IncomingMessage): Promise<void>;
  dispatchReaction(input: IncomingReaction): Promise<void>;
}

export interface SendEvent {
  threadKey: string;
  text: string;
  blocks?: unknown;
}

export interface MessageRef {
  threadKey: string;
  externalId: string;
}

export interface IncomingMessage {
  transport: string;
  threadKey: string;
  peerId: string;
  text: string;
  ts: Date;
}

export interface IncomingReaction {
  transport: string;
  threadKey: string;
  messageId: string;
  emoji: string;
  reactorId: string;
  ts: Date;
}

// === Plugin lifecycle ===============================================

export interface PluginHooks {
  onPreSpawn?: (ctx: PreSpawnContext) => Promise<void> | void;
  onPostSpawn?: (ctx: PostSpawnContext) => Promise<void> | void;
  onReaction?: (ctx: ReactionContext) => Promise<void> | void;
  onReflection?: (ctx: ReflectionContext) => Promise<void> | void;
}

export interface PreSpawnContext {
  threadKey: string;
  promptText: string;
  cancel: (reason: string) => void;
}

export interface PostSpawnContext {
  threadKey: string;
  output: string;
  costUsd: number;
}

export interface ReactionContext {
  emoji: string;
  threadKey: string;
  messageId: string;
}

export interface ReflectionContext {
  threadKey: string;
  reflectionResult: unknown;
}

// === Skill format (agentskills.io v1 compatible) ====================

export interface SkillManifest {
  schema_version: 'agentskills.io/v1';
  name: string;
  version: string;
  title: string;
  description: string;
  author: string;
  license: string;
  tags?: readonly string[];
  language?: string;
  entry?: string;
  tools_allowed?: readonly string[];
  context?: 'fork' | 'inherit';
  thoth?: ThothSkillExtensions;
}

export interface ThothSkillExtensions {
  persona?: string;
  evolution_history?: readonly EvolutionHistoryEntry[];
  required_layers?: readonly MemoryLayer[];
  execution_environment?: ExecutionEnvironment;
  estimated_cost_usd?: number;
}

export interface EvolutionHistoryEntry {
  version: string;
  parent: string | null;
  mutation: 'compose' | 'refine' | 'fork' | 'merge' | null;
  reason?: string;
  reward_delta?: number;
  created_at: string;
}

export type MemoryLayer = 'working' | 'identity' | 'episodic' | 'procedural' | 'reflection';

export interface ExecutionEnvironment {
  sandbox: boolean;
  max_runtime_seconds?: number;
  max_cost_usd?: number;
}
