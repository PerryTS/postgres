# Benchmark results

Wed Apr 15 10:03:31 CEST 2026

PG: `127.0.0.1:55432/bench`

```
@perry/postgres bun   tiny                n=50    min 58µs       p50 103µs      p95 230µs      mean 135µs    
@perry/postgres bun   param-1row          n=50    min 77µs       p50 109µs      p95 206µs      mean 124µs    
@perry/postgres bun   medium-1k-x-20      n=50    min 3.26ms     p50 3.56ms     p95 6.59ms     mean 4.02ms   
@perry/postgres bun   large-10k-x-20      n=50    min 31.6ms     p50 35.4ms     p95 39.1ms     mean 35.2ms   
@perry/postgres node  tiny                n=50    min 53µs       p50 70µs       p95 178µs      mean 90µs     
@perry/postgres node  param-1row          n=50    min 77µs       p50 144µs      p95 448µs      mean 194µs    
@perry/postgres node  medium-1k-x-20      n=50    min 3.43ms     p50 3.78ms     p95 4.71ms     mean 3.87ms   
@perry/postgres node  large-10k-x-20      n=50    min 33.2ms     p50 39.2ms     p95 50.4ms     mean 40.1ms   
@perry/postgres perry  tiny                n=50    min 2.00ms     p50 3.00ms     p95 3.00ms     mean 2.52ms   
@perry/postgres perry  param-1row          n=50    min 2.00ms     p50 3.00ms     p95 3.00ms     mean 2.54ms   
@perry/postgres perry  medium-1k-x-20      n=1     min 23.0ms     p50 23.0ms     p95 23.0ms     mean 23.0ms   
pg                node  tiny                n=50    min 86µs       p50 136µs      p95 351µs      mean 160µs    
pg                node  param-1row          n=50    min 122µs      p50 183µs      p95 302µs      mean 192µs    
pg                node  medium-1k-x-20      n=50    min 2.38ms     p50 2.70ms     p95 4.23ms     mean 2.90ms   
pg                node  large-10k-x-20      n=50    min 20.6ms     p50 21.7ms     p95 31.1ms     mean 24.1ms   
postgres.js       node  tiny                n=50    min 55µs       p50 78µs       p95 179µs      mean 95µs     
postgres.js       node  param-1row          n=50    min 115µs      p50 174µs      p95 304µs      mean 191µs    
postgres.js       node  medium-1k-x-20      n=50    min 2.72ms     p50 3.30ms     p95 5.96ms     mean 3.67ms   
postgres.js       node  large-10k-x-20      n=50    min 23.9ms     p50 29.5ms     p95 39.2ms     mean 28.9ms   
```
