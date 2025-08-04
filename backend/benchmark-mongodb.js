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
    iterations: 3
};

const PAGE_SIZE = 500;

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
    // Get one existing document from user_comms
    const document = await db.collection('user_comms').findOne({
        planned_date_hour: { $exists: true }
    });

    if (!document) {
        throw new Error('No user_comms documents found in database.');
    }

    // Extract user_id from the composite _id (format: userId_trackingId_templateId)
    const idParts = document._id.split('_');
    const userId = idParts[0];
    
    // Get a few documents for the same tracking/template to find lastUserId for pagination
    const paginationDocs = await db.collection('user_comms').find({
        tracking_id: document.tracking_id,
        template_id: document.template_id,
        planned_date_hour: document.planned_date_hour
    })
    .sort({ user_id: 1 })
    .limit(10)
    .toArray();

    // For v1, lastUserId should be null (first page)
    const lastUserIdForV1 = null;
    
    // For v2, we need a valid lastUserId for pagination
    let lastUserIdForV2;
    if (paginationDocs.length > 5) {
        lastUserIdForV2 = paginationDocs[5].user_id;
    } else if (paginationDocs.length > 0) {
        lastUserIdForV2 = paginationDocs[0].user_id;
    } else {
        // Fallback: use the current document's user_id
        lastUserIdForV2 = userId;
    }

    // Calculate date ranges for GetUserSchedule testing
    const plannedDate = new Date(document.planned_date_hour);
    const startTime = new Date(plannedDate);
    startTime.setHours(startTime.getHours() - 12); // 12 hours before
    const endTime = new Date(plannedDate);
    endTime.setHours(endTime.getHours() + 12); // 12 hours after

    return {
        userId: document.user_id,
        templateId: document.template_id,
        trackingId: document.tracking_id,
        plannedDateHour: document.planned_date_hour,
        startTime: startTime,
        endTime: endTime,
        lastUserId: lastUserIdForV1,  // For backward compatibility
        lastUserIdForV1: lastUserIdForV1,
        lastUserIdForV2: lastUserIdForV2,
        compositeId: document._id
    };
}

// MongoDB-only query functions matching Go DAO operations
const mongoQueries = {
    'GetEligibleUserComms': async (testData, printQuery = false) => {
        const query = { user_id: testData.userId };
        const options = { 
            // Limit to 100 documents to simulate typical user load
            // This avoids iterating through potentially thousands of docs
            limit: 100,
            batchSize: 100
        };

        if (printQuery) {
            console.log(`  🔍 Query: db.collection('user_comms').find(`);
            console.log(`      ${JSON.stringify(query, null, 6)}`);
            console.log(`    ).batchSize(100).limit(100).explain("executionStats")`);
            console.log(`  📋 Note: Using limit(100) to simulate typical user data volume`);
        }

        const startTime = performance.now();
        const explainResult = await db.collection('user_comms').find(query).batchSize(100).limit(100).explain("executionStats");
        const endTime = performance.now();

        const totalLatency = Math.round(endTime - startTime);
        const mongoOnlyLatency = explainResult.executionStats.executionTimeMillis;
        const resultCount = explainResult.executionStats.totalDocsExamined;

        return {
            latency: totalLatency,
            mongoOnlyLatency: mongoOnlyLatency,
            success: true,
            resultCount: resultCount
        };
    },

    'GetScheduleSegment_v1': async (testData, printQuery = false) => {
        // Build base filter
        const query = {
            tracking_id: testData.trackingId,
            template_id: testData.templateId,
            planned_date_hour: testData.plannedDateHour
        };
        
        // Add pagination condition if lastUserId provided
        if (testData.lastUserId) {
            query.user_id = { $gt: testData.lastUserId };
        }
        
        const options = {
            sort: { user_id: 1 },
            limit: PAGE_SIZE,
            projection: { user_id: 1 } // Only return user_id field
        };

        if (printQuery) {
            console.log(`  🔍 Query: db.collection('user_comms').find(`);
            console.log(`      ${JSON.stringify(query, null, 6)},`);
            console.log(`      ${JSON.stringify(options, null, 6)}`);
            console.log(`    ).explain("executionStats")`);
            console.log(`  📋 V1: Initial page query (lastUserId can be null)`);
            console.log(`  📋 Using cursor-based pagination with lastUserId: ${testData.lastUserId || 'null (first page)'}`);
            console.log(`  📋 Page size: ${PAGE_SIZE}`);
        }

        const startTime = performance.now();
        const explainResult = await db.collection('user_comms')
            .find(query, options)
            .explain("executionStats");
        const endTime = performance.now();

        const totalLatency = Math.round(endTime - startTime);
        const mongoOnlyLatency = explainResult.executionStats.executionTimeMillis;
        const resultCount = explainResult.executionStats.nReturned || 0;

        return {
            latency: totalLatency,
            mongoOnlyLatency: mongoOnlyLatency,
            success: true,
            resultCount: resultCount
        };
    },

    'GetScheduleSegment_v2': async (testData, printQuery = false) => {
        // V2 always includes lastUserId for pagination (no first page query)
        const query = {
            tracking_id: testData.trackingId,
            template_id: testData.templateId,
            planned_date_hour: testData.plannedDateHour,
            user_id: { $gt: testData.lastUserIdForV2 }
        };
        
        const options = {
            sort: { user_id: 1 },
            limit: PAGE_SIZE,
            projection: { user_id: 1 } // Only return user_id field
        };

        if (printQuery) {
            console.log(`  🔍 Query: db.collection('user_comms').find(`);
            console.log(`      ${JSON.stringify(query, null, 6)},`);
            console.log(`      ${JSON.stringify(options, null, 6)}`);
            console.log(`    ).explain("executionStats")`);
            console.log(`  📋 V2: Pagination query (lastUserId always provided)`);
            console.log(`  📋 Using cursor-based pagination with lastUserId: ${testData.lastUserIdForV2}`);
            console.log(`  📋 Page size: ${PAGE_SIZE}`);
        }

        const startTime = performance.now();
        const explainResult = await db.collection('user_comms')
            .find(query, options)
            .explain("executionStats");
        const endTime = performance.now();

        const totalLatency = Math.round(endTime - startTime);
        const mongoOnlyLatency = explainResult.executionStats.executionTimeMillis;
        const resultCount = explainResult.executionStats.nReturned || 0;

        return {
            latency: totalLatency,
            mongoOnlyLatency: mongoOnlyLatency,
            success: true,
            resultCount: resultCount
        };
    },

    'GetUserSchedule': async (testData, printQuery = false) => {
        const query = {
            user_id: testData.userId,
            planned_date_hour: {
                $gte: testData.startTime,
                $lte: testData.endTime
            }
        };

        const options = {
            sort: { final_score: -1 }, // DESC order
            projection: {
                tracking_id: 1,
                template_id: 1,
                final_score: 1
            }
        };

        if (printQuery) {
            console.log(`  🔍 Query: db.collection('user_comms').find(`);
            console.log(`      ${JSON.stringify(query, null, 6)},`);
            console.log(`      ${JSON.stringify(options, null, 6)}`);
            console.log(`    ).explain("executionStats")`);
            console.log(`  📋 Date range: ${testData.startTime.toISOString()} to ${testData.endTime.toISOString()}`);
            console.log(`  📋 Sorted by final_score DESC`);
        }

        const startTime = performance.now();
        const explainResult = await db.collection('user_comms')
            .find(query, options)
            .explain("executionStats");
        const endTime = performance.now();

        const totalLatency = Math.round(endTime - startTime);
        const mongoOnlyLatency = explainResult.executionStats.executionTimeMillis;
        const resultCount = explainResult.executionStats.nReturned || 0;

        return {
            latency: totalLatency,
            mongoOnlyLatency: mongoOnlyLatency,
            success: true,
            resultCount: resultCount
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

// Print detailed explain plan for a query
async function printExplainPlan(queryName, queryFunc, testData) {
    console.log(`\n  📋 EXPLAIN PLAN for ${queryName}:`);
    console.log(`  ${'='.repeat(50)}`);
    
    try {
        // Get the explain result by calling the query function with printQuery=false
        // We need to create separate explain calls for each query type
        
        if (queryName === 'GetEligibleUserComms') {
            const query = { user_id: testData.userId };
            const explainResult = await db.collection('user_comms')
                .find(query)
                .batchSize(100)
                .limit(100)
                .explain("executionStats");
            
            printExplainDetails(explainResult);
            
        } else if (queryName === 'GetScheduleSegment_v1') {
            const query = {
                tracking_id: testData.trackingId,
                template_id: testData.templateId,
                planned_date_hour: testData.plannedDateHour
            };
            
            if (testData.lastUserId) {
                query.user_id = { $gt: testData.lastUserId };
            }
            
            const explainResult = await db.collection('user_comms')
                .find(query, {
                    sort: { user_id: 1 },
                    limit: PAGE_SIZE,
                    projection: { user_id: 1 }
                })
                .explain("executionStats");
                
            printExplainDetails(explainResult);
            
        } else if (queryName === 'GetScheduleSegment_v2') {
            const query = {
                tracking_id: testData.trackingId,
                template_id: testData.templateId,
                planned_date_hour: testData.plannedDateHour,
                user_id: { $gt: testData.lastUserIdForV2 }
            };
            
            const explainResult = await db.collection('user_comms')
                .find(query, {
                    sort: { user_id: 1 },
                    limit: PAGE_SIZE,
                    projection: { user_id: 1 }
                })
                .explain("executionStats");
                
            printExplainDetails(explainResult);
            
        } else if (queryName === 'GetUserSchedule') {
            const query = {
                user_id: testData.userId,
                planned_date_hour: {
                    $gte: testData.startTime,
                    $lte: testData.endTime
                }
            };
            
            const explainResult = await db.collection('user_comms')
                .find(query, {
                    sort: { final_score: -1 },
                    projection: {
                        tracking_id: 1,
                        template_id: 1,
                        final_score: 1
                    }
                })
                .explain("executionStats");
                
            printExplainDetails(explainResult);
        }
        
    } catch (error) {
        console.log(`  ❌ Error getting explain plan: ${error.message}`);
    }
    
    console.log(`  ${'='.repeat(50)}\n`);
}

// Helper function to print explain plan details
function printExplainDetails(explainResult) {
    const stats = explainResult.executionStats;
    const winningPlan = explainResult.queryPlanner.winningPlan;
    
    console.log(`  🎯 Execution Summary:`);
    console.log(`     Total docs examined: ${stats.totalDocsExamined.toLocaleString()}`);
    console.log(`     Total docs returned: ${stats.nReturned.toLocaleString()}`);
    console.log(`     Execution time: ${stats.executionTimeMillis}ms`);
    console.log(`     Index hits: ${stats.totalKeysExamined.toLocaleString()}`);
    
    // Check if index was used
    if (stats.totalKeysExamined > 0) {
        console.log(`  ✅ INDEX USED`);
        
        // Extract index information from winning plan
        function extractIndexInfo(stage) {
            if (stage.stage === 'IXSCAN') {
                console.log(`     Index name: ${stage.indexName}`);
                console.log(`     Index keys: ${JSON.stringify(stage.keyPattern)}`);
                console.log(`     Direction: ${stage.direction || 'forward'}`);
                if (stage.indexBounds) {
                    console.log(`     Index bounds: ${JSON.stringify(stage.indexBounds, null, 6).replace(/\n/g, '\n     ')}`);
                }
            } else if (stage.inputStage) {
                extractIndexInfo(stage.inputStage);
            } else if (stage.inputStages) {
                stage.inputStages.forEach(extractIndexInfo);
            }
        }
        
        extractIndexInfo(winningPlan);
        
    } else {
        console.log(`  ❌ COLLECTION SCAN - No index used`);
    }
    
    // Show query execution stages
    console.log(`  📊 Execution stages:`);
    function printStages(stage, depth = 0) {
        const indent = '     ' + '  '.repeat(depth);
        console.log(`${indent}${stage.stage}`);
        if (stage.inputStage) {
            printStages(stage.inputStage, depth + 1);
        } else if (stage.inputStages) {
            stage.inputStages.forEach(s => printStages(s, depth + 1));
        }
    }
    printStages(winningPlan);
}

// Run benchmark for a single MongoDB query
async function benchmarkMongoQuery(name, queryFunc, testData) {
    console.log(`\n🔥 Benchmarking MongoDB Query: ${name}`);

    const allIterationResults = [];

    for (let iteration = 1; iteration <= BENCHMARK_CONFIG.iterations; iteration++) {
        console.log(`  📊 Iteration ${iteration}/${BENCHMARK_CONFIG.iterations}`);

        // Print query details and explain plan for the first iteration only
        if (iteration === 1) {
            await queryFunc(testData, true); // Print query
            await printExplainPlan(name, queryFunc, testData);
        }

        // Warmup
        console.log(`    Warming up... (${BENCHMARK_CONFIG.warmupRequests} requests)`);
        for (let i = 0; i < BENCHMARK_CONFIG.warmupRequests; i++) {
            await queryFunc(testData);
        }

        // Benchmark
        console.log(`    Running benchmark... (${BENCHMARK_CONFIG.benchmarkRequests} requests)`);
        const latencies = [];
        const mongoOnlyLatencies = [];
        const errors = [];
        let lastResult = null;

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
                    mongoOnlyLatencies.push(result.mongoOnlyLatency);
                    lastResult = result.queryResult || `${result.resultCount} results`; // Capture the last successful result
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
        const mongoOnlyStats = calculateStats(mongoOnlyLatencies);
        const successRate = ((latencies.length / BENCHMARK_CONFIG.benchmarkRequests) * 100).toFixed(1);

        // Print the last result from this iteration
        if (lastResult) {
            console.log(`    📊 Last result from iteration ${iteration}:`);
            console.log(`       ${JSON.stringify(lastResult, null, 6)}`);
        }

        allIterationResults.push({
            ...stats,
            mongoOnly: mongoOnlyStats,
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
        mongoOnly: {
            p50: Math.round(allIterationResults.reduce((sum, r) => sum + r.mongoOnly.p50, 0) / allIterationResults.length),
            p90: Math.round(allIterationResults.reduce((sum, r) => sum + r.mongoOnly.p90, 0) / allIterationResults.length),
            p95: Math.round(allIterationResults.reduce((sum, r) => sum + r.mongoOnly.p95, 0) / allIterationResults.length),
            p99: Math.round(allIterationResults.reduce((sum, r) => sum + r.mongoOnly.p99, 0) / allIterationResults.length),
            avg: Math.round(allIterationResults.reduce((sum, r) => sum + r.mongoOnly.avg, 0) / allIterationResults.length)
        },
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

    lines.push('# MongoDB Performance Benchmark Report');
    lines.push('');

    // Collection context
    lines.push('## Test Environment');
    lines.push('');
    lines.push('| Metric | Value |');
    lines.push('|--------|--------|');
    lines.push(`| Documents | ${collectionStats.documents.toLocaleString()} |`);
    lines.push(`| Server Tier | ${collectionStats.serverTier} |`);
    const totalSamples = Object.values(results)[0].totalSamples;
    lines.push(`| Sample Size | ${totalSamples.toLocaleString()} requests per query |`);
    lines.push(`| Page Size | ${PAGE_SIZE} documents per page |`);
    lines.push('');

    // Performance results
    lines.push('## MongoDB Query Performance Results (user_comms collection)');
    lines.push('');
    lines.push('| Query | P50 (Total \\| MongoDB Only) | P90 (Total \\| MongoDB Only) | P95 (Total \\| MongoDB Only) | P99 (Total \\| MongoDB Only) |');
    lines.push('|-------|------------------------------|------------------------------|------------------------------|------------------------------|');

    Object.entries(results).forEach(([name, stats]) => {
        lines.push(`| ${name} | ${stats.p50}ms / ${stats.mongoOnly.p50}ms | ${stats.p90}ms / ${stats.mongoOnly.p90}ms | ${stats.p95}ms / ${stats.mongoOnly.p95}ms | ${stats.p99}ms / ${stats.mongoOnly.p99}ms |`);
    });

    lines.push('');

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
        console.log(`   Template ID: ${testData.templateId}`);
        console.log(`   Tracking ID: ${testData.trackingId}`);
        console.log(`   Planned Date Hour: ${testData.plannedDateHour}`);
        console.log(`   Schedule Range: ${testData.startTime.toISOString()} to ${testData.endTime.toISOString()}`);
        console.log(`   Last User ID for v1: ${testData.lastUserIdForV1} (first page)`);
        console.log(`   Last User ID for v2: ${testData.lastUserIdForV2} (pagination)`);
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
        console.log(`🗄️ Database: ${collectionStats.documents.toLocaleString()} documents`);
        console.log(`🖥️ Server Tier: ${collectionStats.serverTier}`);
        console.log('');

        Object.entries(results).forEach(([name, stats]) => {
            console.log(`${name}:`);
            console.log(`  P50: ${stats.p50}ms (${stats.mongoOnly.p50}ms mongodb only) | P90: ${stats.p90}ms (${stats.mongoOnly.p90}ms mongodb only)`);
            console.log(`  P95: ${stats.p95}ms (${stats.mongoOnly.p95}ms mongodb only) | P99: ${stats.p99}ms (${stats.mongoOnly.p99}ms mongodb only)`);
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