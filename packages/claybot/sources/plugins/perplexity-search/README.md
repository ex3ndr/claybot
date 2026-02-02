# Perplexity Search Plugin

Web search tool powered by Perplexity AI's Sonar model.

## Tool

- **perplexity_search** (configurable via `toolName` setting)

## Parameters

| Parameter | Type   | Required | Description       |
|-----------|--------|----------|-------------------|
| query     | string | yes      | The search query  |

## Settings

| Setting   | Type   | Default             | Description           |
|-----------|--------|---------------------|-----------------------|
| toolName  | string | perplexity_search   | Name of the tool      |
| model     | string | sonar               | Perplexity model      |

## Authentication

Requires a Perplexity API key stored via the auth store.

## Response

Returns an AI-generated answer with citations from the web.
