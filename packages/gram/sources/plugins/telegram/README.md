# Telegram plugin

## Overview
The Telegram plugin connects the engine to Telegram via long polling. It only processes private chats and ignores group/supergroup/channel traffic.
It normalizes incoming messages into `ConnectorMessage` objects and sends responses (including files) back to Telegram.

## Files
- `plugin.ts` - plugin wiring and onboarding.
- `connector.ts` - TelegramBot adapter, polling logic, and message normalization.

## Settings
- `polling` (optional): enable/disable polling (default true).
- `clearWebhook` (optional): clear Telegram webhook before polling (default true).
- `statePath` (optional): override `lastUpdateId` storage path (default `${dataDir}/telegram-offset.json`).
- `retry` (optional): polling retry configuration (`minDelayMs`, `maxDelayMs`, `factor`, `jitter`).

## Auth
- Onboarding prompts for the bot token and stores it in the auth store under the plugin instance id.

## Incoming message handling
- Only accepts `message.chat.type === "private"`.
- Extracts text or caption and downloads attached photos/documents into the file store.
- Builds `MessageContext` with `channelId`, `userId`, and `messageId`.
- Emits normalized payloads to session handling.

## Outgoing message handling
- Sends text replies with `reply_to_message_id` when present.
- Sends images with `sendPhoto` and other files with `sendDocument`.
- Supports typing indicators and emoji reactions.

## Persistence
- Tracks the last processed Telegram `update_id` and persists it to the configured state file.
