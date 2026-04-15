# Benchmark results

Wed Apr 15 09:36:38 CEST 2026

PG: `127.0.0.1:5432/perch_test`

```
@perry/postgres bun   tiny                n=50    min 25.4ms     p50 30.3ms     p95 45.2ms     mean 32.7ms   
@perry/postgres bun   param-1row          n=50    min 26.1ms     p50 28.5ms     p95 30.9ms     mean 28.6ms   
@perry/postgres bun   medium-1k-x-20      n=50    min 56.7ms     p50 65.8ms     p95 83.8ms     mean 67.7ms   
@perry/postgres bun   large-10k-x-20      n=50    min 231.3ms    p50 263.3ms    p95 363.5ms    mean 276.0ms  
@perry/postgres node  tiny                n=50    min 25.5ms     p50 28.3ms     p95 32.9ms     mean 28.8ms   
@perry/postgres node  param-1row          n=50    min 26.1ms     p50 28.2ms     p95 32.2ms     mean 29.0ms   
@perry/postgres node  medium-1k-x-20      n=50    min 58.6ms     p50 67.7ms     p95 85.4ms     mean 68.7ms   
@perry/postgres node  large-10k-x-20      n=50    min 219.5ms    p50 245.5ms    p95 284.3ms    mean 250.1ms  
@perry/postgres perry  tiny                n=50    min 25.0ms     p50 29.0ms     p95 32.0ms     mean 29.2ms   
@perry/postgres perry  param-1row          n=50    min 27.0ms     p50 30.0ms     p95 33.0ms     mean 30.1ms   
@perry/postgres perry  medium-1k-x-20      n=1     min 104.0ms    p50 104.0ms    p95 104.0ms    mean 104.0ms  
pg                node  tiny                n=50    min 25.0ms     p50 27.8ms     p95 31.5ms     mean 28.4ms   
pg                node  param-1row          n=50    min 26.1ms     p50 28.4ms     p95 31.4ms     mean 28.7ms   
pg                node  medium-1k-x-20      n=50    min 53.9ms     p50 64.5ms     p95 73.1ms     mean 65.6ms   
pg                node  large-10k-x-20      n=50    min 192.7ms    p50 228.5ms    p95 262.7ms    mean 230.2ms  
postgres.js       node  tiny                n=50    min 25.1ms     p50 28.5ms     p95 35.9ms     mean 43.3ms   
postgres.js       node  param-1row          n=50    min 51.4ms     p50 57.0ms     p95 64.1ms     mean 57.5ms   
postgres.js       node  medium-1k-x-20      n=50    min 56.0ms     p50 65.2ms     p95 114.8ms    mean 70.8ms   
postgres.js       node  large-10k-x-20      n=50    min 177.3ms    p50 224.2ms    p95 322.1ms    mean 239.1ms  
```
