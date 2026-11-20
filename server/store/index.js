import { config } from '../config.js';
import { createMemoryStore } from './memory.js';
import { createMongoStore } from './mongo.js';

export function createStore() {
  return config.mongoUri ? createMongoStore(config.mongoUri) : createMemoryStore();
}
