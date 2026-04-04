# Initial — Backend API Endpoints

## Структура

```
api/
├── helpers.php              — общие функции (auth, JSON, email, FCM, voice helpers)
├── s3_helper.php            — S3 upload/delete/get (AWS Signature V4, reg.ru)
├── send_message.php         — отправка текстовых сообщений и медиа
├── send_voice_message.php   — отправка голосовых (AES-256-GCM encryption)
├── get_messages.php         — получение сообщений и списка чатов
├── upload_file.php          — загрузка изображений/видео/документов в S3
├── config.php               — настройки (НЕ в git)
└── .gitignore               — исключает config.php, ключи
```

## Установка

1. Загрузить все файлы в `/var/www/.../api/`
2. Скопировать `config.example.php` → `config.php` и заполнить креды
3. Выполнить SQL-миграции (см. ниже)

## SQL-миграции

```sql
-- Голосовые сообщения
ALTER TABLE messages ADD COLUMN voice_duration INT UNSIGNED NOT NULL DEFAULT 0;
ALTER TABLE messages ADD COLUMN voice_waveform TEXT NULL;
```

## Endpoints

### POST /api/send_message.php
Отправка текстового сообщения или медиа (photo/video).

### POST /api/send_voice_message.php
Отправка голосового сообщения. Клиент шифрует AES-256-GCM, сервер расшифровывает и загружает в S3.

### GET /api/get_messages.php
Получение сообщений чата, списка чатов. Поддерживает пагинацию, реакции, голосовые.

### POST /api/upload_file.php
Загрузка файлов в S3 (images, videos, documents).
