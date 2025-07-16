// Performance benchmarking script for API requirements
// Measures p50, p90, p95, and p99 latencies for each API endpoint

const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

// Interactive input helper
function askQuestion(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

// Configuration - Statistically sound sample sizes
const BENCHMARK_CONFIG = {
    warmupRequests: 10,         // Warm up JIT, connection pools, etc.
    benchmarkRequests: 1000,    // Reasonable sample size for quick results
    concurrency: 10,            // Moderate concurrency
    host: 'http://localhost:5001', // Production port
    iterations: 3,              // Multiple iterations to account for variance
    confidenceLevel: 0.95       // 95% confidence level
};

// Data ranges matching setup.js
const SETUP_DATA_RANGES = {
    userIds: { min: 1000, max: 1000 + 50000000 }, // Matches setup.js NUM_USERS_TO_GENERATE
    userTypes: ["premium", "standard", "trial"],
    templates: Array.from({ length: 20 }, (_, i) => `template_${String(i + 1).padStart(3, '0')}`),
    trackingIds: Array.from({ length: 10 }, (_, i) => `track_${String(i + 1).padStart(3, '0')}`),
    statuses: ["sent", "failed", "opened", "clicked"],
    testDate: '2025-07-14'
};

// Helper to get test data from existing document using direct DB query
async function getExistingTestData() {
    const { MongoClient } = require('mongodb');
    require('dotenv').config();
    
    const MONGO_URI = process.env.MONGO_URI;
    const DB_NAME = process.env.DB_NAME;
    
    if (!MONGO_URI || !DB_NAME) {
        throw new Error('Missing MONGO_URI or DB_NAME in environment variables. Please check your .env file.');
    }
    
    const client = new MongoClient(MONGO_URI);
    
    try {
        await client.connect();
        const db = client.db(DB_NAME);
        
        // Get one existing document with events
        const document = await db.collection('communications').findOne({
            events: { $exists: true, $ne: [] }
        });
        
        if (!document || !document.events || document.events.length === 0) {
            throw new Error('No communication documents found in database. Please run setup.js first.');
        }
        
        const firstEvent = document.events[0];
        const dayDate = new Date(document.day);
        const dateString = dayDate.toISOString().split('T')[0]; // YYYY-MM-DD format
        
        return {
            userId: document.user.id,
            userType: document.user.type,
            templateId: firstEvent.metadata.template_id,
            trackingId: firstEvent.metadata.tracking_id,
            status: firstEvent.status,
            date: dateString,
            hour: new Date(firstEvent.dispatch_time).getHours(),
            dispatch_time: firstEvent.dispatch_time,
            fullDocument: document // Include the entire document
        };
    } finally {
        await client.close();
    }
}

// Test endpoints based on PDF requirements - dynamically generated
async function getApiEndpoints(testData) {
    
    
    return {
        'Req B - Get Communications (User/Day)': {
            method: 'GET',
            url: `/api/communications/user/${testData.userId}?date=${testData.date}`
        },
        'Req D - Campaign Distinct Users': {
            method: 'GET',
            url: `/api/campaigns/distinct-users?date=${testData.date}&hour=${testData.hour}&templateId=${testData.templateId}&trackingId=${testData.trackingId}&page=1`
        },
        'Req E - Get Templates': {
            method: 'GET',
            url: '/api/templates'
        }
    };
}

// HTTP request function
async function makeRequest(endpoint, config) {
    const url = `${BENCHMARK_CONFIG.host}${endpoint.url}`;
    const options = {
        method: endpoint.method,
        headers: {
            'Content-Type': 'application/json'
        }
    };

    if (endpoint.payload) {
        options.body = JSON.stringify(endpoint.payload);
    }

    const startTime = performance.now();
    
    try {
        const response = await fetch(url, options);
        const endTime = performance.now();
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        return {
            latency: Math.round(endTime - startTime),
            success: true
        };
    } catch (error) {
        const endTime = performance.now();
        return {
            latency: Math.round(endTime - startTime),
            success: false,
            error: error.message
        };
    }
}

// Calculate percentiles and statistical measures
function calculateStats(latencies) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const length = sorted.length;
    
    // Calculate mean
    const mean = sorted.reduce((a, b) => a + b, 0) / length;
    
    // Calculate standard deviation
    const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / length;
    const stdDev = Math.sqrt(variance);
    
    // Calculate percentiles
    const percentiles = {
        p50: sorted[Math.floor(length * 0.5)],
        p90: sorted[Math.floor(length * 0.9)],
        p95: sorted[Math.floor(length * 0.95)],
        p99: sorted[Math.floor(length * 0.99)],
        p99_9: sorted[Math.floor(length * 0.999)],
        min: sorted[0],
        max: sorted[length - 1],
        avg: Math.round(mean),
        stdDev: Math.round(stdDev * 100) / 100
    };
    
    // Calculate confidence intervals (95% confidence level)
    const marginOfError = 1.96 * (stdDev / Math.sqrt(length));
    percentiles.confidenceInterval = {
        lower: Math.round(mean - marginOfError),
        upper: Math.round(mean + marginOfError)
    };
    
    return percentiles;
}

// Run benchmark for a single endpoint with multiple iterations
async function benchmarkEndpoint(name, endpoint) {
    console.log(`\n🔥 Benchmarking: ${name}`);
    
    const allIterationResults = [];
    
    for (let iteration = 1; iteration <= BENCHMARK_CONFIG.iterations; iteration++) {
        console.log(`  📊 Iteration ${iteration}/${BENCHMARK_CONFIG.iterations}`);
        
        // Warmup
        console.log(`    Warming up... (${BENCHMARK_CONFIG.warmupRequests} requests)`);
        for (let i = 0; i < BENCHMARK_CONFIG.warmupRequests; i++) {
            await makeRequest(endpoint, BENCHMARK_CONFIG);
        }
        
        // Benchmark
        console.log(`    Running benchmark... (${BENCHMARK_CONFIG.benchmarkRequests} requests)`);
        const latencies = [];
        const errors = [];
        
        const startTime = performance.now();
        
        // Run requests with controlled concurrency
        const batchSize = BENCHMARK_CONFIG.concurrency;
        const totalBatches = Math.ceil(BENCHMARK_CONFIG.benchmarkRequests / batchSize);
        
        for (let batch = 0; batch < totalBatches; batch++) {
            const batchPromises = [];
            const requestsInBatch = Math.min(batchSize, BENCHMARK_CONFIG.benchmarkRequests - (batch * batchSize));
            
            for (let i = 0; i < requestsInBatch; i++) {
                batchPromises.push(makeRequest(endpoint, BENCHMARK_CONFIG));
            }
            
            const batchResults = await Promise.all(batchPromises);
            
            batchResults.forEach(result => {
                if (result.success) {
                    latencies.push(result.latency);
                } else {
                    errors.push(result.error);
                }
            });
            
            // Progress indicator
            if (batch % 20 === 0) {
                const progress = Math.round((batch / totalBatches) * 100);
                process.stdout.write(`\r    Progress: ${progress}%`);
            }
        }
        
        const endTime = performance.now();
        const totalTime = Math.round(endTime - startTime);
        
        console.log(`\r    Completed in ${totalTime}ms`);
        
        if (errors.length > 0) {
            console.log(`    ⚠️  ${errors.length} errors occurred`);
        }
        
        const stats = calculateStats(latencies);
        const successRate = ((latencies.length / BENCHMARK_CONFIG.benchmarkRequests) * 100).toFixed(1);
        
        allIterationResults.push({
            ...stats,
            successRate: parseFloat(successRate),
            errors: errors.length,
            totalRequests: BENCHMARK_CONFIG.benchmarkRequests,
            throughput: Math.round(BENCHMARK_CONFIG.benchmarkRequests / (totalTime / 1000))
        });
    }
    
    // Calculate aggregate statistics across all iterations
    const aggregateStats = {
        p50: Math.round(allIterationResults.reduce((sum, r) => sum + r.p50, 0) / allIterationResults.length),
        p90: Math.round(allIterationResults.reduce((sum, r) => sum + r.p90, 0) / allIterationResults.length),
        p95: Math.round(allIterationResults.reduce((sum, r) => sum + r.p95, 0) / allIterationResults.length),
        p99: Math.round(allIterationResults.reduce((sum, r) => sum + r.p99, 0) / allIterationResults.length),
        p99_9: Math.round(allIterationResults.reduce((sum, r) => sum + r.p99_9, 0) / allIterationResults.length),
        avg: Math.round(allIterationResults.reduce((sum, r) => sum + r.avg, 0) / allIterationResults.length),
        min: Math.min(...allIterationResults.map(r => r.min)),
        max: Math.max(...allIterationResults.map(r => r.max)),
        stdDev: Math.round(allIterationResults.reduce((sum, r) => sum + r.stdDev, 0) / allIterationResults.length * 100) / 100,
        successRate: (allIterationResults.reduce((sum, r) => sum + r.successRate, 0) / allIterationResults.length).toFixed(1),
        throughput: Math.round(allIterationResults.reduce((sum, r) => sum + r.throughput, 0) / allIterationResults.length),
        totalSamples: BENCHMARK_CONFIG.benchmarkRequests * BENCHMARK_CONFIG.iterations,
        iterations: BENCHMARK_CONFIG.iterations
    };
    
    return aggregateStats;
}

// Get collection info from user input
async function getCollectionInfo() {
    console.log('📊 Please provide collection context:');
    console.log('');
    
    const docCountInput = await askQuestion('Number of documents in collection: ');
    const serverTier = await askQuestion('Server tier (e.g., "M60" or "R60"): ');
    
    const docCount = parseInt(docCountInput.replace(/,/g, ''));
    
    if (isNaN(docCount) || docCount <= 0) {
        throw new Error('Invalid document count. Please enter a positive number.');
    }
    
    console.log('');
    console.log(`✅ Collection context: ${docCount.toLocaleString()} documents on ${serverTier}`);
    console.log('');
    
    return {
        documents: docCount,
        serverTier: serverTier
    };
}

// Generate markdown report
function generateMarkdownReport(results, collectionStats, timestamp) {
    const lines = [];
    
    lines.push('# Performance Benchmark Report');
    lines.push('');
    
    // Collection context
    lines.push('## Test Environment');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|--------|');
    lines.push(`| Documents | ${collectionStats.documents.toLocaleString()} |`);
    lines.push(`| Server Tier | ${collectionStats.serverTier} |`);
    const totalSamples = Object.values(results)[0].totalSamples;
    lines.push(`| Sample Size | ${totalSamples.toLocaleString()} requests per endpoint |`);
    lines.push('');
    
    // Performance results
    lines.push('## API Performance Results');
    lines.push('');
    lines.push('| Requirement | P50 (Median) | P90 | P95 | P99 | Avg | StdDev |');
    lines.push('|-------------|--------------|-----|-----|-----|-----|--------|');
    
    Object.entries(results).forEach(([name, stats]) => {
        lines.push(`| ${name} | ${stats.p50}ms | ${stats.p90}ms | ${stats.p95}ms | ${stats.p99}ms | ${stats.avg}ms | ${stats.stdDev}ms |`);
    });
    
    return lines.join('\n');
}

// Main benchmark function
async function runBenchmark() {
    console.log('🚀 Backend API Performance Benchmark');
    console.log('=====================================');
    
    try {
        // Check if production server is running
        const testResponse = await fetch(`${BENCHMARK_CONFIG.host}/api/templates`);
        if (!testResponse.ok) {
            throw new Error('Backend production server not running. Please start with: npm run prod');
        }
        
        // Get collection context from user input
        const collectionStats = await getCollectionInfo();
        
        console.log(`📊 BENCHMARK CONFIGURATION:`);
        console.log(`   Sample Size: ${BENCHMARK_CONFIG.benchmarkRequests.toLocaleString()} requests per endpoint`);
        console.log(`   Iterations: ${BENCHMARK_CONFIG.iterations}`);
        console.log(`   Total Samples: ${(BENCHMARK_CONFIG.benchmarkRequests * BENCHMARK_CONFIG.iterations).toLocaleString()} per endpoint`);
        console.log(`   Concurrency: ${BENCHMARK_CONFIG.concurrency}`);
        console.log(`   Confidence Level: ${(BENCHMARK_CONFIG.confidenceLevel * 100)}%`);
        console.log(`   Target: Backend only (no frontend required)`);
        console.log('');
        
        // Get test data and print it
        const testData = await getExistingTestData();
        console.log('📋 TEST DATA BEING USED (full document):');
        console.log(JSON.stringify(testData.fullDocument, null, 2));
        console.log('');
        
        // Run benchmarks
        const results = {};
        const API_ENDPOINTS = await getApiEndpoints(testData);
        
        for (const [name, endpoint] of Object.entries(API_ENDPOINTS)) {
            results[name] = await benchmarkEndpoint(name, endpoint);
        }
        
        // Generate report
        const timestamp = new Date().toISOString();
        const report = generateMarkdownReport(results, collectionStats, timestamp);
        
        // Save report to file with dynamic filename
        const sanitizedTier = collectionStats.serverTier.replace(/[^a-zA-Z0-9]/g, '_');
        const numDocs = collectionStats.documents;
        const filename = `${sanitizedTier}_${numDocs}.md`;
        const reportPath = path.join(__dirname, filename);
        fs.writeFileSync(reportPath, report);
        
        console.log('\n✅ Benchmark completed!');
        console.log(`📄 Report saved to: ${reportPath}`);
        
        console.log('\n📋 RESULTS SUMMARY:');
        console.log('==================');
        console.log(`🗄️  Database: ${collectionStats.documents.toLocaleString()} documents`);
        console.log('');
        
        Object.entries(results).forEach(([name, stats]) => {
            console.log(`${name}:`);
            console.log(`  P50: ${stats.p50}ms | P90: ${stats.p90}ms | P95: ${stats.p95}ms | P99: ${stats.p99}ms`);
        });
        
        console.log('');
        console.log(`📊 Sample Size: ${(BENCHMARK_CONFIG.benchmarkRequests * BENCHMARK_CONFIG.iterations).toLocaleString()} per endpoint`);
        
    } catch (error) {
        console.error('❌ Benchmark failed:', error.message);
        process.exit(1);
    }
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
    console.error('❌ This script requires Node.js 18+ with built-in fetch support');
    process.exit(1);
}

// Run benchmark
runBenchmark();