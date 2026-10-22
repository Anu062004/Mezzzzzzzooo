import {test,expect} from '@playwright/test';

test('3D landing controls, modal, tabs, calculator and logo download',async({page})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Payments. Shared value.'})).toBeVisible();
 await expect(page.getByRole('button',{name:'Send a pulse'})).toBeEnabled();
 await page.getByRole('button',{name:'Send a pulse'}).click();
 await page.getByRole('button',{name:'Pause animation'}).click();
 await expect(page.getByRole('button',{name:'Play animation'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Play animation'}).click();
 await page.getByRole('button',{name:'Meet MezoLoop'}).click();
 await expect(page.getByRole('dialog')).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.getByRole('dialog')).not.toBeVisible();
 await page.getByRole('tab',{name:'Your wallet. Your decision.'}).click();
 await expect(page.getByRole('tabpanel')).toContainText('wallet keys');
 await page.keyboard.press('ArrowRight');await expect(page.getByRole('tabpanel')).toContainText('Bounded subscriptions');
 await page.getByLabel('Referral commission').fill('10');await page.getByLabel('Customer cashback').fill('20');
 await expect(page.locator('.result-0')).toContainText('14.00');await expect(page.locator('.result-1')).toContainText('2.00');await expect(page.locator('.result-2')).toContainText('4.00');
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'Make it your mark'}).click();
 expect((await download).suggestedFilename()).toBe('mezoloop-logo.png');
 expect(errors).toEqual([]);
});

test('responsive layouts and mobile navigation',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 for(const width of [320,375,414,768,1024,1440]){
  await page.setViewportSize({width,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  await expect(page.getByRole('heading',{name:'Payments. Shared value.'})).toBeVisible();
 }
 await page.setViewportSize({width:375,height:900});await page.getByRole('button',{name:'Open navigation'}).click();
 await expect(page.getByRole('navigation')).toBeVisible();await page.getByRole('navigation').getByText('The loop',{exact:true}).click();
 await expect(page.getByRole('button',{name:'Open navigation'})).toHaveAttribute('aria-expanded','false');
});

test('reduced-motion and unavailable WebGL retain usable content',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');
 await expect(page.getByRole('button',{name:'Play animation'})).toHaveAttribute('aria-pressed','true');
 await expect(page.getByRole('button',{name:'Send a pulse'})).toBeDisabled();
 await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,type:string,...args:any[]){if(type==='webgl'||type==='webgl2')return null;return original.apply(this,[type,...args] as any);} as typeof original;});
 await page.reload();await expect(page.locator('[data-renderer="fallback"] img')).toBeVisible();
 await expect(page.getByRole('link',{name:'Follow the flow'})).toBeVisible();
});
