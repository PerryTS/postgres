# Benchmark results

Sun Apr 19 07:08:22 CEST 2026

PG: `127.0.0.1:55432/bench`

```
@perryts/postgres bun   tiny                n=50    min 62µs       p50 90µs       p95 196µs      mean 105µs    
@perryts/postgres bun   param-1row          n=50    min 80µs       p50 105µs      p95 172µs      mean 124µs    
@perryts/postgres bun   medium-1k-x-20      n=50    min 3.16ms     p50 3.35ms     p95 6.24ms     mean 3.71ms   
@perryts/postgres bun   large-10k-x-20      n=50    min 30.2ms     p50 33.3ms     p95 35.1ms     mean 33.1ms   
@perryts/postgres node  tiny                n=50    min 42µs       p50 74µs       p95 163µs      mean 87µs     
@perryts/postgres node  param-1row          n=50    min 72µs       p50 111µs      p95 238µs      mean 136µs    
@perryts/postgres node  medium-1k-x-20      n=50    min 3.33ms     p50 3.51ms     p95 4.39ms     mean 3.65ms   
@perryts/postgres node  large-10k-x-20      n=50    min 31.5ms     p50 34.5ms     p95 40.9ms     mean 34.8ms   
@perryts/postgres perry  tiny                n=50    min 0µs        p50 0µs        p95 1.00ms     mean 100µs    
@perryts/postgres perry  param-1row          n=50    min 0µs        p50 0µs        p95 1.00ms     mean 120µs    
@perryts/postgres perry  medium-1k-x-20      n=50    min 5.00ms     p50 6.00ms     p95 10.0ms     mean 6.92ms   
@perryts/postgres perry  large-10k-x-20      n=50    min 77.0ms     p50 90.0ms     p95 120.0ms    mean 92.4ms   
pg                node  tiny                n=50    min 83µs       p50 114µs      p95 181µs      mean 121µs    
pg                node  param-1row          n=50    min 109µs      p50 148µs      p95 187µs      mean 150µs    
pg                node  medium-1k-x-20      n=50    min 2.26ms     p50 2.48ms     p95 3.98ms     mean 2.66ms   
pg                node  large-10k-x-20      n=50    min 19.4ms     p50 20.1ms     p95 26.9ms     mean 22.0ms   
postgres.js       node  tiny                n=50    min 42µs       p50 53µs       p95 134µs      mean 64µs     
postgres.js       node  param-1row          n=50    min 88µs       p50 112µs      p95 193µs      mean 120µs    
postgres.js       node  medium-1k-x-20      n=50    min 2.61ms     p50 2.98ms     p95 4.48ms     mean 3.17ms   
postgres.js       node  large-10k-x-20      n=50    min 22.9ms     p50 26.1ms     p95 36.6ms     mean 27.0ms   
pg-native         node  tiny                n=50    min 38µs       p50 47µs       p95 124µs      mean 68µs     
pg-native         node  param-1row          n=50    min 43µs       p50 55µs       p95 99µs       mean 63µs     
pg-native         node  medium-1k-x-20      n=50    min 3.67ms     p50 3.95ms     p95 4.16ms     mean 3.95ms   
pg-native         node  large-10k-x-20      n=50    min 36.5ms     p50 37.1ms     p95 38.2ms     mean 37.3ms   
tokio-postgres   rust tiny                n=50    min 63µs       p50 69µs       p95 110µs      mean 74µs      
tokio-postgres   rust param-1row          n=50    min 72µs       p50 96µs       p95 139µs      mean 101µs     
tokio-postgres   rust medium-1k-x-20      n=50    min 2.69ms     p50 2.79ms     p95 2.91ms     mean 2.80ms    
tokio-postgres   rust large-10k-x-20      n=50    min 26.0ms     p50 26.5ms     p95 27.0ms     mean 26.5ms    
```
