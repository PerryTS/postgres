# Benchmark results

Fri Apr 17 11:32:04 CEST 2026

PG: `127.0.0.1:55432/bench`

```
@perry/postgres bun   tiny                n=50    min 71µs       p50 109µs      p95 169µs      mean 116µs    
@perry/postgres bun   param-1row          n=50    min 83µs       p50 111µs      p95 169µs      mean 119µs    
@perry/postgres bun   medium-1k-x-20      n=50    min 3.33ms     p50 3.60ms     p95 7.14ms     mean 6.73ms   
@perry/postgres bun   large-10k-x-20      n=50    min 30.8ms     p50 35.1ms     p95 43.2ms     mean 36.0ms   
@perry/postgres node  tiny                n=50    min 43µs       p50 56µs       p95 138µs      mean 71µs     
@perry/postgres node  param-1row          n=50    min 74µs       p50 124µs      p95 160µs      mean 120µs    
@perry/postgres node  medium-1k-x-20      n=50    min 3.38ms     p50 3.60ms     p95 4.66ms     mean 3.75ms   
@perry/postgres node  large-10k-x-20      n=50    min 31.7ms     p50 35.8ms     p95 44.5ms     mean 36.3ms   
@perry/postgres perry  tiny                n=50    min 2.00ms     p50 3.00ms     p95 3.00ms     mean 2.52ms   
pg                node  tiny                n=50    min 71µs       p50 79µs       p95 185µs      mean 104µs    
pg                node  param-1row          n=50    min 104µs      p50 135µs      p95 218µs      mean 143µs    
pg                node  medium-1k-x-20      n=50    min 2.25ms     p50 2.47ms     p95 3.99ms     mean 2.67ms   
pg                node  large-10k-x-20      n=50    min 19.5ms     p50 20.5ms     p95 28.6ms     mean 22.5ms   
postgres.js       node  tiny                n=50    min 45µs       p50 76µs       p95 139µs      mean 85µs     
postgres.js       node  param-1row          n=50    min 107µs      p50 160µs      p95 246µs      mean 165µs    
postgres.js       node  medium-1k-x-20      n=50    min 2.61ms     p50 2.84ms     p95 4.34ms     mean 3.12ms   
postgres.js       node  large-10k-x-20      n=50    min 22.8ms     p50 26.2ms     p95 35.7ms     mean 26.5ms   
pg-native         node  tiny                n=50    min 28µs       p50 35µs       p95 96µs       mean 51µs     
pg-native         node  param-1row          n=50    min 34µs       p50 39µs       p95 110µs      mean 52µs     
pg-native         node  medium-1k-x-20      n=50    min 3.85ms     p50 4.04ms     p95 4.30ms     mean 4.05ms   
pg-native         node  large-10k-x-20      n=50    min 36.4ms     p50 37.3ms     p95 38.3ms     mean 37.5ms   
tokio-postgres   rust tiny                n=50    min 87µs       p50 113µs      p95 188µs      mean 122µs     
tokio-postgres   rust param-1row          n=50    min 77µs       p50 84µs       p95 120µs      mean 88µs      
tokio-postgres   rust medium-1k-x-20      n=50    min 2.67ms     p50 2.80ms     p95 2.92ms     mean 2.80ms    
tokio-postgres   rust large-10k-x-20      n=50    min 26.0ms     p50 26.4ms     p95 27.2ms     mean 26.5ms    
```
