import type { FastifyInstance } from 'fastify';
import { ItemRepository } from '../items/repository.js';
import { ItemService } from '../items/service.js';
import type { CreateItemInput, UpdateItemInput } from '../items/types.js';

const idParams = {
  type: 'object',
  required: ['id'],
  additionalProperties: false,
  properties: {
    id: { type: 'string', format: 'uuid' },
  },
} as const;

const itemBody = {
  type: 'object',
  required: ['name'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    description: { type: 'string', maxLength: 10000 },
  },
} as const;

export async function registerItemRoutes(app: FastifyInstance): Promise<void> {
  const service = new ItemService(new ItemRepository(app.db));

  app.post<{ Body: CreateItemInput }>(
    '/api/items',
    { schema: { body: itemBody } },
    async (request, reply) => {
      const item = await service.create(request.body);
      return reply.code(201).send(item);
    },
  );

  app.get('/api/items', async () => service.list());

  app.get<{ Params: { id: string } }>(
    '/api/items/:id',
    { schema: { params: idParams } },
    async (request) => service.get(request.params.id),
  );

  app.put<{ Params: { id: string }; Body: UpdateItemInput }>(
    '/api/items/:id',
    { schema: { params: idParams, body: itemBody } },
    async (request) => service.update(request.params.id, request.body),
  );

  app.delete<{ Params: { id: string } }>(
    '/api/items/:id',
    { schema: { params: idParams } },
    async (request, reply) => {
      await service.delete(request.params.id);
      return reply.code(204).send();
    },
  );
}
