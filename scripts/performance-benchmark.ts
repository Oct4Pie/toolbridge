/**
 * Performance Benchmark Suite for ToolBridge
 * Phase 4: Performance & Load Testing
 * 
 * Measures:
 * - Response latency
 * - Streaming throughput
 * - Memory usage
 * - Concurrent request handling
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3100';
const WARMUP_REQUESTS = 3;
const BENCHMARK_REQUESTS = 10;

interface BenchmarkResult {
    name: string;
    avgLatency: number;
    minLatency: number;
    maxLatency: number;
    p95Latency: number;
    successRate: number;
    requestsPerSecond: number;
}

async function measureLatency(fn: () => Promise<void>): Promise<number> {
    const start = performance.now();
    await fn();
    return performance.now() - start;
}

function calculateStats(latencies: number[]): { avg: number; min: number; max: number; p95: number } {
    const sorted = [...latencies].sort((a, b) => a - b);
    return {
        avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        p95: sorted[Math.floor(sorted.length * 0.95)]
    };
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs = 30000): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

// Benchmark 1: Non-streaming chat latency
async function benchmarkNonStreamingChat(): Promise<BenchmarkResult> {
    console.log('\n📊 Benchmark 1: Non-Streaming Chat Latency');

    const request = {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say OK' }],
        stream: false,
        max_tokens: 10
    };

    // Warmup
    for (let i = 0; i < WARMUP_REQUESTS; i++) {
        await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(request)
        });
    }

    // Benchmark
    const latencies: number[] = [];
    let successes = 0;

    for (let i = 0; i < BENCHMARK_REQUESTS; i++) {
        try {
            const latency = await measureLatency(async () => {
                const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request)
                });
                if (res.ok) successes++;
                await res.text();
            });
            latencies.push(latency);
            process.stdout.write(`  Request ${i + 1}/${BENCHMARK_REQUESTS}: ${latency.toFixed(0)}ms\r`);
        } catch (e) {
            console.log(`  Request ${i + 1} failed:`, (e as Error).message);
        }
    }

    const stats = calculateStats(latencies);
    const totalTime = latencies.reduce((a, b) => a + b, 0);

    console.log(`\n  Average: ${stats.avg.toFixed(0)}ms | Min: ${stats.min.toFixed(0)}ms | Max: ${stats.max.toFixed(0)}ms | P95: ${stats.p95.toFixed(0)}ms`);
    console.log(`  Success Rate: ${(successes / BENCHMARK_REQUESTS * 100).toFixed(1)}%`);

    return {
        name: 'Non-Streaming Chat',
        avgLatency: stats.avg,
        minLatency: stats.min,
        maxLatency: stats.max,
        p95Latency: stats.p95,
        successRate: successes / BENCHMARK_REQUESTS,
        requestsPerSecond: BENCHMARK_REQUESTS / (totalTime / 1000)
    };
}

// Benchmark 2: Streaming chat throughput
async function benchmarkStreamingChat(): Promise<BenchmarkResult> {
    console.log('\n📊 Benchmark 2: Streaming Chat Throughput');

    const request = {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Count from 1 to 5' }],
        stream: true,
        max_tokens: 50
    };

    const latencies: number[] = [];
    let successes = 0;

    for (let i = 0; i < BENCHMARK_REQUESTS; i++) {
        try {
            const latency = await measureLatency(async () => {
                const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request)
                });

                if (!res.ok) return;

                // Consume all chunks
                const reader = res.body?.getReader();
                if (!reader) return;

                while (true) {
                    const { done } = await reader.read();
                    if (done) break;
                }
                successes++;
            });
            latencies.push(latency);
            process.stdout.write(`  Request ${i + 1}/${BENCHMARK_REQUESTS}: ${latency.toFixed(0)}ms\r`);
        } catch (e) {
            console.log(`  Request ${i + 1} failed:`, (e as Error).message);
        }
    }

    const stats = calculateStats(latencies);
    const totalTime = latencies.reduce((a, b) => a + b, 0);

    console.log(`\n  Average: ${stats.avg.toFixed(0)}ms | Min: ${stats.min.toFixed(0)}ms | Max: ${stats.max.toFixed(0)}ms | P95: ${stats.p95.toFixed(0)}ms`);
    console.log(`  Success Rate: ${(successes / BENCHMARK_REQUESTS * 100).toFixed(1)}%`);

    return {
        name: 'Streaming Chat',
        avgLatency: stats.avg,
        minLatency: stats.min,
        maxLatency: stats.max,
        p95Latency: stats.p95,
        successRate: successes / BENCHMARK_REQUESTS,
        requestsPerSecond: BENCHMARK_REQUESTS / (totalTime / 1000)
    };
}

// Benchmark 3: Concurrent requests
async function benchmarkConcurrentRequests(): Promise<BenchmarkResult> {
    console.log('\n📊 Benchmark 3: Concurrent Request Handling');

    const CONCURRENT = 5;
    const request = {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'Say hi' }],
        stream: false,
        max_tokens: 5
    };

    const startTime = performance.now();
    const allLatencies: number[] = [];
    let successes = 0;

    // Run CONCURRENT requests at once
    const promises = Array(CONCURRENT).fill(null).map(async (_, idx) => {
        try {
            const latency = await measureLatency(async () => {
                const res = await fetchWithTimeout(`${BASE_URL}/v1/chat/completions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request)
                });
                if (res.ok) successes++;
                await res.text();
            });
            allLatencies.push(latency);
            console.log(`  Concurrent request ${idx + 1} completed: ${latency.toFixed(0)}ms`);
        } catch (e) {
            console.log(`  Concurrent request ${idx + 1} failed:`, (e as Error).message);
        }
    });

    await Promise.all(promises);

    const totalTime = performance.now() - startTime;
    const stats = calculateStats(allLatencies);

    console.log(`\n  Total time for ${CONCURRENT} concurrent requests: ${totalTime.toFixed(0)}ms`);
    console.log(`  Average per request: ${stats.avg.toFixed(0)}ms | P95: ${stats.p95.toFixed(0)}ms`);
    console.log(`  Success Rate: ${(successes / CONCURRENT * 100).toFixed(1)}%`);

    return {
        name: 'Concurrent Requests',
        avgLatency: stats.avg,
        minLatency: stats.min,
        maxLatency: stats.max,
        p95Latency: stats.p95,
        successRate: successes / CONCURRENT,
        requestsPerSecond: CONCURRENT / (totalTime / 1000)
    };
}

// Benchmark 4: Format translation overhead
async function benchmarkFormatTranslation(): Promise<BenchmarkResult> {
    console.log('\n📊 Benchmark 4: Format Translation (Ollama→OpenAI)');

    const request = {
        model: 'openai/gpt-4o-mini',
        messages: [{ role: 'user', content: 'OK' }],
        stream: false
    };

    const latencies: number[] = [];
    let successes = 0;

    for (let i = 0; i < BENCHMARK_REQUESTS; i++) {
        try {
            const latency = await measureLatency(async () => {
                const res = await fetchWithTimeout(`${BASE_URL}/api/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(request)
                });
                if (res.ok) successes++;
                await res.text();
            });
            latencies.push(latency);
            process.stdout.write(`  Request ${i + 1}/${BENCHMARK_REQUESTS}: ${latency.toFixed(0)}ms\r`);
        } catch (e) {
            console.log(`  Request ${i + 1} failed:`, (e as Error).message);
        }
    }

    const stats = calculateStats(latencies);
    const totalTime = latencies.reduce((a, b) => a + b, 0);

    console.log(`\n  Average: ${stats.avg.toFixed(0)}ms | Min: ${stats.min.toFixed(0)}ms | Max: ${stats.max.toFixed(0)}ms | P95: ${stats.p95.toFixed(0)}ms`);
    console.log(`  Success Rate: ${(successes / BENCHMARK_REQUESTS * 100).toFixed(1)}%`);

    return {
        name: 'Format Translation',
        avgLatency: stats.avg,
        minLatency: stats.min,
        maxLatency: stats.max,
        p95Latency: stats.p95,
        successRate: successes / BENCHMARK_REQUESTS,
        requestsPerSecond: BENCHMARK_REQUESTS / (totalTime / 1000)
    };
}

// Main benchmark runner
async function runBenchmarks() {
    console.log('='.repeat(60));
    console.log('       ToolBridge Performance Benchmark Suite');
    console.log('='.repeat(60));
    console.log(`Server: ${BASE_URL}`);
    console.log(`Warmup: ${WARMUP_REQUESTS} requests`);
    console.log(`Benchmark: ${BENCHMARK_REQUESTS} requests per test`);
    console.log('='.repeat(60));

    const results: BenchmarkResult[] = [];

    // Check server is up
    try {
        const res = await fetch(`${BASE_URL}/api/version`);
        if (!res.ok) throw new Error('Server not responding');
        console.log('\n✅ Server is running');
    } catch (e) {
        console.error('\n❌ Error: Server not responding at', BASE_URL);
        process.exit(1);
    }

    // Run benchmarks
    results.push(await benchmarkNonStreamingChat());
    results.push(await benchmarkStreamingChat());
    results.push(await benchmarkConcurrentRequests());
    results.push(await benchmarkFormatTranslation());

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('                    BENCHMARK SUMMARY');
    console.log('='.repeat(60));
    console.log('\n| Benchmark            | Avg (ms) | P95 (ms) | Success |');
    console.log('|----------------------|----------|----------|---------|');

    for (const r of results) {
        console.log(`| ${r.name.padEnd(20)} | ${r.avgLatency.toFixed(0).padStart(8)} | ${r.p95Latency.toFixed(0).padStart(8)} | ${(r.successRate * 100).toFixed(0).padStart(6)}% |`);
    }

    console.log('\n' + '='.repeat(60));

    // Memory usage
    const used = process.memoryUsage();
    console.log('\nMemory Usage:');
    console.log(`  Heap Used: ${(used.heapUsed / 1024 / 1024).toFixed(2)} MB`);
    console.log(`  RSS: ${(used.rss / 1024 / 1024).toFixed(2)} MB`);

    console.log('\n✅ Benchmark complete!\n');
}

runBenchmarks().catch(console.error);
