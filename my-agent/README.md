# my-agent

A minimal Vision Agents voice assistant project configured for Python 3.12.

## Setup

1. Install dependencies in a Python 3.12 environment:
   ```bash
   pip install -e .
   ```

2. Create `.env` with:
   ```text
   STREAM_API_KEY=
   STREAM_API_SECRET=
   SERPER_API_KEY=
   ```

3. Run the assistant:
   ```bash
   python main.py run
   ```

## Notes

- This project is based on Vision Agents documentation at https://visionagents.ai
- Use your Stream credentials from getstream.io and your Serper API key from serper.dev.
