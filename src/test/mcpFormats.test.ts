import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { extractModelNames, jsonPayload, parseModelFieldRecords, parseReferences, parseTronRecords } from '../util/fuuzParse';
import { flipArgs, isArgShapeError, shapeArgs } from '../util/mcpArgs';
import { FuuzMcpClient } from '../services/fuuzMcpClient';

/**
 * Real responses captured from Fuuz MCP servers (schema metadata only):
 *   - OLD: Instinct `mesUat` (qa) — `where`/`orderBy` are JSON strings, TRON out.
 *   - NEW: Instinct `mes` / App Dev (platform 2026.9.1) — `where` is an object,
 *     a string is rejected, and `system_query_model` answers in JSON by default.
 */
const OLD_QUERY = [
  'Retrieved 3 record(s) from ModuleGroup. Results in TRON format:',
  '',
  'class A: id,name',
  '',
  '[A("applications","Applications"),A("customerRelationshipManagement","Customer Relationship Management"),A("documentation","Documentation")]',
].join('\n');

const NEW_QUERY = [
  'Retrieved 3 record(s) from ModuleGroup. Results in JSON format:',
  '',
  '[{"id":"applications","name":"Applications"},{"id":"customerRelationshipManagement","name":"Customer Relationship Management"},{"id":"documentation","name":"Documentation"}]',
].join('\n');

const NESTED_FIELDS = [
  'Found 4 field(s) across 2 model(s). Results in TRON format:',
  '',
  'class A: name,fields',
  'class B: name,type,description',
  '',
  '[A("Module",[B("id","ID!","The unique identifier of the Module."),B("moduleGroup","ModuleGroup!","A relation to the module group the module is in.")]),' +
    'A("ModuleGroup",[B("id","ID!","The unique identifier of the ModuleGroup."),B("modules","[Module!]","A relation to the modules in this module group.")])]',
].join('\n');

const OLD_WHERE_REJECTED = [
  'MCP error -32602: Input validation error: Invalid arguments for tool system_query_model: [',
  '  {',
  '    "expected": "string",',
  '    "code": "invalid_type",',
  '    "path": [',
  '      "where"',
  '    ],',
  '    "message": "Invalid input: expected string, received object"',
  '  }',
  ']',
].join('\n');

const NEW_WHERE_REJECTED = 'Input validation error: Invalid arguments for tool system_query_model: data/where must be object';

const GROUPS = [
  { id: 'applications', name: 'Applications' },
  { id: 'customerRelationshipManagement', name: 'Customer Relationship Management' },
  { id: 'documentation', name: 'Documentation' },
];

// --- Parsers -------------------------------------------------------------

test('parseTronRecords: TRON (old) and JSON (new) query responses yield the same records', () => {
  assert.deepEqual(parseTronRecords(OLD_QUERY), GROUPS);
  assert.deepEqual(parseTronRecords(NEW_QUERY), GROUPS);
});

test('parseTronRecords: JSON values are flattened to strings; nested objects to dotted keys', () => {
  const text = 'Retrieved 1 record(s) from DataFlow. Results in JSON format:\n\n' +
    '[{"id":"f1","active":true,"count":3,"moduleId":null,"dataFlowType":{"name":"Backend"},"tags":["a"]}]';
  assert.deepEqual(parseTronRecords(text), [
    { id: 'f1', active: 'true', count: '3', moduleId: '', 'dataFlowType.name': 'Backend', tags: '["a"]' },
  ]);
});

test('parseTronRecords: an error that embeds JSON is not mistaken for records', () => {
  assert.deepEqual(parseTronRecords(OLD_WHERE_REJECTED), []);
  assert.deepEqual(parseTronRecords(NEW_WHERE_REJECTED), []);
  assert.equal(jsonPayload(OLD_WHERE_REJECTED), undefined);
});

test('parseModelFieldRecords: nested A(name, fields[B(...)]) picks the field class', () => {
  const recs = parseModelFieldRecords(NESTED_FIELDS);
  assert.deepEqual(recs.map(r => [r.name, r.type]), [
    ['id', 'ID!'], ['moduleGroup', 'ModuleGroup!'], ['id', 'ID!'], ['modules', '[Module!]'],
  ]);
  assert.equal(recs[1].description, 'A relation to the module group the module is in.');
});

test('parseModelFieldRecords: JSON envelope of models with field objects', () => {
  const text = 'Found 2 field(s) across 1 model(s). Results in JSON format:\n\n' +
    '[{"name":"Module","fields":[{"name":"id","type":"ID!","description":"Id."},{"name":"moduleGroup","type":"ModuleGroup!"}]}]';
  assert.deepEqual(parseModelFieldRecords(text), [
    { name: 'id', type: 'ID!', description: 'Id.' },
    { name: 'moduleGroup', type: 'ModuleGroup!', description: '' },
  ]);
});

test('extractModelNames: multi-class TRON and grouped JSON', () => {
  const tron = 'class A: name,customFieldsExposed,description\nclass B: name,customFieldsExposed,dataChangeExposed,description\n\n' +
    '{"Reference":{"system":{"accessControl":[A("AccessType",false,"x"),B("AuthenticationEvent",false,false,"y")]}}}';
  assert.deepEqual(extractModelNames(tron), ['AccessType', 'AuthenticationEvent']);
  const json = 'Found 2 model(s). Results in JSON format:\n\n' +
    '{"Reference":{"system":{"accessControl":[{"name":"User","description":"u"},{"name":"Tenant"}]}}}';
  assert.deepEqual(extractModelNames(json), ['Tenant', 'User']);
});

test('parseReferences: JSON reference rows parse like TRON ones', () => {
  const text = 'Found 2 reference(s). Results in JSON format:\n\n' +
    '[{"fromModelName":"Module","fromModelFieldName":"moduleGroupId","fromModelRelationType":"ModuleGroup!","toModelName":"ModuleGroup","toModelFieldName":"id"},' +
    '{"fromModelName":"Module","fromModelFieldName":"createdByUserId","fromModelRelationType":"User!","toModelName":"User","toModelFieldName":"id"}]';
  assert.deepEqual(parseReferences(text), [{ from: 'Module', to: 'ModuleGroup', label: 'moduleGroupId', many: false }]);
});

// --- Argument shaping ----------------------------------------------------

const OLD_SCHEMA = { properties: { where: { type: 'string' }, orderBy: { type: 'string' } } };
const NEW_SCHEMA = { properties: { where: { type: 'object' }, orderBy: { type: 'array' } } };

test('shapeArgs: follows each server schema; leaves other args and unknown schemas alone', () => {
  const args = { service: 'application', where: '{"name":{"_eq":"X"}}', orderBy: [{ field: 'name', direction: 'asc' }] };
  assert.deepEqual(shapeArgs(args, NEW_SCHEMA), { service: 'application', where: { name: { _eq: 'X' } }, orderBy: [{ field: 'name', direction: 'asc' }] });
  assert.deepEqual(shapeArgs(args, OLD_SCHEMA), { service: 'application', where: '{"name":{"_eq":"X"}}', orderBy: '[{"field":"name","direction":"asc"}]' });
  assert.equal(shapeArgs(args, undefined), args);
  assert.deepEqual(shapeArgs({ where: '' }, NEW_SCHEMA), { where: {} }, 'blank where means "all records"');
  assert.deepEqual(shapeArgs({ where: 'not json' }, NEW_SCHEMA), { where: 'not json' }, 'unparseable passes through');
});

test('flipArgs / isArgShapeError: recognize both versions\' rejections, flip the shape', () => {
  assert.ok(isArgShapeError(OLD_WHERE_REJECTED));
  assert.ok(isArgShapeError(NEW_WHERE_REJECTED));
  assert.ok(!isArgShapeError(NEW_QUERY));
  assert.deepEqual(flipArgs({ where: '{}', first: 3 }), { where: {}, first: 3 });
  assert.deepEqual(flipArgs({ where: {} }), { where: '{}' });
});

// --- Client end-to-end against simulated old / new servers --------------

type Version = 'old' | 'new';
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/**
 * A minimal streamable-HTTP MCP server that validates `where` the way each
 * version does and answers in that version's format. `listTools: false`
 * simulates a tenant whose tools/list fails (no schema to shape from).
 */
function fakeServer(version: Version, opts: { listTools?: boolean } = {}) {
  const calls: any[] = [];
  const whereType = version === 'old' ? 'string' : 'object';
  globalThis.fetch = (async (_url: any, init: any) => {
    const req = JSON.parse(init.body);
    const reply = (result: any) => new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }), {
      status: 200, headers: { 'Content-Type': 'application/json', 'mcp-session-id': 's1' },
    });
    if (req.method === 'initialize') return reply({ serverInfo: { name: `Fuuz MCP Server: Test / ${version}` } });
    if (req.method === 'notifications/initialized') return new Response('', { status: 202 });
    if (req.method === 'tools/list') {
      if (opts.listTools === false) return new Response(JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32603, message: 'boom' } }), { status: 200 });
      const tool = (name: string) => ({ name, inputSchema: { type: 'object', properties: { where: { type: whereType } } } });
      return reply({ tools: [tool('system_query_model'), tool('system_list_model_fields'), { name: 'system_list_models', inputSchema: { type: 'object', properties: {} } }] });
    }
    if (req.method === 'tools/call') {
      const { name, arguments: args } = req.params;
      calls.push({ name, where: args.where });
      const text = (t: string) => reply({ content: [{ type: 'text', text: t }] });
      if ('where' in args && typeof args.where !== whereType) return text(version === 'old' ? OLD_WHERE_REJECTED : NEW_WHERE_REJECTED);
      if (name === 'system_query_model') {
        if (args.modelName !== 'ModuleGroup') return text(version === 'old' ? 'Retrieved 0 record(s). Results in TRON format:' : 'Retrieved 0 record(s). Results in JSON format:\n\n[]');
        return text(version === 'old' ? OLD_QUERY : NEW_QUERY);
      }
      if (name === 'system_list_model_fields') return text(NESTED_FIELDS);
      return text('');
    }
    return new Response('', { status: 404 });
  }) as typeof fetch;
  return calls;
}

for (const version of ['old', 'new'] as Version[]) {
  test(`queryModel on a ${version} server: args shaped from schema, records parsed`, async () => {
    const calls = fakeServer(version);
    const { records } = await new FuuzMcpClient().queryModel('https://mcp.test/mcp', 'T', 'ModuleGroup', ['id', 'name'], '{}');
    assert.deepEqual(records, GROUPS);
    assert.equal(calls.length, 1, 'no rejected first attempt');
    assert.equal(typeof calls[0].where, version === 'old' ? 'string' : 'object');
  });

  test(`queryModel on a ${version} server without tools/list: flips shape after a rejection`, async () => {
    const calls = fakeServer(version, { listTools: false });
    const { records } = await new FuuzMcpClient().queryModel('https://mcp.test/mcp', 'T', 'ModuleGroup', ['id', 'name'], '{}');
    assert.deepEqual(records, GROUPS);
    assert.ok(calls.length <= 2);
  });

  test(`fetchModelElements on a ${version} server reads nested field classes`, async () => {
    fakeServer(version);
    const fields = await new FuuzMcpClient().fetchModelElements('https://mcp.test/mcp', 'T', 'Module');
    assert.deepEqual(fields.map(f => f.name), ['id', 'moduleGroup', 'id', 'modules']);
  });

  test(`loadMcpSnapshot on a ${version} server loads module groups`, async () => {
    fakeServer(version);
    const snap = await new FuuzMcpClient().loadMcpSnapshot('https://mcp.test/mcp', 'T');
    assert.ok(snap);
    assert.deepEqual(snap!.application.map(g => g.id).sort(), GROUPS.map(g => g.id));
    assert.ok(!snap!.issues.some(i => /Input validation error/.test(i)), `issues: ${snap!.issues.join(' | ')}`);
  });
}
