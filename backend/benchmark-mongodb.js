// MongoDB-only Performance Benchmark Script
// Direct database queries without HTTP/Express overhead

const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { MongoClient } = require('mongodb');

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

// Configuration
const BENCHMARK_CONFIG = {
    warmupRequests: 10,
    benchmarkRequests: 1000,
    concurrency: 10,
    iterations: 3,
    confidenceLevel: 0.95
};

// MongoDB connection
let mongoClient;
let db;

async function connectToMongoDB() {
    require('dotenv').config();

    const MONGO_URI = process.env.MONGO_URI;
    const DB_NAME = process.env.DB_NAME;

    if (!MONGO_URI || !DB_NAME) {
        throw new Error('Missing MONGO_URI or DB_NAME in environment variables.');
    }

    mongoClient = new MongoClient(MONGO_URI);
    await mongoClient.connect();
    db = mongoClient.db(DB_NAME);

    console.log(`✅ Connected to MongoDB:`);
    console.log(`   Connection: ${MONGO_URI}`);
    console.log(`   Database: ${DB_NAME}`);
}

async function closeMongoDB() {
    if (mongoClient) {
        await mongoClient.close();
    }
}

// Get test data from existing document
async function getExistingTestData() {
    // Get one existing document with events
    const document = await db.collection('communications').findOne({
        events: { $exists: true, $ne: [] }
    });

    if (!document || !document.events || document.events.length === 0) {
        throw new Error('No communication documents found in database.');
    }

    const firstEvent = document.events[0];
    const dayDate = new Date(document.day);
    const dateString = dayDate.toISOString().split('T')[0];

    // Get a lastUserId for pagination testing
    const distinctUsersResult = await db.collection('communications').aggregate([
        {
            $match: {
                day: document.day,
                events: {
                    $elemMatch: {
                        "dispatch_time": {
                            $gte: new Date(new Date(firstEvent.dispatch_time).setMinutes(0, 0, 0)),
                            $lt: new Date(new Date(firstEvent.dispatch_time).setMinutes(59, 59, 999))
                        },
                        "metadata.template_id": firstEvent.metadata.template_id,
                        "metadata.tracking_id": firstEvent.metadata.tracking_id
                    }
                }
            }
        },
        { $group: { _id: "$user.id" } },
        { $sort: { _id: 1 } },
        { $limit: 10 }
    ]).toArray();

    const lastUserId = distinctUsersResult.length > 5 ? distinctUsersResult[5]._id : null;

    return {
        userId: document.user.id,
        userType: document.user.type,
        templateId: firstEvent.metadata.template_id,
        trackingId: firstEvent.metadata.tracking_id,
        status: firstEvent.status,
        date: dateString,
        hour: new Date(firstEvent.dispatch_time).getHours(),
        dispatch_time: firstEvent.dispatch_time,
        lastUserId: lastUserId,
        dayDate: document.day
    };
}

// MongoDB-only query functions
const mongoQueries = {
    'Get Communications (User/Day)': async (testData, printQuery = false) => {
        const startOfDay = new Date(testData.date);
        startOfDay.setUTCHours(0, 0, 0, 0);

        const query = { "user.id": testData.userId, day: startOfDay };
        const options = { projection: { events: 1, _id: 0 } };

        if (printQuery) {
            console.log(`  🔍 Query: db.collection('communications').findOne(`);
            console.log(`      ${JSON.stringify(query, null, 6)},`);
            console.log(`      ${JSON.stringify(options, null, 6)}`);
            console.log(`    )`);
        }

        const startTime = performance.now();
        const result = await db.collection('communications').findOne(query, options);
        const endTime = performance.now();

        return {
            latency: Math.round(endTime - startTime),
            success: true,
            resultCount: result ? (result.events ? result.events.length : 0) : 0
        };
    },

    'Get Distinct Users for a Campaign': async (testData, printQuery = false) => {
        const startOfDay = new Date(testData.date);
        startOfDay.setUTCHours(0, 0, 0, 0);

        const startOfHour = new Date(testData.date);
        startOfHour.setUTCHours(parseInt(testData.hour), 0, 0, 0);

        const endOfHour = new Date(startOfHour.getTime() + 60 * 60 * 1000);
        const PAGE_SIZE = 10;

        const matchStage = {
            $match: {
                day: startOfDay,
                events: {
                    $elemMatch: {
                        "dispatch_time": { $gte: startOfHour, $lt: endOfHour },
                        "metadata.template_id": testData.templateId,
                        "metadata.tracking_id": testData.trackingId
                    }
                }
            }
        };

        const pipeline = [
            matchStage,
            { $group: { _id: "$user.id" } },
            { $sort: { _id: 1 } },
            ...(testData.lastUserId ? [{ $match: { _id: { $gt: parseInt(testData.lastUserId) } } }] : []),
            { $limit: PAGE_SIZE + 1 }
        ];

        if (printQuery) {
            console.log(`  🔍 Query: db.collection('communications').aggregate(`);
            console.log(`      ${JSON.stringify(pipeline, null, 6)}`);
            console.log(`    ).toArray()`);
            console.log(`  📋 Using lastUserId: ${testData.lastUserId}`);
        }

        const startTime = performance.now();
        const results = await db.collection('communications').aggregate(pipeline).toArray();
        const endTime = performance.now();

        return {
            latency: Math.round(endTime - startTime),
            success: true,
            resultCount: results.length
        };
    },

    'Get Templates': async (testData, printQuery = false) => {
        if (printQuery) {
            console.log(`  🔍 Query: db.collection('communications').distinct('events.metadata.template_id')`);
        }

        const startTime = performance.now();
        const templates = await db.collection('communications').distinct('events.metadata.template_id');
        const endTime = performance.now();

        return {
            latency: Math.round(endTime - startTime),
            success: true,
            resultCount: templates.length
        };
    },

    'Get Tracking IDs': async (testData, printQuery = false) => {
        if (printQuery) {
            console.log(`  🔍 Query: db.collection('communications').distinct('events.metadata.tracking_id')`);
        }

        const startTime = performance.now();
        const trackingIds = await db.collection('communications').distinct('events.metadata.tracking_id');
        const endTime = performance.now();

        return {
            latency: Math.round(endTime - startTime),
            success: true,
            resultCount: trackingIds.length
        };
    }
};

// Calculate percentiles and statistical measures
function calculateStats(latencies) {
    const sorted = [...latencies].sort((a, b) => a - b);
    const length = sorted.length;

    const mean = sorted.reduce((a, b) => a + b, 0) / length;
    const variance = sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / length;
    const stdDev = Math.sqrt(variance);

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

    const marginOfError = 1.96 * (stdDev / Math.sqrt(length));
    percentiles.confidenceInterval = {
        lower: Math.round(mean - marginOfError),
        upper: Math.round(mean + marginOfError)
    };

    return percentiles;
}

// Run benchmark for a single MongoDB query
async function benchmarkMongoQuery(name, queryFunc, testData) {
    console.log(`\n🔥 Benchmarking MongoDB Query: ${name}`);

    const allIterationResults = [];

    for (let iteration = 1; iteration <= BENCHMARK_CONFIG.iterations; iteration++) {
        console.log(`  📊 Iteration ${iteration}/${BENCHMARK_CONFIG.iterations}`);

        // Print query details for the first iteration only
        if (iteration === 1) {
            await queryFunc(testData, true); // Print query
        }

        // Warmup
        console.log(`    Warming up... (${BENCHMARK_CONFIG.warmupRequests} requests)`);
        for (let i = 0; i < BENCHMARK_CONFIG.warmupRequests; i++) {
            await queryFunc(testData);
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
                batchPromises.push(queryFunc(testData).catch(error => ({
                    success: false,
                    error: error.message,
                    latency: 0
                })));
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
    const userCountInput = await askQuestion('Number of users in collection: ');
    const serverTier = await askQuestion('Server tier (e.g., "M60" or "R60"): ');

    const docCount = parseInt(docCountInput.replace(/,/g, ''));
    const userCount = parseInt(userCountInput.replace(/,/g, ''));

    if (isNaN(docCount) || docCount <= 0) {
        throw new Error('Invalid document count. Please enter a positive number.');
    }

    if (isNaN(userCount) || userCount <= 0) {
        throw new Error('Invalid user count. Please enter a positive number.');
    }

    console.log('');
    console.log(`✅ Collection context: ${userCount.toLocaleString()} users, ${docCount.toLocaleString()} documents on ${serverTier}`);
    console.log('');

    return {
        users: userCount,
        documents: docCount,
        serverTier: serverTier
    };
}

// Generate markdown report
function generateMarkdownReport(results, collectionStats, timestamp) {
    const lines = [];

    lines.push('# MongoDB Performance Benchmark Report');
    lines.push('');
    lines.push('**Direct MongoDB queries without HTTP/Express overhead**');
    lines.push('');

    // Collection context
    lines.push('## Test Environment');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|--------|');
    lines.push(`| Users | ${collectionStats.users.toLocaleString()} |`);
    lines.push(`| Documents | ${collectionStats.documents.toLocaleString()} |`);
    lines.push(`| Server Tier | ${collectionStats.serverTier} |`);
    const totalSamples = Object.values(results)[0].totalSamples;
    lines.push(`| Sample Size | ${totalSamples.toLocaleString()} requests per query |`);
    lines.push('');

    // Performance results
    lines.push('## MongoDB Query Performance Results');
    lines.push('');
    lines.push('| Query | P50 (Median) | P90 | P95 | P99 | Avg | StdDev |');
    lines.push('|-------|--------------|-----|-----|-----|-----|--------|');

    Object.entries(results).forEach(([name, stats]) => {
        lines.push(`| ${name} | ${stats.p50}ms | ${stats.p90}ms | ${stats.p95}ms | ${stats.p99}ms | ${stats.avg}ms | ${stats.stdDev}ms |`);
    });

    lines.push('');
    lines.push('*Note: These are pure MongoDB query times without any HTTP/Express overhead.*');

    return lines.join('\n');
}

// Main benchmark function
async function runMongoDBBenchmark() {
    console.log('🚀 MongoDB-Only Performance Benchmark');
    console.log('=====================================');
    console.log('📌 Testing pure MongoDB performance without HTTP/Express overhead');
    console.log('');

    try {
        // Connect to MongoDB
        await connectToMongoDB();

        // Get collection context from user input
        const collectionStats = await getCollectionInfo();

        console.log(`📊 BENCHMARK CONFIGURATION:`);
        console.log(`   Sample Size: ${BENCHMARK_CONFIG.benchmarkRequests.toLocaleString()} requests per query`);
        console.log(`   Iterations: ${BENCHMARK_CONFIG.iterations}`);
        console.log(`   Total Samples: ${(BENCHMARK_CONFIG.benchmarkRequests * BENCHMARK_CONFIG.iterations).toLocaleString()} per query`);
        console.log(`   Concurrency: ${BENCHMARK_CONFIG.concurrency}`);
        console.log(`   Target: MongoDB queries only (no HTTP/Express)`);
        console.log('');

        // Get test data
        const testData = await getExistingTestData();
        console.log('📋 TEST DATA:');
        console.log(`   User ID: ${testData.userId}`);
        console.log(`   Date: ${testData.date}`);
        console.log(`   Hour: ${testData.hour}`);
        console.log(`   Template ID: ${testData.templateId}`);
        console.log(`   Tracking ID: ${testData.trackingId}`);
        console.log(`   Last User ID: ${testData.lastUserId}`);
        console.log('');

        // Run benchmarks
        const results = {};

        for (const [name, queryFunc] of Object.entries(mongoQueries)) {
            results[name] = await benchmarkMongoQuery(name, queryFunc, testData);
        }

        // Generate report
        const timestamp = new Date().toISOString();
        const report = generateMarkdownReport(results, collectionStats, timestamp);

        // Save report to file
        const sanitizedTier = collectionStats.serverTier.replace(/[^a-zA-Z0-9]/g, '_');
        const numDocs = collectionStats.documents;
        const filename = `mongodb_${sanitizedTier}_${numDocs}.md`;
        const reportPath = path.join(__dirname, filename);
        fs.writeFileSync(reportPath, report);

        console.log('\n✅ MongoDB Benchmark completed!');
        console.log(`📄 Report saved to: ${reportPath}`);

        console.log('\n📋 MONGODB PERFORMANCE RESULTS:');
        console.log('===============================');
        console.log(`👥 Users: ${collectionStats.users.toLocaleString()}`);
        console.log(`🗄️ Database: ${collectionStats.documents.toLocaleString()} documents`);
        console.log('');

        Object.entries(results).forEach(([name, stats]) => {
            console.log(`${name}:`);
            console.log(`  P50: ${stats.p50}ms | P90: ${stats.p90}ms | P95: ${stats.p95}ms | P99: ${stats.p99}ms`);
        });

        console.log('');
        console.log(`📊 Sample Size: ${(BENCHMARK_CONFIG.benchmarkRequests * BENCHMARK_CONFIG.iterations).toLocaleString()} per query`);
        console.log('🎯 Pure MongoDB performance - no HTTP/Express overhead');

    } catch (error) {
        console.error('❌ MongoDB Benchmark failed:', error.message);
        process.exit(1);
    } finally {
        await closeMongoDB();
    }
}

// Check if fetch is available (Node.js 18+)
if (typeof fetch === 'undefined') {
    console.error('❌ This script requires Node.js 18+');
    process.exit(1);
}

// Run benchmark
runMongoDBBenchmark();