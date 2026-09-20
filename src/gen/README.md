# Generated worker.v1 code (vendored)

`worker/v1/worker_pb.ts` is **vendored** from the easylab-platform proto
generation:

```
easylab-platform/proto/gen/es/worker/v1/worker_pb.ts
```

It is the `@bufbuild/protobuf` `codegenv2` TS output for
`worker/v1/worker.proto` (the easyworker Connect contract: `WorkerService` +
`WorkerEnroll` message/service descriptors). It is copied verbatim so this
extension stays a self-contained repo with no dependency on `@easylab/sdk`.

To refresh: re-run the easylab-platform ES buf generation and copy the file
over, then bump the extension version. Only `WorkerService` is used here
(`WorkerEnroll` is unused but kept so the file stays a verbatim upstream copy).
