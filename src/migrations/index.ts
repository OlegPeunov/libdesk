import * as migration_20261014_091039_initial from './20261014_091039_initial';
import * as migration_20261014_121735_authors_books from './20261014_121735_authors_books';

export const migrations = [
  {
    up: migration_20261014_091039_initial.up,
    down: migration_20261014_091039_initial.down,
    name: '20261014_091039_initial',
  },
  {
    up: migration_20261014_121735_authors_books.up,
    down: migration_20261014_121735_authors_books.down,
    name: '20261014_121735_authors_books'
  },
];
