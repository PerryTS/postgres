# Benchmark results

Wed Apr 15 09:55:04 CEST 2026

PG: `127.0.0.1:55432/bench`

```
@perry/postgres bun   tiny                n=50    min 140µs      p50 279µs      p95 1.38ms     mean 408µs    
@perry/postgres bun   param-1row          n=50    min 100µs      p50 264µs      p95 1000µs     mean 461µs    
@perry/postgres bun   medium-1k-x-20      n=50    min 3.54ms     p50 5.08ms     p95 13.4ms     mean 6.35ms   
@perry/postgres bun   large-10k-x-20      n=50    min 32.7ms     p50 39.8ms     p95 94.6ms     mean 49.6ms   
@perry/postgres node  tiny                n=50    min 50µs       p50 93µs       p95 259µs      mean 111µs    
@perry/postgres node  param-1row          n=50    min 79µs       p50 124µs      p95 227µs      mean 187µs    
@perry/postgres node  medium-1k-x-20      n=50    min 4.13ms     p50 4.64ms     p95 5.71ms     mean 4.80ms   
@perry/postgres node  large-10k-x-20      n=50    min 39.8ms     p50 46.6ms     p95 68.7ms     mean 49.2ms   
@perry/postgres perry  tiny                n=50    min 2.00ms     p50 3.00ms     p95 3.00ms     mean 2.54ms   
@perry/postgres perry  param-1row          n=50    min 2.00ms     p50 3.00ms     p95 3.00ms     mean 2.54ms   
@perry/postgres perry  medium-1k-x-20      n=1     min 23.0ms     p50 23.0ms     p95 23.0ms     mean 23.0ms   
pg                node  tiny                n=50    min 90µs       p50 117µs      p95 224µs      mean 128µs    
pg                node  param-1row          n=50    min 115µs      p50 147µs      p95 410µs      mean 199µs    
pg                node  medium-1k-x-20      n=50    min 2.34ms     p50 2.52ms     p95 4.22ms     mean 2.75ms   
pg                node  large-10k-x-20      n=50    min 19.9ms     p50 20.9ms     p95 29.6ms     mean 23.0ms   
postgres.js       node  tiny                n=50    min 54µs       p50 77µs       p95 160µs      mean 88µs     
postgres.js       node  param-1row          n=50    min 111µs      p50 144µs      p95 256µs      mean 157µs    
postgres.js       node  medium-1k-x-20      n=50    min 2.60ms     p50 2.95ms     p95 5.14ms     mean 3.28ms   
postgres.js       node  large-10k-x-20      n=50    min 23.8ms     p50 29.0ms     p95 49.2ms     mean 30.9ms   
```
