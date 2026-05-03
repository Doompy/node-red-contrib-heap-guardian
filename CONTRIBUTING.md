# Contributing

## Development Checks

Run the local verification suite before opening a pull request:

```powershell
npm run verify
npm pack --dry-run
docker compose build
```

## Local Node-RED Testing

Start the Docker environment:

```powershell
docker compose up --build
```

Deploy the leak lab flow:

```powershell
npm run deploy:leak-lab
```

Then open:

```text
http://localhost:1880
```

## Design Rules

- Keep runtime profiling conservative by default.
- Avoid Node-RED runtime monkey patches when official hooks are available.
- Prefer structured output over log-only diagnostics.
- Treat heap snapshots as heavyweight diagnostic artifacts.
