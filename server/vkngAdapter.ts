/**
 * Server-only adapter to VKNG's Supabase RPC boundary.
 * Never import this module into browser or iOS bundles.
 */
import type { VkngIntelligencePort, VkngObservation, VkngVehicleReference } from '../src/domain/vkngIntegration';

export interface VkngServerConfig {
  url: string;
  serviceKey: string;
  /** Wrynch ontology class name -> existing VKNG vkng_node.external_id for a component/part node. */
  componentMap: Record<string, string>;
}

type Fetcher = typeof fetch;

export function parseVkngComponentMap(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new Error('VKNG_COMPONENT_MAP_JSON must be valid JSON'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('VKNG_COMPONENT_MAP_JSON must be an object mapping Wrynch class names to VKNG component external IDs');
  }
  const entries = Object.entries(parsed as Record<string, unknown>);
  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!key.trim() || typeof value !== 'string' || !value.trim()) {
      throw new Error('VKNG component mappings must contain non-empty string keys and values');
    }
    out[key] = value.trim();
  }
  return out;
}

export function createVkngServerAdapter(config: VkngServerConfig, fetcher: Fetcher = fetch): VkngIntelligencePort {
  const base = config.url.trim().replace(/\/+$/, '').replace(/\/(rest|auth)\/v1$/, '');
  const key = config.serviceKey.trim();
  if (!/^https:\/\//i.test(base)) throw new Error('VKNG_SUPABASE_URL must be an HTTPS URL');
  if (!key) throw new Error('VKNG_SUPABASE_SERVICE_ROLE_KEY is required');

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${base}/rest/v1/rpc/${name}`, {
        method: 'POST',
        headers: {
          apikey: key,
          ...(key.startsWith('sb_') ? {} : { authorization: `Bearer ${key}` }),
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(args),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new Error('Could not reach VKNG. Check the VKNG Supabase URL and network settings.');
    }
    const body = await response.text();
    if (!response.ok) {
      // Don't return response bodies: database errors may expose schema or data.
      if (response.status === 401 || response.status === 403) throw new Error('VKNG rejected the server credentials or RPC permission.');
      if (response.status === 404) throw new Error(`VKNG RPC ${name} is missing. Apply VKNG migration 0003_wrynch_integration.sql.`);
      throw new Error(`VKNG RPC ${name} failed with HTTP ${response.status}.`);
    }
    try { return (body ? JSON.parse(body) : null) as T; } catch {
      throw new Error(`VKNG RPC ${name} returned invalid JSON.`);
    }
  }

  return {
    async resolveVehicle(input: VkngVehicleReference) {
      return rpc<{ canonicalVehicleId: string | null; resolution: 'resolved' | 'insufficient_evidence' | 'conflicted' }>('vkng_resolve_wrynch_vehicle', {
        p_tenant_id: input.tenantId,
        p_wrynch_vehicle_id: input.wrynchVehicleId,
        p_vin: input.vin,
        p_year: input.year,
        p_make: input.make,
        p_model: input.model,
        p_trim: input.trim,
      });
    },
    async recordObservation(input: VkngObservation) {
      if (!Object.values(config.componentMap).includes(input.component.canonicalComponentId)) {
        throw new Error('Observation component is not present in the configured VKNG component map.');
      }
      const result = await rpc<{ id: string; observationId: string }>('vkng_record_wrynch_observation', {
        p_tenant_id: input.tenantId,
        p_wrynch_observation_id: input.id,
        p_vehicle_id: input.vehicleId,
        p_component_external_id: input.component.canonicalComponentId,
        p_position: input.component.position ?? null,
        p_evidence: input.evidence,
        p_observed_at: input.observedAt,
        p_inspection_point_id: input.inspectionPointId ?? null,
        p_rating: input.rating ?? null,
        p_summary: input.summary,
      });
      return { id: result.observationId || result.id };
    },
    async getComponentHistory(input) {
      if (!Object.values(config.componentMap).includes(input.canonicalComponentId)) return [];
      return rpc('vkng_get_wrynch_component_history', {
        p_tenant_id: input.tenantId,
        p_vehicle_id: input.vehicleId,
        p_component_external_id: input.canonicalComponentId,
      });
    },
  };
}
