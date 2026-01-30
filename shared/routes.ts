
import { z } from 'zod';
import { insertCallSchema, insertSettingsSchema, calls, metrics, alerts, settings } from './schema';

export const errorSchemas = {
  validation: z.object({
    message: z.string(),
    field: z.string().optional(),
  }),
  notFound: z.object({
    message: z.string(),
  }),
  internal: z.object({
    message: z.string(),
  }),
};

export const api = {
  dashboard: {
    stats: {
      method: 'GET' as const,
      path: '/api/dashboard/stats',
      responses: {
        200: z.object({
          activeCalls: z.number(),
          avgMos: z.number(),
          alertsToday: z.number(),
          systemHealth: z.enum(['Healthy', 'Degraded', 'Critical']),
        }),
      },
    },
  },
  calls: {
    list: {
      method: 'GET' as const,
      path: '/api/calls',
      input: z.object({
        limit: z.coerce.number().optional(),
      }).optional(),
      responses: {
        200: z.array(z.custom<typeof calls.$inferSelect & { latestMetric?: typeof metrics.$inferSelect }>()),
      },
    },
    get: {
      method: 'GET' as const,
      path: '/api/calls/:id',
      responses: {
        200: z.custom<typeof calls.$inferSelect>(),
        404: errorSchemas.notFound,
      },
    },
    metrics: {
      method: 'GET' as const,
      path: '/api/calls/:id/metrics',
      responses: {
        200: z.array(z.custom<typeof metrics.$inferSelect>()),
      },
    },
  },
  alerts: {
    list: {
      method: 'GET' as const,
      path: '/api/alerts',
      responses: {
        200: z.array(z.custom<typeof alerts.$inferSelect>()),
      },
    },
  },
  settings: {
    get: {
      method: 'GET' as const,
      path: '/api/settings',
      responses: {
        200: z.custom<typeof settings.$inferSelect>(),
      },
    },
    update: {
      method: 'PATCH' as const,
      path: '/api/settings',
      input: insertSettingsSchema.partial(),
      responses: {
        200: z.custom<typeof settings.$inferSelect>(),
      },
    },
    resetSimulation: {
      method: 'POST' as const,
      path: '/api/settings/simulation/reset',
      responses: {
        200: z.object({ message: z.string() }),
      },
    },
  },
};

export function buildUrl(path: string, params?: Record<string, string | number>): string {
  let url = path;
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (url.includes(`:${key}`)) {
        url = url.replace(`:${key}`, String(value));
      }
    });
  }
  return url;
}
