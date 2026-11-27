import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import axios from 'axios';
import { GlobalConfigSchema, InputsConfigSchema, type InputsConfig } from '../../src/config/schemas/config.schema';
import { resolvePairedPlex } from '../../src/dashboards/pairing';
import { PlexPlugin } from '../../src/plugins/inputs/PlexPlugin';
import { TautulliPlugin } from '../../src/plugins/inputs/TautulliPlugin';
import { createContractHttpClient, type ContractHttpClient } from '../fixtures/contract-http';
import { loadFixture } from '../contracts/registry';

const warn = vi.hoisted(() => vi.fn());

vi.mock('../../src/core/Logger', () => {
  const logger = { info: vi.fn(), debug: vi.fn(), warn, error: vi.fn() };
  return { createLogger: () => logger, withContext: (base: unknown) => base };
});

vi.mock('axios', () => ({ default: { create: vi.fn() } }));

const PMS_IDENTIFIER = loadFixture<{ response: { data: { pms_identifier: string } } }>('tautulli/get-server-info').response.data
  .pms_identifier;

const TAUTULLI_URL = 'http://tautulli.test:8181';
const PLEX_1_URL = 'http://plex-1.test:32400';
const PLEX_2_URL = 'http://plex-2.test:32400';

let clients: Map<string, ContractHttpClient>;

function inputs(raw: Record<string, unknown>): InputsConfig {
  return InputsConfigSchema.parse(raw);
}

const tautulli = { id: 1, url: TAUTULLI_URL, apiKey: 'key' };
const plex1 = { id: 1, url: PLEX_1_URL, token: 'token' };
const plex2 = { id: 2, url: PLEX_2_URL, token: 'token' };
const global = GlobalConfigSchema.parse({});

beforeEach(() => {
  warn.mockClear();
  clients = new Map([
    [TAUTULLI_URL, createContractHttpClient('tautulli')],
    [PLEX_1_URL, createContractHttpClient('plex')],
    [PLEX_2_URL, createContractHttpClient('plex')],
  ]);
  clients.get(PLEX_1_URL)?.override('/identity', (_params, _path) => ({
    MediaContainer: { ...loadFixture<{ MediaContainer: object }>('plex/identity').MediaContainer, machineIdentifier: PMS_IDENTIFIER },
  }));
  (axios.create as Mock).mockImplementation((config: { baseURL: string }) => clients.get(config.baseURL));
});

describe('server identifiers', () => {
  it('reads the Plex server Tautulli watches', async () => {
    const plugin = new TautulliPlugin();
    await plugin.initialize(inputs({ tautulli: [tautulli] }).tautulli?.[0] as never, global);

    expect(await plugin.pmsIdentifier()).toBe(PMS_IDENTIFIER);
  });

  it('reads the Plex machine identifier', async () => {
    const plugin = new PlexPlugin();
    await plugin.initialize(inputs({ plex: [plex2] }).plex?.[0] as never, global);

    expect(await plugin.machineIdentifier()).toBe(loadFixture<{ MediaContainer: { machineIdentifier: string } }>('plex/identity').MediaContainer.machineIdentifier);
  });
  it('rejects an empty Tautulli answer', async () => {
    const client = clients.get(TAUTULLI_URL) as ContractHttpClient;
    const info = loadFixture<{ response: { data: object } }>('tautulli/get-server-info');
    client.override('/api/v2?cmd=get_server_info', { ...info, response: { ...info.response, data: { ...info.response.data, pms_identifier: '' } } });
    const plugin = new TautulliPlugin();
    await plugin.initialize(inputs({ tautulli: [tautulli] }).tautulli?.[0] as never, global);

    await expect(plugin.pmsIdentifier()).rejects.toThrow('Tautulli reports no Plex server identifier');
  });

  it('rejects an empty Plex answer', async () => {
    (clients.get(PLEX_2_URL) as ContractHttpClient).override('/identity', { MediaContainer: { size: 0 } });
    const plugin = new PlexPlugin();
    await plugin.initialize(inputs({ plex: [plex2] }).plex?.[0] as never, global);

    await expect(plugin.machineIdentifier()).rejects.toThrow('Plex reports no machine identifier');
  });
});

describe('resolvePairedPlex', () => {
  it('pairs the Plex instance whose identifier Tautulli reports', async () => {
    const paired = await resolvePairedPlex({ inputs: inputs({ tautulli: [tautulli], plex: [plex1, plex2] }), global });

    expect(paired).toEqual(new Map([[1, [1]]]));
    expect(warn).not.toHaveBeenCalled();
  });

  it('makes no request without Tautulli', async () => {
    const paired = await resolvePairedPlex({ inputs: inputs({ plex: [plex1] }), global });

    expect(paired.size).toBe(0);
    expect(axios.create).not.toHaveBeenCalled();
  });

  it('makes no request without Plex', async () => {
    const paired = await resolvePairedPlex({ inputs: inputs({ tautulli: [tautulli] }), global });

    expect(paired.size).toBe(0);
    expect(axios.create).not.toHaveBeenCalled();
  });

  it('gives Tautulli priority over every Plex instance when a lookup fails', async () => {
    const down = clients.get(TAUTULLI_URL) as ContractHttpClient;
    down.get = vi.fn().mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));

    const paired = await resolvePairedPlex({ inputs: inputs({ tautulli: [tautulli], plex: [plex1, plex2] }), global });

    expect(paired).toEqual(new Map([[1, [1]], [2, [1]]]));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Could not pair Tautulli with Plex (connect ECONNREFUSED); Tautulli takes priority over every Plex instance'));
  });
});
