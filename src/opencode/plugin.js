import { createMediaRoutingHooks } from "./plugin-runtime.js";

// Keep this module's public surface to plugin functions only. OpenCode loads
// every plugin function exported by a local plugin module.
export const OmcRouterPlugin = async () => createMediaRoutingHooks();
