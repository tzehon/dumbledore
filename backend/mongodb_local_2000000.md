# MongoDB Performance Benchmark Report

## Test Environment

| Metric | Value |
|--------|--------|
| Documents | 2,000,000 |
| Server Tier | local |
| Sample Size | 3,000 requests per query |
| Page Size | 500 documents per page |

## MongoDB Query Performance Results (user_comms collection)

| Query | P50 (Total \| MongoDB Only) | P90 (Total \| MongoDB Only) | P95 (Total \| MongoDB Only) | P99 (Total \| MongoDB Only) |
|-------|------------------------------|------------------------------|------------------------------|------------------------------|
| GetEligibleUserComms | 1ms / 0ms | 2ms / 0ms | 3ms / 0ms | 4ms / 0ms |
| GetScheduleSegment_v1 | 1ms / 0ms | 2ms / 0ms | 2ms / 0ms | 3ms / 0ms |
| GetScheduleSegment_v2 | 1ms / 0ms | 2ms / 0ms | 3ms / 0ms | 4ms / 0ms |
| GetUserSchedule | 1ms / 0ms | 2ms / 0ms | 2ms / 0ms | 3ms / 0ms |
