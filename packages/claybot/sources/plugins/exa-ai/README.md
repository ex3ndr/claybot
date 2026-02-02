# Exa AI Plugin

Web search tool powered by Exa AI's neural, fast, and deep search modes.

## Tool

- **exa_search** (configurable via `toolName` setting)

## Parameters

| Parameter     | Type    | Required | Description                                  |
|---------------|---------|----------|----------------------------------------------|
| query         | string  | yes      | The search query                             |
| numResults    | number  | no       | Number of results (1-10, default 5)          |
| type          | string  | no       | Search type: auto, fast, deep, or neural     |
| useAutoprompt | boolean | no       | Use Exa autoprompt to improve query          |

## Settings

| Setting  | Type   | Default    | Description       |
|----------|--------|------------|-------------------|
| toolName | string | exa_search | Name of the tool  |

## Authentication

Requires an Exa AI API key stored via the auth store.

## Response

Returns search results with titles, URLs, and text snippets.
