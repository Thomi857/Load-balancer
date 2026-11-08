import { ItemRepository } from './repository.js';
import type { CreateItemInput, Item, UpdateItemInput } from './types.js';

export class ItemNotFoundError extends Error {
  readonly statusCode = 404;

  constructor() {
    super('Item not found');
    this.name = 'ItemNotFoundError';
  }
}

export class InvalidItemError extends Error {
  readonly statusCode = 400;

  constructor(message: string) {
    super(message);
    this.name = 'InvalidItemError';
  }
}

function normalizeInput<T extends CreateItemInput | UpdateItemInput>(input: T): T {
  const name = input.name.trim();
  if (name.length === 0) {
    throw new InvalidItemError('name must not be empty');
  }

  return {
    ...input,
    name,
    ...(input.description === undefined ? {} : { description: input.description }),
  };
}

export class ItemService {
  constructor(private readonly repository: ItemRepository) {}

  async create(input: CreateItemInput): Promise<Item> {
    return this.repository.create(normalizeInput(input));
  }

  list(): Promise<Item[]> {
    return this.repository.list();
  }

  async get(id: string): Promise<Item> {
    const item = await this.repository.findById(id);
    if (!item) {
      throw new ItemNotFoundError();
    }
    return item;
  }

  async update(id: string, input: UpdateItemInput): Promise<Item> {
    const item = await this.repository.update(id, normalizeInput(input));
    if (!item) {
      throw new ItemNotFoundError();
    }
    return item;
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repository.delete(id))) {
      throw new ItemNotFoundError();
    }
  }
}
