# Benchmark results

Fri Apr 17 19:21:50 CEST 2026

PG: `127.0.0.1:55432/bench`

```
@perry/postgres bun   tiny                n=50    min 33µs       p50 87µs       p95 205µs      mean 125µs    
@perry/postgres bun   param-1row          n=50    min 42µs       p50 63µs       p95 102µs      mean 65µs     
@perry/postgres bun   medium-1k-x-20      n=50    min 3.10ms     p50 3.35ms     p95 6.23ms     mean 3.83ms   
@perry/postgres bun   large-10k-x-20      n=50    min 30.6ms     p50 33.3ms     p95 36.3ms     mean 33.3ms   
@perry/postgres node  tiny                n=50    min 73µs       p50 82µs       p95 151µs      mean 100µs    
@perry/postgres node  param-1row          n=50    min 105µs      p50 138µs      p95 252µs      mean 164µs    
@perry/postgres node  medium-1k-x-20      n=50    min 3.44ms     p50 3.64ms     p95 4.76ms     mean 3.79ms   
@perry/postgres node  large-10k-x-20      n=50    min 31.5ms     p50 36.0ms     p95 45.1ms     mean 36.7ms   
@perry/postgres perry  tiny                n=50    min 2.00ms     p50 2.50ms     p95 3.00ms     mean 2.50ms   
@perry/postgres perry  param-1row          n=50    min 2.00ms     p50 2.00ms     p95 3.00ms     mean 2.46ms   
@perry/postgres perry  medium-1k-x-20      n=50    min 9.00ms     p50 11.0ms     p95 16.0ms     mean 11.7ms   
@perry/postgres perry  large-10k-x-20      n=50    min 90.0ms     p50 100.0ms    p95 174.0ms    mean 109.7ms  
pg                node  tiny                n=50    min 72µs       p50 82µs       p95 166µs      mean 94µs     
pg                node  param-1row          n=50    min 99µs       p50 132µs      p95 193µs      mean 137µs    
pg                node  medium-1k-x-20      n=50    min 2.27ms     p50 2.48ms     p95 4.16ms     mean 2.71ms   
pg                node  large-10k-x-20      n=50    min 19.9ms     p50 22.1ms     p95 42.5ms     mean 25.2ms   
postgres.js       node  tiny                n=50    min 47µs       p50 85µs       p95 257µs      mean 116µs    
postgres.js       node  param-1row          n=50    min 93µs       p50 137µs      p95 230µs      mean 147µs    
postgres.js       node  medium-1k-x-20      n=50    min 2.60ms     p50 2.99ms     p95 6.62ms     mean 3.48ms   
postgres.js       node  large-10k-x-20      n=50    min 23.4ms     p50 28.7ms     p95 43.3ms     mean 29.4ms   
pg-native         node  tiny                n=50    min 59µs       p50 77µs       p95 116µs      mean 89µs     
pg-native         node  param-1row          n=50    min 66µs       p50 77µs       p95 108µs      mean 81µs     
pg-native         node  medium-1k-x-20      n=50    min 3.88ms     p50 4.07ms     p95 4.20ms     mean 4.07ms   
pg-native         node  large-10k-x-20      n=50    min 37.1ms     p50 38.0ms     p95 39.1ms     mean 38.1ms   
tokio-postgres   rust tiny                n=50    min 65µs       p50 80µs       p95 102µs      mean 80µs      
tokio-postgres   rust param-1row          n=50    min 65µs       p50 80µs       p95 106µs      mean 83µs      
tokio-postgres   rust medium-1k-x-20      n=50    min 2.68ms     p50 2.78ms     p95 2.93ms     mean 2.79ms    
tokio-postgres   rust large-10k-x-20      n=50    min 26.1ms     p50 26.5ms     p95 29.7ms     mean 27.5ms    
```
