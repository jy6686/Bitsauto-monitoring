import { pgView } from 'drizzle-orm/pg-core';
import { integer, varchar, text, timestamp } from 'drizzle-orm/pg-core';

// Phase 1 compat view over canonical destinations table.
// Column types match destinations_v exactly (verified via information_schema).
// Remove at Phase 1 Step 10 when global_destinations is retired.
export const destinationsView = pgView('destinations_v', {
  id:               integer('id'),
  parentId:         integer('parent_id'),
  level:            integer('level'),
  name:             text('name'),
  countryCode:      varchar('country_code', { length: 3 }),
  dialPrefix:       text('dial_prefix'),
  operatorName:     text('operator_name'),
  commercialStatus: text('commercial_status'),
  sortOrder:        integer('sort_order'),
  notes:            text('notes'),
  blockedReason:    text('blocked_reason'),
  createdAt:        timestamp('created_at', { withTimezone: true }),
}).existing();
