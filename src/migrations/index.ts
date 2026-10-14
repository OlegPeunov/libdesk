import * as migration_20261014_091039_initial from './20261014_091039_initial';

export const migrations = [
  {
    up: migration_20261014_091039_initial.up,
    down: migration_20261014_091039_initial.down,
    name: '20261014_091039_initial'
  },
];
