import { NewsGoogleSearchConnector } from './src/ingestion/connectors/news-google-search';

async function test() {
    const connector = new NewsGoogleSearchConnector();

    const range = {
        start: new Date('2024-01-01'),
        end: new Date('2024-12-31')
    };

    const options = {
        company_name: 'Dyson',
        news_site: 'channelnewsasia.com'
    };

    console.log('--- Testing NewsGoogleSearchConnector ---');
    const result = await connector.pull(range, undefined, options);

    console.log(`Fetched ${result.documents.length} documents.`);
    if (result.documents.length > 0) {
        console.log('First result:', JSON.stringify(result.documents[0], null, 2));
    }
}

test().catch(console.error);
