# Benchmark results

Fri Apr 17 11:14:40 CEST 2026

PG: `127.0.0.1:55432/bench`

```
@perry/postgres bun   tiny                n=50    min 76µs       p50 123µs      p95 355µs      mean 151µs    
@perry/postgres bun   param-1row          n=50    min 93µs       p50 120µs      p95 200µs      mean 131µs    
@perry/postgres bun   medium-1k-x-20      n=50    min 4.27ms     p50 4.87ms     p95 7.87ms     mean 5.35ms   
@perry/postgres bun   large-10k-x-20      n=50    min 44.9ms     p50 46.5ms     p95 50.9ms     mean 46.9ms   
@perry/postgres node  tiny                n=50    min 110µs      p50 148µs      p95 235µs      mean 174µs    
@perry/postgres node  param-1row          n=50    min 128µs      p50 181µs      p95 270µs      mean 196µs    
@perry/postgres node  medium-1k-x-20      n=50    min 5.22ms     p50 6.15ms     p95 7.87ms     mean 6.31ms   
@perry/postgres node  large-10k-x-20      n=50    min 50.7ms     p50 59.6ms     p95 72.7ms     mean 61.9ms   
pg                node  tiny                n=50    min 83µs       p50 120µs      p95 185µs      mean 124µs    
pg                node  param-1row          n=50    min 103µs      p50 150µs      p95 298µs      mean 198µs    
pg                node  medium-1k-x-20      n=50    min 2.25ms     p50 2.49ms     p95 4.37ms     mean 2.70ms   
pg                node  large-10k-x-20      n=50    min 19.8ms     p50 20.4ms     p95 28.4ms     mean 22.7ms   
postgres.js       node  tiny                n=50    min 44µs       p50 62µs       p95 197µs      mean 88µs     
postgres.js       node  param-1row          n=50    min 115µs      p50 162µs      p95 269µs      mean 169µs    
postgres.js       node  medium-1k-x-20      n=50    min 2.67ms     p50 2.96ms     p95 5.61ms     mean 3.28ms   
postgres.js       node  large-10k-x-20      n=50    min 23.4ms     p50 25.8ms     p95 37.8ms     mean 27.4ms   
pg-native         node  tiny                n=50    min 41µs       p50 59µs       p95 274µs      mean 86µs     
pg-native         node  param-1row          n=50    min 49µs       p50 75µs       p95 175µs      mean 85µs     
pg-native         node  medium-1k-x-20      n=50    min 3.79ms     p50 4.07ms     p95 4.47ms     mean 4.11ms   
pg-native         node  large-10k-x-20      n=50    min 37.3ms     p50 38.0ms     p95 39.9ms     mean 38.4ms   
tokio-postgres   rust tiny                n=50    min 80µs       p50 106µs      p95 155µs      mean 113µs     
tokio-postgres   rust param-1row          n=50    min 86µs       p50 119µs      p95 201µs      mean 135µs     
tokio-postgres   rust medium-1k-x-20      n=50    min 2.69ms     p50 2.86ms     p95 3.15ms     mean 2.88ms    
tokio-postgres   rust large-10k-x-20      n=50    min 26.8ms     p50 27.3ms     p95 34.5ms     mean 28.1ms    
```
