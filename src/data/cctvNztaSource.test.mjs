import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loadNztaSourcesFromOpenData,
  parseNztaCameras,
} from '../../server/providers/cctv/sources.js';

const camera = (fields) =>
  `<camera>${Object.entries(fields)
    .map(([tag, value]) => `<${tag}>${value}</${tag}>`)
    .join('')}</camera>`;

const SH1_BOMBAY = {
  description: 'SH1 Southern Motorway at Bombay &amp; SH2',
  direction: 'Northbound',
  highway: 'SH1',
  id: '832',
  imageUrl: '/camera/832.jpg',
  journey:
    '<id>12</id><name>SH1 Auckland</name><startLatitude>-36.8</startLatitude>',
  journeyLeg: '<name>Bombay to Drury</name>',
  latitude: '-37.188',
  longitude: '175.003',
  name: 'SH1 Bombay',
  offline: 'false',
  region: 'Auckland',
  underMaintenance: 'false',
};

const xml = (...cameras) =>
  `<?xml version="1.0"?><response>${cameras.join('')}</response>`;

test('NZTA camera becomes a pinned, high-confidence source', () => {
  const [source] = parseNztaCameras(xml(camera(SH1_BOMBAY)));
  assert.equal(source.id, 'nz-832');
  assert.equal(source.name, 'SH1 Southern Motorway at Bombay & SH2');
  assert.equal(source.city, 'Auckland, New Zealand');
  assert.equal(source.cityId, 'nz');
  assert.equal(source.lat, -37.188);
  assert.equal(source.lon, 175.003);
  assert.equal(source.url, 'https://trafficnz.info/camera/832.jpg');
  assert.equal(source.snapshotUrl, source.url);
  assert.equal(source.feedType, 'image');
  assert.equal(source.headingDeg, 0);
  assert.equal(source.headingConfidence, 'high');
  assert.equal(source.sourceKind, 'nzta-open-data');
});

test('NZTA journey names and ids never replace the camera fields', () => {
  const [source] = parseNztaCameras(
    xml(camera({ ...SH1_BOMBAY, description: '' })),
  );
  assert.equal(source.id, 'nz-832');
  assert.equal(source.name, 'SH1 Bombay');
});

test('NZTA skips offline, maintenance, off-path and out-of-country cameras', () => {
  const cameras = parseNztaCameras(
    xml(
      camera({ ...SH1_BOMBAY, id: '1', offline: 'true' }),
      camera({ ...SH1_BOMBAY, id: '2', underMaintenance: 'true' }),
      camera({ ...SH1_BOMBAY, id: '3', imageUrl: '/camera/../secret.jpg' }),
      camera({
        ...SH1_BOMBAY,
        id: '4',
        imageUrl: 'https://evil.example/4.jpg',
      }),
      camera({ ...SH1_BOMBAY, id: '5', latitude: '51.5', longitude: '-0.1' }),
      camera({ ...SH1_BOMBAY, id: 'abc' }),
      camera({ ...SH1_BOMBAY, id: '7' }),
    ),
  );
  assert.deepEqual(
    cameras.map((c) => c.id),
    ['nz-7'],
  );
});

test('NZTA camera without a travel direction gets a low-confidence heading', () => {
  const [source] = parseNztaCameras(
    xml(camera({ ...SH1_BOMBAY, direction: 'Both' })),
  );
  assert.equal(source.headingConfidence, 'low');
  assert.ok(Number.isFinite(source.headingDeg));
});

test('NZTA loader returns [] on an upstream failure', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('', { status: 503 }),
  );
  t.mock.method(console, 'warn', () => {});
  assert.deepEqual(await loadNztaSourcesFromOpenData(), []);
});

test('NZTA loader parses the live list shape', async (t) => {
  let requested = '';
  t.mock.method(globalThis, 'fetch', async (url) => {
    requested = String(url);
    return new Response(xml(camera(SH1_BOMBAY)), {
      status: 200,
      headers: { 'Content-Type': 'application/xml' },
    });
  });
  t.mock.method(console, 'log', () => {});
  const sources = await loadNztaSourcesFromOpenData();
  assert.equal(
    requested,
    'https://trafficnz.info/service/traffic/rest/4/cameras/all',
  );
  assert.deepEqual(
    sources.map((s) => s.id),
    ['nz-832'],
  );
});
