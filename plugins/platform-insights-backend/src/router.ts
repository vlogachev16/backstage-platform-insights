import { HttpAuthService } from '@backstage/backend-plugin-api';
import { InputError } from '@backstage/errors';
import { z } from 'zod';
import express from 'express';
import Router from 'express-promise-router';
import { promises as fs } from 'fs';
import { TodoListService } from './services/TodoListService/types';

export async function createRouter({
  httpAuth,
  todoListService,
}: {
  httpAuth: HttpAuthService;
  todoListService: TodoListService;
}): Promise<express.Router> {
  const router = Router();
  router.use(express.json());

  // TEMPLATE NOTE:
  // Zod is a powerful library for data validation and recommended in particular
  // for user-defined schemas. In this case we use it for input validation too.
  //
  // If you want to define a schema for your API we recommend using Backstage's
  // OpenAPI tooling: https://backstage.io/docs/next/openapi/01-getting-started
  const todoSchema = z.object({
    title: z.string(),
    entityRef: z.string().optional(),
  });

  router.post('/todos', async (req, res) => {
    const parsed = todoSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new InputError(parsed.error.toString());
    }

    const result = await todoListService.createTodo(parsed.data, {
      credentials: await httpAuth.credentials(req, { allow: ['user'] }),
    });

    res.status(201).json(result);
  });

  // adding custom routers 

  router.get('/healthz', (_req, res) => {
    res.json({ status: 'ok' });
  });

  type Run = {
    status?: string;
    conclusion?: string;
    run_duration_ms?: number;
    created_at?: string;
    updated_at?: string;
    run_started_at?: string;
  };

  function parseRuns(json: any): Run[] {
    // Accept either an array or GitHub "workflow_runs" shape
    if (Array.isArray(json)) return json as Run[];
    if (json && Array.isArray(json.workflow_runs)) return json.workflow_runs as Run[];
    if (json && Array.isArray(json.runs)) return json.runs as Run[];
    throw new InputError('Invalid GHA runs JSON: expected array or {workflow_runs:[...]}.');
  }

  function durationMs(run: Run): number {
    if (typeof run.run_duration_ms === 'number') return run.run_duration_ms;
    // fallback: compute from timestamps if present
    const start =
      (run.run_started_at && Date.parse(run.run_started_at)) ||
      (run.created_at && Date.parse(run.created_at));
    const end = run.updated_at ? Date.parse(run.updated_at) : undefined;
    return start && end ? Math.max(0, end - start) : 0;
  }

  router.get('/v1/summary', async (_req, res) => {
    try {
      const path = process.env.GHA_RUNS_PATH || '/data/gha-runs.json';
      const raw = await fs.readFile(path, 'utf8');
      const data = JSON.parse(raw);
      const allRuns = parseRuns(data);

      const completed = allRuns
        .filter(r => (r.status || '').toLowerCase() === 'completed')
        .sort((a, b) => {
          const ta =
            Date.parse(a.updated_at || a.created_at || '') || 0;
          const tb =
            Date.parse(b.updated_at || b.created_at || '') || 0;
          return tb - ta;
        });

      const windowRuns = completed.slice(0, 10);
      const counts = windowRuns.reduce(
        (acc, r) => {
          const c = (r.conclusion || '').toLowerCase();
          if (c === 'success') acc.success += 1;
          else if (c === 'failure') acc.failure += 1;
          // ignore cancelled/skipped/etc for success rate calc per spec
          return acc;
        },
        { success: 0, failure: 0 },
      );

      const window = windowRuns.length;
      const totalConsidered = counts.success + counts.failure;
      const durations = windowRuns.map(durationMs);
      const mean =
        window > 0
          ? Math.round(durations.reduce((a, b) => a + b, 0) / window)
          : 0;

      const successRate =
        totalConsidered > 0 ? counts.success / totalConsidered : 0;

      res.json({
        window: 10,
        success_rate: successRate,
        mean_duration_ms: mean,
        counts,
      });
    } catch (e: any) {
      // Return a clean 500 with a short message; logs will have the stack
      res.status(500).json({ error: e?.message || 'Failed to compute summary' });
    }
  });

  return router;
}
