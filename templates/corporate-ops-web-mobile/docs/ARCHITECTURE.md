# Architecture — {{projectName}}

## Style: modular monolith

## Layer structure

```
src/
├── modules/          # business domain modules — own their data and routes
├── shared/
│   ├── db/           # repository implementations
│   ├── auth/         # authentication + RBAC
│   └── utils/        # cross-cutting helpers
└── api/              # route registration
```

## Dependency rules

- Modules may only import from each other's index.ts
- All database access through src/shared/db/ repositories
- No circular dependencies
- No direct DB calls outside repository classes
