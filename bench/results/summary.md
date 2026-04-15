# Benchmark results

Wed Apr 15 15:22:28 CEST 2026

PG: `127.0.0.1:55432/bench`

```
@perry/postgres bun   tiny                n=50    min 60µs       p50 84µs       p95 184µs      mean 100µs    
@perry/postgres bun   param-1row          n=50    min 82µs       p50 128µs      p95 242µs      mean 157µs    
@perry/postgres bun   medium-1k-x-20      n=50    min 3.13ms     p50 3.43ms     p95 6.14ms     mean 3.76ms   
@perry/postgres bun   large-10k-x-20      n=50    min 31.0ms     p50 34.1ms     p95 37.7ms     mean 33.8ms   
@perry/postgres node  tiny                n=50    min 42µs       p50 73µs       p95 144µs      mean 84µs     
@perry/postgres node  param-1row          n=50    min 66µs       p50 100µs      p95 402µs      mean 145µs    
@perry/postgres node  medium-1k-x-20      n=50    min 3.41ms     p50 3.73ms     p95 4.94ms     mean 3.89ms   
@perry/postgres node  large-10k-x-20      n=50    min 32.2ms     p50 37.8ms     p95 61.6ms     mean 40.6ms   
@perry/postgres perry  tiny                n=50    min 2.00ms     p50 3.00ms     p95 3.00ms     mean 2.52ms   
@perry/postgres perry  param-1row          n=50    min 2.00ms     p50 3.00ms     p95 3.00ms     mean 2.54ms   
@perry/postgres perry  medium-1k-x-20      n=50    min 36.0ms     p50 43.0ms     p95 51.0ms     mean 43.6ms   
@perry/postgres perry  large-10k-x-20      n=50    min 760.0ms    p50 896.5ms    p95 1068.0ms   mean 910.3ms  
pg                node  tiny                n=50    min 75µs       p50 149µs      p95 318µs      mean 161µs    
pg                node  param-1row          n=50    min 108µs      p50 181µs      p95 326µs      mean 195µs    
pg                node  medium-1k-x-20      n=50    min 2.42ms     p50 2.80ms     p95 6.06ms     mean 3.32ms   
pg                node  large-10k-x-20      n=50    min 19.9ms     p50 21.0ms     p95 29.3ms     mean 23.2ms   
postgres.js       node  tiny                n=50    min 47µs       p50 75µs       p95 128µs      mean 81µs     
postgres.js       node  param-1row          n=50    min 108µs      p50 166µs      p95 218µs      mean 172µs    
postgres.js       node  medium-1k-x-20      n=50    min 2.68ms     p50 2.98ms     p95 5.35ms     mean 3.30ms   
postgres.js       node  large-10k-x-20      n=50    min 23.3ms     p50 27.7ms     p95 38.6ms     mean 27.5ms   
tokio-postgres   rust tiny                n=50    min 66µs       p50 73µs       p95 152µs      mean 87µs      
tokio-postgres   rust param-1row          n=50    min 83µs       p50 107µs      p95 170µs      mean 114µs     
tokio-postgres   rust medium-1k-x-20      n=50    min 2.74ms     p50 2.92ms     p95 3.27ms     mean 2.98ms    
tokio-postgres   rust large-10k-x-20      n=50    min 27.1ms     p50 28.3ms     p95 32.5ms     mean 28.8ms    
```
