export { setupAuth, isAuthenticated, getSession } from "./replitAuth";
export { authStorage, type IAuthStorage } from "./storage";
export { registerAuthRoutes } from "./routes";
export { registerNativeAuthRoutes, hashPassword, verifyPassword } from "./nativeAuth";
export { requirePlatformAccess, invalidatePlatformAccessCache } from "./platformAccess";
