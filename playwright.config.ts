import {defineConfig} from '@playwright/test';
export default defineConfig({
 testDir:'./tests/browser',
 fullyParallel:false,
 workers:1,
 use:{baseURL:'http://127.0.0.1:3000',viewport:{width:1440,height:1000},
  launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--enable-unsafe-swiftshader']},
 },
 webServer:{command:'npm run web:dev',url:'http://127.0.0.1:3000',reuseExistingServer:!process.env.CI,timeout:60000},
});
