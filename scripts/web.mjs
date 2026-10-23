import {existsSync,readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {spawn} from 'node:child_process';
const command=process.argv[2];
if(!['dev','build','start'].includes(command))throw new Error('Expected dev, build, or start');
const env={...process.env,NODE_ENV:command==='dev'?'development':'production'};
if(existsSync('.env')){
 const local=parseEnv(readFileSync('.env','utf8'));
 for(const key of ['API_ORIGIN','PUBLIC_SITE_URL'])if(env[key]===undefined&&local[key])env[key]=local[key];
}
const child=spawn(process.execPath,['node_modules/next/dist/bin/next',command,'apps/web',...process.argv.slice(3)],{stdio:'inherit',env});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
