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
