# max_assistant

AI assistant for Max/MSP using OpenAI and Effect.

## Overview

This project provides an AI-powered assistant for Max/MSP that can analyze patch objects, find connections, and help understand patch structure through natural language queries.

## Features

- **Patch Analysis**: Get complete patch context with all objects and connections
- **Object Search**: Find specific objects by name or type
- **Tool-based Architecture**: Uses Effect.ts for robust async operations
- **Max/MSP Integration**: Seamless communication with Max environment

## Installation

```bash
bun install
```

## Configuration

Create a `.env` file with:

```
API_KEY=your_openai_api_key
```

## Usage

Build and run:

```bash
bun run build
bun run dev
```

## Tech Stack

- **Runtime**: Bun
- **AI**: @effect/ai with OpenAI
- **Framework**: Effect.ts for functional programming
- **Integration**: max-api for Max/MSP

