import type { DatabasePool } from '../db/pool.js';
import type { CreateItemInput, Item, UpdateItemInput } from './types.js';

interface ItemRow {
  id: string;
  name: string;
  description: string;
  created_at: Date;
  updated_at: Date;
}

function toItem(row: ItemRow): Item {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export class ItemRepository {
  constructor(private readonly db: DatabasePool) {}

  async create(input: CreateItemInput): Promise<Item> {
    const { rows } = await this.db.query<ItemRow>(
      `INSERT INTO items (name, description)
       VALUES ($1, $2)
       RETURNING id, name, description, created_at, updated_at`,
      [input.name, input.description ?? ''],
    );
    return toItem(rows[0]!);
  }

  async list(): Promise<Item[]> {
    const { rows } = await this.db.query<ItemRow>(
      `SELECT id, name, description, created_at, updated_at
       FROM items
       ORDER BY created_at DESC, id`,
    );
    return rows.map(toItem);
  }

  async findById(id: string): Promise<Item | null> {
    const { rows } = await this.db.query<ItemRow>(
      `SELECT id, name, description, created_at, updated_at
       FROM items
       WHERE id = $1`,
      [id],
    );
    return rows[0] ? toItem(rows[0]) : null;
  }

  async update(id: string, input: UpdateItemInput): Promise<Item | null> {
    const { rows } = await this.db.query<ItemRow>(
      `UPDATE items
       SET name = $2, description = $3
       WHERE id = $1
       RETURNING id, name, description, created_at, updated_at`,
      [id, input.name, input.description ?? ''],
    );
    return rows[0] ? toItem(rows[0]) : null;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      'DELETE FROM items WHERE id = $1',
      [id],
    );
    return rowCount === 1;
  }
}
