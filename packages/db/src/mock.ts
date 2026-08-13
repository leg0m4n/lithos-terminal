// Entry point for consumers that want mock Zircon data without a live
// database connection (e.g. the Next.js app in Phase 1). Deliberately does
// NOT import ./client, which throws eagerly if DATABASE_URL is unset.
export * from "./schema";
export * from "./mock-generator";
