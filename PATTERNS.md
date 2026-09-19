# Software architecture patterns — a cross-lab checklist

A running list of patterns the labs should exercise, so learning them isn't
accidental. Status uses the repo markers: **✅ practiced**, **🚧 in progress**,
**⬜ not yet**. "Where" names the lab that covers it (or is the natural home).

A pattern counts as ✅ only once Mau has *written* it deliberately and can name
what problem it solves — not merely used a framework that happens to embed it.

## Creational — *how objects get made*

| Pattern | Status | Where / note |
| --- | --- | --- |
| Singleton | ✅ | `s3` client + `config` object (module created once, functions/object exported) |
| Factory | 🚧 | s3 contract refactor (`createS3Storage(config)`); Nest providers are factories too |
| Builder | ⬜ | step-by-step construction of a complex object (e.g. a query builder) |
| Dependency Injection / IoC | 🚧 | NestJS providers (`nestjs-graphql-*`); the factory above is hand-rolled DI |

## Structural — *how objects are composed*

| Pattern | Status | Where / note |
| --- | --- | --- |
| Facade | 🚧 | the s3 contract — one simple interface over the fat AWS SDK |
| Adapter | 🚧 | same file, seen from the other side — reshapes a 3rd-party API to *our* verbs; also AWS SDK ↔ MinIO |
| Repository | ✅ | `repository.js` — collection-like facade over persistence (a *specialized* facade, not the same thing) |
| Decorator | ⬜→used | Nest `@Injectable`/`@Controller`/`@UseGuards` use it; write one deliberately to count it |
| Proxy | ⬜ | stand-in that adds behaviour (caching, lazy-load) — candidate: Apollo cache lab |
| DTO (data transfer object) | ✅ | `CreateUploadDto` in the Nest module |

## Behavioral — *how objects talk*

| Pattern | Status | Where / note |
| --- | --- | --- |
| Observer | ✅ | `observables-from-scratch-to-apollo-link` |
| Strategy | 🚧 | interchangeable implementations behind one contract — `createS3Storage` vs `createGcsStorage`; Apollo links; auth strategies |
| Chain of Responsibility | ⬜→used | Express middleware chain & Nest guards/interceptors/pipes — name it to count it |
| Command | ⬜ | encapsulate a request as an object — candidate: `bash-command-dispatcher` |
| Iterator | 🚧 | pull-based sequences — observables lab + async iterators in the debounce lab |
| State | ⬜ | explicit state machine — strong candidate: `nestjs-outcome-routing-mfa-*` (password → MFA → done) |
| Template Method | ⬜ | fixed skeleton, overridable steps |
| Mediator | ⬜ | central coordinator — candidate: Nest CQRS/EventBus |

## Architectural — *how the app is shaped*

| Pattern | Status | Where / note |
| --- | --- | --- |
| Layered (routes → service → repository) | 🚧 | Nest module has it; Express s3 is mid-extraction |
| Ports & Adapters (Hexagonal) | 🚧 | the s3 contract *is* this: the app depends on a port, S3 is one adapter |
| Middleware pipeline | ✅ | Express `app.use(...)`; auth labs |
| Module pattern | ✅ | every lab — private state, exported surface |
| CQRS | ⬜ | separate read/write models — candidate: the report-query lab |

## The one test that proves the boundary

For any facade/adapter/port: **`grep` the app for the vendor SDK and expect zero
hits outside the adapter file.** If `@aws-sdk` appears only in `src/s3.js`, the
seam is real and the module is portable. That grep is the acceptance test.
