import { getTestDatabaseConfig } from './helpers.js';

if (!getTestDatabaseConfig()) {
  throw new Error(
    'Integration tests require TEST_DB_HOST, TEST_DB_PORT, TEST_DB_NAME=backend_test, TEST_DB_USER, and TEST_DB_PASSWORD',
  );
}
