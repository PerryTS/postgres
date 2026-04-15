# Benchmark results

Wed Apr 15 17:55:01 CEST 2026

PG: `127.0.0.1:55432/bench`

```
@perry/postgres bun   tiny                n=50    min 59µs       p50 87µs       p95 218µs      mean 120µs    
@perry/postgres bun   param-1row          n=50    min 83µs       p50 107µs      p95 170µs      mean 114µs    
@perry/postgres bun   medium-1k-x-20      n=50    min 3.18ms     p50 3.43ms     p95 6.38ms     mean 3.79ms   
@perry/postgres bun   large-10k-x-20      n=50    min 31.8ms     p50 34.2ms     p95 35.0ms     mean 34.1ms   
@perry/postgres node  tiny                n=50    min 42µs       p50 64µs       p95 230µs      mean 93µs     
@perry/postgres node  param-1row          n=50    min 62µs       p50 97µs       p95 269µs      mean 124µs    
@perry/postgres node  medium-1k-x-20      n=50    min 3.29ms     p50 3.50ms     p95 4.32ms     mean 3.58ms   
@perry/postgres node  large-10k-x-20      n=50    min 31.3ms     p50 35.7ms     p95 46.7ms     mean 36.1ms   
@perry/postgres perry  tiny                n=50    min 2.00ms     p50 3.00ms     p95 3.00ms     mean 2.94ms   
@perry/postgres perry  param-1row          n=50    min 2.00ms     p50 3.00ms     p95 3.00ms     mean 2.96ms   
@perry/postgres perry  medium-1k-x-20      n=50    min 31.0ms     p50 41.5ms     p95 49.0ms     mean 41.7ms   
@perry/postgres perry  large-10k-x-20      n=50    min 621.0ms    p50 763.5ms    p95 1212.0ms   mean 805.4ms  
pg                node  tiny                n=50    min 77µs       p50 104µs      p95 179µs      mean 113µs    
pg                node  param-1row          n=50    min 115µs      p50 152µs      p95 223µs      mean 158µs    
pg                node  medium-1k-x-20      n=50    min 2.27ms     p50 2.49ms     p95 3.71ms     mean 2.66ms   
pg                node  large-10k-x-20      n=50    min 19.3ms     p50 20.4ms     p95 30.2ms     mean 22.5ms   
postgres.js       node  tiny                n=50    min 41µs       p50 58µs       p95 145µs      mean 77µs     
postgres.js       node  param-1row          n=50    min 90µs       p50 125µs      p95 243µs      mean 140µs    
postgres.js       node  medium-1k-x-20      n=50    min 2.59ms     p50 2.93ms     p95 5.25ms     mean 3.24ms   
postgres.js       node  large-10k-x-20      n=50    min 23.4ms     p50 27.7ms     p95 31.9ms     mean 26.9ms   
tokio-postgres   rust tiny                n=50    min 65µs       p50 94µs       p95 152µs      mean 99µs      
tokio-postgres   rust param-1row          n=50    min 79µs       p50 101µs      p95 139µs      mean 105µs     
tokio-postgres   rust medium-1k-x-20      n=50    min 2.69ms     p50 2.78ms     p95 2.88ms     mean 2.78ms    
tokio-postgres   rust large-10k-x-20      n=50    min 26.2ms     p50 26.6ms     p95 27.6ms     mean 26.7ms    
```
