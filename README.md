# LibDesk

Минимальный каркас Next.js + TypeScript + Payload с PostgreSQL. Сейчас есть только
auth-коллекция `Employees`, стандартная админка `/admin` и REST API Payload.
Сотрудники входят по email и паролю; хеширование и сессии обслуживает Payload.
Ролей пока нет: все вошедшие сотрудники имеют одинаковые стандартные права.

Основа — [официальный Blank Template Payload v3.90.2](https://github.com/payloadcms/payload/tree/v3.90.2/templates/blank).
Удалены демонстрационные модели, загрузки, rich text и тестовые зависимости.
Next.js и React обновлены в пределах peer dependencies выбранного Payload.

## Версии

- Node.js **24.21.0**, pnpm **11.25.0**.
- Payload и пакеты `@payloadcms/*` **3.90.2**.
- Next.js **16.4.0**, React / React DOM **19.3.0**.
- TypeScript **5.7.3** — версия из стабильного Blank Template.
- GraphQL **16.14.2** — peer dependency Payload; GraphQL API выключен.

Прямые зависимости закреплены точными версиями, транзитивные — `pnpm-lock.yaml`.
Совместимость: [установка Payload](https://payloadcms.com/docs/getting-started/installation)
и peer dependencies пакетов. В частности, Payload 3.90.2 требует Next.js 16.3.3+
при использовании ветки 16.x.

## Локальный запуск

1. Используйте Node.js из `.nvmrc` (`nvm install && nvm use`, если установлен nvm)
   и pnpm 11.25.0. При наличии Corepack можно выполнить
   `corepack prepare pnpm@11.25.0 --activate`.
2. Установите зависимости: `pnpm install --frozen-lockfile`.
3. Создайте **отдельную пустую PostgreSQL-базу разработки**. Для Neon используйте
   отдельный development-проект, без production-данных, и получите connection URL.
   Для этого этапа подойдёт прямое подключение к development-базе с правами на DDL.
   Сохраните параметры TLS, которые выдаёт провайдер; проверку сертификата не отключайте.
4. Скопируйте `.env.example` в `.env`. Локально заполните `DATABASE_URL` и
   `PAYLOAD_SECRET`. Сгенерируйте случайный секрет командой `openssl rand -hex 32`.
   `SERVER_URL=http://localhost:3000` уже указан в шаблоне.
   Настоящие значения остаются в `.env`, который исключён из Git.
5. Примените начальную миграцию: `pnpm migrate`. Затем проверьте `pnpm migrate:status`.
6. Запустите `pnpm dev` и откройте <http://localhost:3000/admin>.
   На пустой базе Payload предложит создать первого сотрудника. После этого
   проверьте выход и повторный вход. Корневой адрес перенаправляет на `/admin`.

Без `DATABASE_URL`, `PAYLOAD_SECRET` или доступной PostgreSQL вход в админку
не работает. Приложение не создаёт базу автоматически и не подменяет PostgreSQL
другим адаптером.

## Миграции и проверки

Автоматический `db push` выключен **во всех окружениях**. После изменения коллекций:

```sh
pnpm migrate:create meaningful_name
pnpm migrate
pnpm generate:types
pnpm generate:importmap
pnpm typecheck
pnpm build
```

Миграции, их снимки схемы, `src/payload-types.ts` и import map храним в Git.
Первую миграцию повторно создавать не нужно. Команды генерации типов и миграции
не применяют изменения к базе; изменения применяет только `pnpm migrate`.

Для локальной проверки production-режима с той же **development-базой**:
`pnpm build`, затем `pnpm start`. Сборка сама миграции не запускает.

Документация: [PostgreSQL-адаптер](https://payloadcms.com/docs/database/postgres),
[миграции](https://payloadcms.com/docs/database/migrations).

Книги, авторы, читатели, выдачи, загрузки, роли, AI и публикация приложения
относятся к следующим отдельным шагам.
