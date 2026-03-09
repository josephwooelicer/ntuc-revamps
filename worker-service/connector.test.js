"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
Object.defineProperty(exports, "__esModule", { value: true });
var engine_1 = require("./src/ingestion/engine");
var data_gov_sg_1 = require("./src/ingestion/connectors/data-gov-sg");
var news_google_search_1 = require("./src/ingestion/connectors/news-google-search");
var layoffs_fyi_1 = require("./src/ingestion/connectors/layoffs-fyi");
var egazette_1 = require("./src/ingestion/connectors/egazette");
var acra_bulk_sync_1 = require("./src/ingestion/connectors/acra-bulk-sync");
var reddit_sentiment_1 = require("./src/ingestion/connectors/reddit-sentiment");
var listed_company_annual_reports_1 = require("./src/ingestion/connectors/listed-company-annual-reports");
var sqlite3 = require("sqlite3");
var sqlite_1 = require("sqlite");
var path = require("path");
function ensureBizfileSourceSeeded() {
    return __awaiter(this, void 0, void 0, function () {
        var dbPath, db;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    dbPath = path.resolve(__dirname, '../data/ntuc-ews.db');
                    return [4 /*yield*/, (0, sqlite_1.open)({
                            filename: dbPath,
                            driver: sqlite3.Database
                        })];
                case 1:
                    db = _a.sent();
                    return [4 /*yield*/, db.run("INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ['src-acra-bulk-sync', 'ACRA Bulk Sync', 'registry', 'api', 'Company Financial', 1.0, 1, 1])];
                case 2:
                    _a.sent();
                    return [4 /*yield*/, db.run("INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ['src-acra-data-gov-sg', 'ACRA Local Search', 'registry', 'database', 'Company Financial', 1.0, 1, 1])];
                case 3:
                    _a.sent();
                    return [4 /*yield*/, db.run("INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ['src-news', 'Google News Search', 'news', 'scraping', 'News', 0.8, 1, 1])];
                case 4:
                    _a.sent();
                    return [4 /*yield*/, db.run("INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ['src-reddit-sentiment', 'Reddit Sentiment', 'news', 'scraping', 'Social Media', 0.8, 1, 1])];
                case 5:
                    _a.sent();
                    return [4 /*yield*/, db.run("INSERT OR REPLACE INTO sources (id, name, sourceType, accessMode, category, reliabilityWeight, supportsBackfill, isActive)\n         VALUES (?, ?, ?, ?, ?, ?, ?, ?)", ['src-annual-reports-listed', 'Listed Company Annual Reports', 'filing', 'scraping', 'Company Financial', 0.9, 1, 1])];
                case 6:
                    _a.sent();
                    return [4 /*yield*/, db.close()];
                case 7:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    });
}
function test() {
    return __awaiter(this, void 0, void 0, function () {
        var engine, range, resAnnualReports, e_1;
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0: return [4 /*yield*/, ensureBizfileSourceSeeded()];
                case 1:
                    _a.sent();
                    engine = new engine_1.IngestionEngine();
                    engine.registerConnector(new data_gov_sg_1.DataGovSgConnector());
                    engine.registerConnector(new news_google_search_1.NewsGoogleSearchConnector());
                    engine.registerConnector(new layoffs_fyi_1.LayoffsFyiConnector());
                    engine.registerConnector(new egazette_1.EgazetteConnector());
                    engine.registerConnector(new acra_bulk_sync_1.AcraBulkSyncConnector());
                    engine.registerConnector(new acra_bulk_sync_1.AcraLocalSearchConnector());
                    engine.registerConnector(new reddit_sentiment_1.RedditSentimentConnector());
                    engine.registerConnector(new listed_company_annual_reports_1.ListedCompanyAnnualReportsConnector());
                    // console.log('Testing Layoffs.fyi Connector (Singapore)...');
                    // try {
                    //     const res5 = await engine.runBackfill('src-layoffs-fyi', range, {
                    //         country: 'Singapore'
                    //     });
                    //     console.log(`Layoffs.fyi Singapore Result: ${res5.recordsPulled} records pulled (runId: ${res5.runId})`);
                    // } catch (e) {
                    //     console.error('Layoffs.fyi Error:', e);
                    // }
                    // console.log('Running ACRA Bulk Sync...');
                    // try {
                    //     await engine.runBackfill('src-acra-bulk-sync', range);
                    //     console.log('ACRA Bulk Sync Completed.');
                    // } catch (e) {
                    //     console.error('ACRA Bulk Sync Error:', e);
                    // }
                    // console.log('Testing ACRA Local Search (lazada)...');
                    // try {
                    //     const resLocalSearch = await engine.runBackfill('src-acra-data-gov-sg', range, {
                    //         companyName: 'lazada'
                    //     });
                    //     console.log(`ACRA Local Search Result: ${resLocalSearch.recordsPulled} records pulled (runId: ${resLocalSearch.runId})`);
                    //     if (resLocalSearch.records && resLocalSearch.records.length > 0) {
                    //         console.log('Returned JSON Result:');
                    //         console.log(JSON.stringify(resLocalSearch.records, null, 2));
                    //     }
                    // } catch (e) {
                    //     console.error('ACRA Local Search Error:', e);
                    // }
                    // console.log('Testing News Google Search (lazada)...');
                    // try {
                    //     const range = {
                    //         start: new Date('2025-10-01T00:00:00Z'),
                    //         end: new Date('2025-11-01T00:00:00Z')
                    //     };
                    //     const resNews = await engine.runBackfill('src-news', range, {
                    //         company_name: 'lazada'
                    //     });
                    //     console.log(`News Google Search Result: ${resNews.recordsPulled} documents found (runId: ${resNews.runId})`);
                    // } catch (e) {
                    //     console.error('News Google Search Error:', e);
                    // }
                    // console.log('Testing Reddit Sentiment (lazada)...');
                    // try {
                    //     const range = {
                    //         start: new Date('2025-10-01T00:00:00Z'),
                    //         end: new Date('2025-11-01T00:00:00Z')
                    //     };
                    //     const resReddit = await engine.runBackfill('src-reddit-sentiment', range, {
                    //         company_name: 'lazada'
                    //     });
                    //     console.log(`Reddit Sentiment Result: ${resReddit.recordsPulled} documents found (runId: ${resReddit.runId})`);
                    // } catch (e) {
                    //     console.error('Reddit Sentiment Error:', e);
                    // }
                    // console.log('Testing Data.gov.sg (MOM)...');
                    // try {
                    //     const resDataGov = await engine.runBackfill('src-data-gov-sg', {
                    //         start: new Date('2026-01-01T00:00:00Z'),
                    //         end: new Date('2026-02-01T00:00:00Z')
                    //     }, {
                    //         agency: 'MOM',
                    //     });
                    //     console.log(`Data.gov.sg Result: ${resDataGov.recordsPulled} documents found (runId: ${resDataGov.runId})`);
                    // } catch (e) {
                    //     console.error('Data.gov.sg Error:', e);
                    // }
                    // console.log('Testing Egazette (Singapore Airlines)...');
                    // try {
                    //     const resEgazette = await engine.runBackfill('src-egazette', {
                    //         start: new Date('2026-02-01T00:00:00Z'),
                    //         end: new Date('2026-03-01T00:00:00Z')
                    //     }, {
                    //         query: 'twelve cupcakes'
                    //     });
                    //     console.log(`Egazette Result: ${resEgazette.recordsPulled} documents found (runId: ${resEgazette.runId})`);
                    // } catch (e) {
                    //     console.error('Egazette Error:', e);
                    // }
                    console.log('Testing Listed Company Annual Reports (DBS, Singtel)...');
                    _a.label = 2;
                case 2:
                    _a.trys.push([2, 4, , 5]);
                    range = {
                        start: new Date('2025-01-01T00:00:00Z'),
                        end: new Date('2026-01-01T00:00:00Z')
                    };
                    return [4 /*yield*/, engine.runBackfill('src-annual-reports-listed', range, {
                            company_names: ['Singtel']
                        })];
                case 3:
                    resAnnualReports = _a.sent();
                    console.log("Listed Company Annual Reports Result: ".concat(resAnnualReports.recordsPulled, " documents found (runId: ").concat(resAnnualReports.runId, ")"));
                    return [3 /*break*/, 5];
                case 4:
                    e_1 = _a.sent();
                    console.error('Listed Company Annual Reports Error:', e_1);
                    return [3 /*break*/, 5];
                case 5: return [2 /*return*/];
            }
        });
    });
}
test();
