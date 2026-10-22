import {setTimeout} from 'node:timers/promises';
import {configFromEnv} from '../../api/src/config.js';
import {postgres} from '../../../packages/db/index.js';
import {chainClient,validateChain} from '../../../packages/chain/client.js';
import {contracts,indexContract} from './indexer.js';
import {dispatchWebhooks} from './webhooks.js';
import {runKeeper} from './keeper.js';
const config=configFromEnv();if(!config.router)throw new Error('PAYMENT_ROUTER_ADDRESS is required for the worker');
const {db,close}=postgres(config.databaseUrl);const client=chainClient(config);const deployment=await validateChain(client,config);if(!deployment)throw new Error('Router unavailable');
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stopping=true;});
console.log('MezoLoop worker started');
try {while(!stopping){try{
 for(const contract of contracts(config,deployment.subscriptionManager))await indexContract(db,client,config,contract.address,contract.abi);
 await runKeeper(db,client,config,deployment.subscriptionManager);await dispatchWebhooks(db);
 await db.query("DELETE FROM sessions WHERE expires_at<now()-interval '1 day'");await db.query("DELETE FROM challenges WHERE expires_at<now()-interval '1 day'");
 }catch(error){console.error('Worker cycle failed; will retry',error instanceof Error?error.message:'Unknown error');}
 await setTimeout(5000);
}}finally{await close();}
