import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// The dashboard types are mirrors of schema.prisma (packages/shared/src/records.ts). This test is
// the runtime half of that promise: if the schema renames a field, changes its nullability or an
// enum value, CI fails here instead of the UI silently drifting. (Needs `pnpm --filter
// @sirat/shared build` first, which CI runs before the tests.)
const shared = createRequire(import.meta.url)('@sirat/shared') as typeof import('@sirat/shared');
const schema = readFileSync(new URL('../../../api/prisma/schema.prisma', import.meta.url), 'utf8');

function block(kind: 'model' | 'enum', name: string): string[] {
  const match = new RegExp(`^${kind} ${name} \\{([\\s\\S]*?)^\\}`, 'm').exec(schema);
  assert.ok(match?.[1], `${kind} ${name} is missing from schema.prisma`);
  return match[1]
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line && !line.startsWith('@@'));
}

const modelNames = new Set([...schema.matchAll(/^model (\w+) \{/gm)].map((m) => m[1]));

test('enum values match schema.prisma exactly (order included)', () => {
  const enums: Record<string, readonly string[]> = {
    Role: shared.ROLES,
    Category: shared.CATEGORIES,
    PaymentStatus: shared.PAYMENT_STATUSES,
    AttemptStatus: shared.ATTEMPT_STATUSES,
    ...shared.SCHEMA_ENUMS,
  };
  for (const [name, values] of Object.entries(enums)) {
    const fromSchema = block('enum', name).map((line) => line.split(/\s+/)[0]);
    assert.deepEqual([...values], fromSchema, `enum ${name}`);
  }
});

test('every mirrored field exists as a scalar with the same nullability', () => {
  for (const [model, fields] of Object.entries(shared.RECORD_FIELDS)) {
    const columns = new Map(
      block('model', model).map((line) => {
        const [field = '', type = ''] = line.split(/\s+/);
        return [field, type] as const;
      }),
    );
    for (const [field, nullability] of Object.entries(fields)) {
      const type = columns.get(field);
      assert.ok(type, `${model}.${field} is not in schema.prisma`);
      const base = type.replace(/[?[\]]/g, '');
      assert.ok(
        !modelNames.has(base) && !type.endsWith('[]'),
        `${model}.${field} is a relation, not a column`,
      );
      assert.equal(
        type.endsWith('?') ? 'opt' : 'req',
        nullability,
        `${model}.${field} nullability`,
      );
    }
  }
});

test('server-only columns are never mirrored to the web', () => {
  const forbidden = ['passwordHash', 'gatewayPayload', 'layout', 'tokenHash', 'payload'];
  for (const [model, fields] of Object.entries(shared.RECORD_FIELDS)) {
    for (const field of forbidden)
      assert.ok(!(field in fields), `${model}.${field} must stay server-side`);
  }
});
