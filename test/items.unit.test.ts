import assert from 'node:assert/strict';
import test from 'node:test';
import { ItemRepository } from '../src/items/repository.js';
import { InvalidItemError, ItemNotFoundError, ItemService } from '../src/items/service.js';
import { createFakeDatabase } from './helpers.js';

const row = {
  id: '4985cd13-60e5-4fd8-86c1-f06ac84c1aa1',
  name: 'Widget',
  description: 'A widget',
  created_at: new Date('2026-01-01T00:00:00.000Z'),
  updated_at: new Date('2026-01-01T00:00:00.000Z'),
};

test('repository uses parameterized SQL and maps database rows', async () => {
  let query = '';
  let values: unknown[] | undefined;
  const repository = new ItemRepository(
    createFakeDatabase(async (text, params) => {
      query = text;
      values = params;
      return { rows: [row], rowCount: 1 };
    }),
  );

  const item = await repository.create({ name: "Widget'); DROP TABLE items; --" });

  assert.match(query, /VALUES \(\$1, \$2\)/);
  assert.deepEqual(values, ["Widget'); DROP TABLE items; --", '']);
  assert.equal(item.id, row.id);
  assert.equal(item.createdAt, row.created_at.toISOString());
  assert.equal(item.updatedAt, row.updated_at.toISOString());
});

test('service normalizes names and reports missing records', async () => {
  const repository = new ItemRepository(
    createFakeDatabase(async (text) => ({
      rows: text.startsWith('INSERT') ? [row] : [],
      rowCount: text.startsWith('INSERT') ? 1 : 0,
    })),
  );
  const service = new ItemService(repository);

  const created = await service.create({ name: '  Widget  ' });
  assert.equal(created.name, 'Widget');
  await assert.rejects(service.create({ name: '   ' }), InvalidItemError);
  await assert.rejects(
    service.get('4985cd13-60e5-4fd8-86c1-f06ac84c1aa1'),
    ItemNotFoundError,
  );
  await assert.rejects(
    service.update('4985cd13-60e5-4fd8-86c1-f06ac84c1aa1', { name: 'Widget' }),
    ItemNotFoundError,
  );
  await assert.rejects(service.delete('4985cd13-60e5-4fd8-86c1-f06ac84c1aa1'), ItemNotFoundError);
});
