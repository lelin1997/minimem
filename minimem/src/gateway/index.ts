export { createMCPServer, startMCPStdio } from './mcp-server.js';
export { createRestApp } from './rest-api.js';
export { authenticateRequest, authorizeToolCall, auditToolCall, TOOL_RISK_MAP } from './mcp-auth.js';
export { authMiddleware, requireWrite, requireDream, requireSnapshot } from './auth.js';
