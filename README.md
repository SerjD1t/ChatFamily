# ChatFamily

Семейный чат на Go и PostgreSQL. Текущая версия — **beta**: она поддерживает пользователей, группы, личные диалоги, сообщения, вложения и обновления в реальном времени.

## Возможности

- вход администратора и пользователей, принявших приглашение;
- одноразовые приглашения с ограниченным сроком действия;
- группы, участники и личные диалоги;
- создание, редактирование и мягкое удаление сообщений;
- загрузка локальных вложений и защищённое скачивание только участниками беседы;
- PostgreSQL-миграции при старте приложения;
- веб-интерфейс и WebSocket-обновления чата.

## Быстрый запуск

1. Скопируйте `.env.example` в `.env`.
2. Задайте уникальные значения `SESSION_SECRET`, `BOOTSTRAP_ADMIN_PASSWORD` и `POSTGRES_PASSWORD`.
3. Запустите:

   ```sh
   docker compose up --build
   ```

4. Откройте `http://localhost:8080` и войдите с `BOOTSTRAP_ADMIN_EMAIL` и `BOOTSTRAP_ADMIN_PASSWORD`.

PostgreSQL запускается в том же Compose-проекте. Приложение ожидает готовности БД и применяет миграции автоматически.

## Конфигурация

| Переменная | Назначение |
|---|---|
| `APP_ADDR` | Адрес HTTP-сервера, по умолчанию `:8080` |
| `SESSION_SECRET` | Секрет для подписи сессий, минимум 32 символа |
| `BOOTSTRAP_ADMIN_EMAIL` | Адрес первого администратора |
| `BOOTSTRAP_ADMIN_PASSWORD` | Пароль первого администратора, минимум 12 символов |
| `POSTGRES_PASSWORD` | Пароль PostgreSQL для Docker Compose |
| `DATABASE_URL` | Строка подключения при запуске вне Compose |
| `MAX_UPLOAD_BYTES` | Максимальный размер вложения |
| `UPLOAD_DIR` | Каталог локального файлового хранилища |

Никогда не добавляйте `.env`, файлы из `uploads/` или пароли в Git. Эти пути исключены в `.gitignore`.

## API

Все защищённые маршруты используют cookie-сессию.

- `POST /api/v1/auth/login` — вход;
- `POST /api/v1/auth/logout` — выход;
- `GET /api/v1/auth/me` — текущий пользователь;
- `POST /api/v1/invitations` — создать приглашение;
- `POST /api/v1/invitations/accept` — принять приглашение;
- `GET, POST /api/v1/conversations` — беседы и группы;
- `POST /api/v1/conversations/{id}/members` — добавить участника;
- `GET, POST /api/v1/conversations/{id}/messages` — история и отправка;
- `PATCH, DELETE /api/v1/messages/{id}` — изменение и удаление;
- `POST /api/v1/attachments` и `GET /api/v1/attachments/{id}` — вложения;
- `GET /api/v1/events` — WebSocket-канал обновлений.

## Разработка и тесты

```sh
go test ./...
go build .
```

Интеграционный тест PostgreSQL включается только при явном указании отдельной тестовой БД:

```sh
TEST_DATABASE_URL='postgres://…' go test ./internal/store -run TestPostgresRepositoryRoundTrip
```

Тест создаёт только записи с префиксом `test_` и удаляет их после выполнения.

## Ограничения beta-версии

- файлы хранятся локально, без S3-совместимого хранилища;
- нет rate limiting, аудита действий и автоматического резервного копирования;
- при мягком удалении сообщения физический файл пока не очищается автоматически.
