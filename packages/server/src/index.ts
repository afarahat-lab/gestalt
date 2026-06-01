/**
 * @gestalt/server — public exports.
 */
export { createApp } from './app';
export { startServer } from './server';
export { registerAuthMiddleware, requireRole } from './auth/middleware';
export { createAuthManager } from './auth/auth-manager';
export { issueToken, verifyToken, extractToken } from './auth/session';
export { resolveRole, isDenied, isPlatformAdmin } from './auth/role-mapper';
export { emitLiveEvent, eventBus } from './events';
export { registerOversightRoutes } from './oversight/routes';
export { buildAlert, resolveChannels, sendAlertNotification } from './oversight/alert-router';
export type { AlertRoute, AlertRouterConfig, NotificationChannel } from './oversight/alert-router';
export type { PlatformUser, LiveEvent, LiveEventType, EventBus } from './types';
