/**
 * Demo agent (zero LLM): public API for landing chat.
 */

export {
  createInitialState,
  runDemoAgent,
  getUiHints,
} from "./flow";
export { getSessionSeed } from "./availability";
export type { DemoAgentReply, DemoSessionState, DemoTraceEvent, DemoUiHints, DemoProgressStage } from "./types";
export { DEFAULT_DEMO_CATALOG } from "./catalog";
export * as demoAgentTools from "./tools";
