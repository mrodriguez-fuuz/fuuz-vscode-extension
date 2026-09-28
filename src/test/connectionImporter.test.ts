import './helpers/vscodeMock';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionImporter } from '../services/connectionImporter';
import { TenantConfigurationManager } from '../services/tenantConfigurationManager';
import { TokenStore } from '../services/tokenStore';
import { makeContext, resetVscodeMock } from './helpers/vscodeMock';

/** Forge a JWT (`header.payload.sig`) whose payload carries the given claims. */
function jwt(claims: Record<string, any>): string {
  const b64url = Buffer.from(JSON.stringify(claims)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `eyJhbGciOiJub25lIn0.${b64url}.sig`;
}

function setup(probes: any[]) {
  resetVscodeMock();
  const context = makeContext();
  const tokenStore = new TokenStore(context.secrets);
  const mgr = new TenantConfigurationManager(context, tokenStore);
  const probed: string[] = [];
  const mcpClient: any = { probeEndpoints: async (ep: any) => { probed.push(ep.mcp); return probes; } };
  const importer = new ConnectionImporter(mgr, tokenStore, mcpClient);
  return { mgr, tokenStore, importer, probed };
}

const availableMcp = [{ key: 'mcp', label: 'MCP', url: 'https://api.build.mfgx.fuuz.app/mcp', state: 'available', serverName: 'Fuuz: Acme / Plant A' }];

test('rejects a token that is not a JWT', async () => {
  const { importer } = setup(availableMcp);
  await assert.rejects(() => importer.importByToken('not-a-jwt'), /not a valid JWT/);
});

test('rejects a JWT missing tenant/enterprise/host claims', async () => {
  const { importer } = setup(availableMcp);
  await assert.rejects(() => importer.importByToken(jwt({ aud: 'build.mfgx.fuuz.app' })), /missing tenant\/enterprise\/host claims/);
});

test('rejects when the MCP probe is unavailable', async () => {
  const { importer } = setup([{ key: 'mcp', label: 'MCP', url: 'https://api.build.mfgx.fuuz.app/mcp', state: 'unauthorized', detail: '401' }]);
  const token = jwt({ aud: 'build.mfgx.fuuz.app', tenantId: 't1', enterpriseId: 'e1' });
  await assert.rejects(() => importer.importByToken(token), /did not validate against the MCP server/);
});

test('createdEnterprise=true for a new enterprise; stores token + names from server', async () => {
  const { importer, tokenStore } = setup(availableMcp);
  const token = jwt({ aud: 'build.mfgx.fuuz.app', tenantId: 't1', enterpriseId: 'e1' });
  const res = await importer.importByToken(token);
  assert.equal(res.createdEnterprise, true);
  assert.equal(res.environment, 'build.mfgx');
  assert.equal(res.enterpriseName, 'Acme');
  assert.equal(res.tenantName, 'Plant A');
  assert.equal(await tokenStore.getToken('e1', 't1'), token);
});

test('createdEnterprise=false when the enterprise already exists', async () => {
  const { importer, mgr } = setup(availableMcp);
  await mgr.addOrUpdateEnterprise({ id: 'e1', name: 'Existing Ent', environment: 'build.mfgx', mcpEndpoint: 'https://api.build.mfgx.fuuz.app', tenants: [] });
  const token = jwt({ aud: 'build.mfgx.fuuz.app', tenantId: 't1', enterpriseId: 'e1' });
  const res = await importer.importByToken(token);
  assert.equal(res.createdEnterprise, false);
  assert.equal(res.enterpriseName, 'Existing Ent', 'existing enterprise name is preserved');
  assert.equal(mgr.getTenant('e1', 't1')?.name, 'Plant A');
});

test('a key from another environment is pinned on the tenant and probed against its own host', async () => {
  const { importer, mgr, probed } = setup(availableMcp);
  await mgr.addOrUpdateEnterprise({ id: 'e1', name: 'Ent', environment: 'build.mfgx', mcpEndpoint: 'https://api.build.mfgx.fuuz.app', tenants: [] });
  await importer.importByToken(jwt({ aud: 'qa.mfgx.fuuz.app', tenantId: 'q1', enterpriseId: 'e1' }));

  assert.deepEqual(probed, ['https://api.qa.mfgx.fuuz.app/mcp']);
  assert.equal(mgr.getEnterprise('e1')?.environment, 'build.mfgx', 'enterprise environment unchanged');
  const tenant = mgr.getTenant('e1', 'q1')!;
  assert.equal(tenant.environment, 'qa.mfgx');
  assert.equal(mgr.getMcpServerUrl(mgr.getEnterprise('e1')!, tenant), 'https://api.qa.mfgx.fuuz.app/mcp');
});

test('a key from the enterprise environment leaves the tenant inheriting', async () => {
  const { importer, mgr, probed } = setup(availableMcp);
  await mgr.addOrUpdateEnterprise({ id: 'e1', name: 'Ent', environment: 'build.mfgx', mcpEndpoint: 'https://api.build.mfgx.fuuz.app', tenants: [] });
  await importer.importByToken(jwt({ aud: 'build.mfgx.fuuz.app', tenantId: 't1', enterpriseId: 'e1' }));
  assert.deepEqual(probed, ['https://api.build.mfgx.fuuz.app/mcp']);
  assert.equal(mgr.getTenant('e1', 't1')?.environment, undefined);
});
