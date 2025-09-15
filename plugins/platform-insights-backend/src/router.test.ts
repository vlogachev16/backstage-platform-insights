// plugins/platform-insights-backend/src/service/router.test.ts
import express from 'express';
import request from 'supertest';
import { createRouter } from './router';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const mkDeps = () => ({
  // minimal stubs to satisfy createRouter signature
  httpAuth: { credentials: jest.fn().mockResolvedValue({}) },
  todoListService: { createTodo: jest.fn(), listTodos: jest.fn(), getTodo: jest.fn() },
});

describe('platform-insights routes', () => {
  test('GET /healthz returns ok (happy path)', async () => {
    const app = express().use(await createRouter(mkDeps()));
    await request(app).get('/healthz').expect(200, { status: 'ok' });
  });

  test('GET /v1/summary returns computed stats (happy path)', async () => {
    // Create a temporary file with two completed runs
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gha-'));
    const runsPath = path.join(dir, 'gha.json');
    fs.writeFileSync(
      runsPath,
      JSON.stringify({
        runs: [
          { status: 'completed', conclusion: 'success', run_duration_ms: 1000, updated_at: '2025-01-01T00:00:02Z' },
          { status: 'completed', conclusion: 'failure', run_duration_ms: 3000, updated_at: '2025-01-01T00:00:01Z' },
        ],
      }),
    );
    process.env.GHA_RUNS_PATH = runsPath;

    const app = express().use(await createRouter(mkDeps()));
    const res = await request(app).get('/v1/summary').expect(200);

    expect(res.body).toEqual({
      window: 10,
      success_rate: 0.5,
      mean_duration_ms: 2000,
      counts: { success: 1, failure: 1 },
    });
  });

  test('GET /v1/summary returns 500 when file is missing (unhappy path)', async () => {
    process.env.GHA_RUNS_PATH = '/no/such/file.json'; // simplest failure

    const app = express().use(await createRouter(mkDeps()));
    const res = await request(app).get('/v1/summary').expect(500);

    expect(res.body).toHaveProperty('error'); // don’t assert OS-specific text
  });
});
