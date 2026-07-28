import { z } from 'zod/v4'

// ADR-0020: the discovery document served at GET /api. URLs are absolute.
export const DiscoveryDocSchema = z.object({
  name: z.string().describe('Service name.'),
  version: z.string().describe('Service version.'),
  docs: z.string().describe('Absolute URL of the human-readable API docs.'),
  openapi: z.string().describe('Absolute URL of the OpenAPI spec.'),
  health: z.string().describe('Absolute URL of the liveness probe.'),
})
export type DiscoveryDoc = z.infer<typeof DiscoveryDocSchema>

export const HealthResponseSchema = z.object({
  ok: z.literal(true).describe('Always true while the server is up.'),
})
export type HealthResponse = z.infer<typeof HealthResponseSchema>

// ADR-0015: the operational snapshot the CLI's `status` view renders. Every
// field carries a default (ADR-0029) and is emitted even when nullish
// (ADR-0024) so a consumer always sees the full shape.
export const StatusResponseSchema = z.object({
  name: z.string().default('binp-git-graph').describe('Service name.'),
  version: z.string().default('0.1.0').describe('Service version.'),
  pid: z.number().int().default(0).describe('Process id of the running server.'),
  uptimeSeconds: z
    .number()
    .default(0)
    .describe('Seconds since this server process began listening.'),
  startedAt: z
    .string()
    .default('')
    .describe('ISO-8601 timestamp of when this server process started, or "" if unknown.'),
  host: z.string().default('').describe('Bind address the server is listening on.'),
  port: z.number().int().default(0).describe('Port the server is actually listening on.'),
  root: z.string().default('').describe('Absolute path of the served root scanned for repositories.'),
})
export type StatusResponse = z.infer<typeof StatusResponseSchema>
