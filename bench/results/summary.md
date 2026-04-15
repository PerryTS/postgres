# Benchmark results

Wed Apr 15 10:22:16 CEST 2026

PG: `127.0.0.1:55432/bench`

```
@perry/postgres bun   tiny                n=50    min 74µs       p50 122µs      p95 173µs      mean 134µs    
@perry/postgres bun   param-1row          n=50    min 81µs       p50 123µs      p95 261µs      mean 149µs    
@perry/postgres bun   medium-1k-x-20      n=50    min 3.16ms     p50 3.39ms     p95 5.81ms     mean 3.76ms   
@perry/postgres bun   large-10k-x-20      n=50    min 30.3ms     p50 32.5ms     p95 38.1ms     mean 33.1ms   
@perry/postgres node  tiny                n=50    min 43µs       p50 56µs       p95 190µs      mean 90µs     
@perry/postgres node  param-1row          n=50    min 58µs       p50 101µs      p95 227µs      mean 135µs    
@perry/postgres node  medium-1k-x-20      n=50    min 3.30ms     p50 3.52ms     p95 4.67ms     mean 3.72ms   
@perry/postgres node  large-10k-x-20      n=50    min 31.8ms     p50 34.9ms     p95 40.8ms     mean 35.0ms   
@perry/postgres perry  tiny                n=50    min 2.00ms     p50 3.00ms     p95 3.00ms     mean 2.52ms   
@perry/postgres perry  param-1row          n=50    min 2.00ms     p50 2.50ms     p95 3.00ms     mean 2.50ms   
@perry/postgres perry  medium-1k-x-20      n=1     min 23.0ms     p50 23.0ms     p95 23.0ms     mean 23.0ms   
pg                node  tiny                n=50    min 42µs       p50 72µs       p95 161µs      mean 82µs     
pg                node  param-1row          n=50    min 55µs       p50 71µs       p95 169µs      mean 85µs     
pg                node  medium-1k-x-20      n=50    min 2.28ms     p50 2.49ms     p95 4.36ms     mean 2.71ms   
pg                node  large-10k-x-20      n=50    min 19.5ms     p50 20.3ms     p95 30.2ms     mean 22.5ms   
postgres.js       node  tiny                n=50    min 44µs       p50 58µs       p95 106µs      mean 67µs     
postgres.js       node  param-1row          n=50    min 90µs       p50 126µs      p95 252µs      mean 149µs    
postgres.js       node  medium-1k-x-20      n=50    min 2.59ms     p50 2.83ms     p95 5.56ms     mean 3.16ms   
postgres.js       node  large-10k-x-20      n=50    min 23.2ms     p50 27.4ms     p95 45.1ms     mean 28.3ms   
tokio-postgres   rust tiny                n=50    min 31µs       p50 35µs       p95 73µs       mean 39µs      
tokio-postgres   rust param-1row          n=50    min 30µs       p50 35µs       p95 45µs       mean 37µs      
tokio-postgres   rust medium-1k-x-20      n=50    min 2.60ms     p50 2.75ms     p95 3.17ms     mean 2.78ms    
tokio-postgres   rust large-10k-x-20      n=50    min 26.4ms     p50 26.7ms     p95 27.2ms     mean 26.8ms    
```
