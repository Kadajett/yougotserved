import { describe, expect, test, afterAll, beforeAll } from '@jest/globals';
import supertest from 'supertest';
import Server from './index';

describe('server', () => {
  // Start a server for the test.
  beforeAll(async () => {
    await Server.getInstance().ready();
  });

  // Stop it.
  afterAll(async () => {
    await Server.stop();
  });

  test('GET /ping answers', async () => {
    const response = await supertest(Server.getInstance().server)
      .get('/ping')
      .expect(200)
      .expect('Content-Type', /json/);

    expect(response.body).toEqual({
      status: 'ok',
      message: 'pong',
    });
  });
});
