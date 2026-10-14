import * as migration_20261014_091039_initial from './20261014_091039_initial';
import * as migration_20261014_121735_authors_books from './20261014_121735_authors_books';
import * as migration_20261014_125343_members from './20261014_125343_members';
import * as migration_20261014_131258_loans from './20261014_131258_loans';

export const migrations = [
  {
    up: migration_20261014_091039_initial.up,
    down: migration_20261014_091039_initial.down,
    name: '20261014_091039_initial',
  },
  {
    up: migration_20261014_121735_authors_books.up,
    down: migration_20261014_121735_authors_books.down,
    name: '20261014_121735_authors_books',
  },
  {
    up: migration_20261014_125343_members.up,
    down: migration_20261014_125343_members.down,
    name: '20261014_125343_members',
  },
  {
    up: migration_20261014_131258_loans.up,
    down: migration_20261014_131258_loans.down,
    name: '20261014_131258_loans'
  },
];
