'use client';
import dynamic from 'next/dynamic';
import {useCallback,useEffect,useRef,useState} from 'react';
const LoopScene=dynamic(()=>import('./LoopScene'),{ssr:false,loading:()=> <img className="scene-fallback" src="/brand/mezoloop-logo.png" alt="MezoLoop metallic loop"/>});
const REPO='https://github.com/Anu062004/Mezzzzzzzooo';
function Arrow({diagonal=false}:{diagonal?:boolean}){return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d={diagonal?'M6 18 18 6M6 6h12v12':'M4 12h15m-6-6 6 6-6 6'} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;}
const features=[
 {number:'01',title:'Make every payment go further.',copy:'One MUSD payment. A merchant-approved referral share. Cashback for the customer. All settled together, on-chain.',label:'PAYMENTS WITH PURPOSE'},
 {number:'02',title:'Your wallet. Your decision.',copy:'Review the amount, recipients, and rewards before you sign. MezoLoop never takes custody of your wallet keys.',label:'CONTROL STAYS WITH YOU'},
 {number:'03',title:'Keep the good things recurring.',copy:'Bounded subscriptions put the terms up front. Clear amounts, a maximum charge count, and cancellation controlled by the customer.',label:'CONSENT, NOT COMMITMENT'},
];
export default function Landing(){
 const [paused,setPaused]=useState(true),[reduced,setReduced]=useState(false),[ready,setReady]=useState(false),[pulse,setPulse]=useState(0),[menu,setMenu]=useState(false);
 const [amount,setAmount]=useState(20),[referral,setReferral]=useState(3),[cashback,setCashback]=useState(5),[active,setActive]=useState(0),[pulseText,setPulseText]=useState('');
 const amountAtomic=BigInt(amount)*100n;
 const referralAtomic=amountAtomic*BigInt(referral)/100n,cashbackAtomic=amountAtomic*BigInt(cashback)/100n;
 const money=(value:bigint)=>`${value/100n}.${String(value%100n).padStart(2,'0')}`;
 const values=[money(amountAtomic-referralAtomic-cashbackAtomic),money(referralAtomic),money(cashbackAtomic)];
 const dialog=useRef<HTMLDialogElement>(null);const timeout=useRef<ReturnType<typeof setTimeout>|null>(null);
 const onReady=useCallback(()=>setReady(true),[]);
 useEffect(()=>{const media=matchMedia('(prefers-reduced-motion: reduce)');const apply=()=>{setReduced(media.matches);setPaused(media.matches);};apply();media.addEventListener('change',apply);return()=>{media.removeEventListener('change',apply);if(timeout.current)clearTimeout(timeout.current);};},[]);
 const sendPulse=()=>{setPulse(v=>v+1);setPulseText('Illustration: one payment, three recipients.');if(timeout.current)clearTimeout(timeout.current);timeout.current=setTimeout(()=>setPulseText(''),4000);};
 return <>
  <a className="skip-link" href="#main">Skip to content</a>
  <header className="site-header wrap">
   <a className="brand" href="#" aria-label="MezoLoop home"><img src="/brand/mezoloop-logo.png" width="58" height="58" alt=""/><span>MezoLoop</span></a>
   <nav aria-label="Main navigation" className={menu?'nav open':'nav'}><a href="#how-it-works" onClick={()=>setMenu(false)}>The loop</a><a href="#explore" onClick={()=>setMenu(false)}>How it works</a><a href={`${REPO}#getting-started`} target="_blank" rel="noreferrer">Developers <Arrow diagonal/></a></nav>
   <a className="header-cta" href="#explore">Explore the protocol <Arrow/></a>
   <button className="menu-toggle" onClick={()=>setMenu(!menu)} aria-expanded={menu} aria-label={menu?'Close navigation':'Open navigation'}>{menu?'Close':'Menu'}</button>
  </header>
  <main id="main">
   <section className="hero wrap" aria-labelledby="hero-title">
    <div className="hero-topline"><span className="eyebrow"><i/> VALUE, IN MOTION</span><span className="network-label">BUILT ON MEZO <span>↗</span></span></div>
    <div className="hero-copy"><h1 id="hero-title">Payments.<br/><span>Shared value.</span></h1><p>A better kind of payment loop.<br/>For the merchant. The partner.<br/>And the person behind the purchase.</p>
     <div className="hero-actions"><a className="button primary" href="#explore">Follow the flow <Arrow/></a><button className="text-button" onClick={()=>dialog.current?.showModal()}>Meet MezoLoop <span className="play-icon">▷</span></button></div>
     <div className="hero-proof"><span className="tiny-loop">∞</span> Non-custodial by design. Connected by Mezo.</div>
    </div>
    <div className="hero-visual" aria-label="Interactive 3D illustration of a payment flowing to three recipients">
     <div className="orbit-label"><span className="cross">+</span> THE MEZOLOOP</div>
     <LoopScene paused={paused} pulse={pulse} onReady={onReady}/>
     <div className="recipient recipient-one"><span>01</span> Merchant</div><div className="recipient recipient-two"><span>02</span> Partner</div><div className="recipient recipient-three"><span>03</span> You</div>
     <div className="visual-controls"><button className="pulse-button" onClick={sendPulse} disabled={!ready||paused}><span>↗</span> Send a pulse</button><span className="visual-hint">{reduced?'Reduced motion enabled':'Move your cursor. Feel the flow.'}</span><button className="motion-button" onClick={()=>setPaused(!paused)} aria-label={paused?'Play animation':'Pause animation'} aria-pressed={paused}>{paused?'▷':'Ⅱ'}</button></div>
     <span className="sr-only" role="status">{pulseText}</span>
    </div>
    <div className="hero-bottom"><span>ONE PAYMENT. THREE POSSIBILITIES.</span><a href="#how-it-works">Scroll to discover <span>↓</span></a><span className="version">MEZO TESTNET · IN DEVELOPMENT</span></div>
   </section>
   <div className="principles-strip"><div className="wrap"><span><i>↗</i> MUSD payments</span><span><i>⌁</i> Merchant referrals</span><span><i>↩</i> Customer cashback</span><span><i>∞</i> Bounded subscriptions</span></div></div>
   <section id="how-it-works" className="story-section wrap">
    <div className="section-intro"><span className="eyebrow">THE IDEA IS SIMPLE</span><h2>Value shouldn’t<br/>stop at the checkout.</h2><p>Turn a transaction into a connection.<br/>Let the people who make a purchase possible share in its value.</p></div>
    <div className="story-layout"><div className="story-tabs" role="tablist" aria-label="Protocol principles">{features.map((feature,index)=><button key={feature.number} id={`principle-tab-${index}`} role="tab" aria-selected={active===index} aria-controls="principle-panel" tabIndex={active===index?0:-1} onClick={()=>setActive(index)} onKeyDown={e=>{if(e.key==='ArrowDown'||e.key==='ArrowRight'){e.preventDefault();const next=(active+1)%3;setActive(next);document.getElementById(`principle-tab-${next}`)?.focus();}if(e.key==='ArrowUp'||e.key==='ArrowLeft'){e.preventDefault();const next=(active+2)%3;setActive(next);document.getElementById(`principle-tab-${next}`)?.focus();}}}><span>{feature.number}</span><strong>{feature.title}</strong><Arrow/></button>)}</div><div className="story-panel" role="tabpanel" id="principle-panel" aria-labelledby={`principle-tab-${active}`}><span className="eyebrow">{features[active].label}</span><p>{features[active].copy}</p><a href={`${REPO}/blob/main/docs/protocol.md`} target="_blank" rel="noreferrer">Read the protocol <Arrow diagonal/></a></div></div>
   </section>
   <section id="explore" className="explore-section"><div className="wrap">
    <div className="explore-heading"><div><span className="eyebrow">FOLLOW A PAYMENT</span><h2>A little split.<br/>A bigger connection.</h2></div><p>Move the numbers. See where the value goes.<br/>An illustration of the protocol, not a live transaction.</p></div>
    <div className="calculator"><div className="calculator-inputs"><label htmlFor="amount">Purchase amount <span>MUSD</span></label><div className="amount-display">{amount}<span>.00</span></div><input id="amount" type="range" min="1" max="200" value={amount} onChange={e=>setAmount(Number(e.target.value))}/><div className="range-labels"><span>1 MUSD</span><span>200 MUSD</span></div><div className="split-input"><label htmlFor="referral">Referral commission</label><div><input id="referral" type="number" min="0" max="30" value={referral} onChange={e=>setReferral(Math.max(0,Math.min(30,Math.trunc(Number(e.target.value)||0))))}/><span>%</span></div></div><div className="split-input"><label htmlFor="cashback">Customer cashback</label><div><input id="cashback" type="number" min="0" max="30" value={cashback} onChange={e=>setCashback(Math.max(0,Math.min(30,Math.trunc(Number(e.target.value)||0))))}/><span>%</span></div></div></div>
     <div className="calculator-flow"><span className="flow-line"/><img src="/brand/mezoloop-logo.png" width="180" height="180" alt="The payment splits into three paths"/><span className="flow-line"/></div>
     <div className="calculator-results" aria-live="polite">{['Merchant receives','Partner earns','You get back'].map((label,index)=><div className={`result result-${index}`} key={label}><div><span className="result-dot"/>{label}</div><strong>{values[index]} <small>MUSD</small></strong></div>)}<p>Every part accounted for. No new money created.</p></div>
    </div>
   </div></section>
   <section className="closing wrap"><div><span className="eyebrow">BUILT IN THE OPEN</span><h2>Get inside<br/>the loop.</h2></div><div className="closing-links"><a href={REPO} target="_blank" rel="noreferrer"><span>Explore the source<small>Contracts, API, and the thinking behind them.</small></span><Arrow diagonal/></a><a href="/brand/mezoloop-logo.png" download="mezoloop-logo.png"><span>Make it your mark<small>Download the MezoLoop logo.</small></span><Arrow/></a></div></section>
  </main>
  <footer className="site-footer wrap"><a className="brand" href="#"><img src="/brand/mezoloop-logo.png" width="48" height="48" alt=""/><span>MezoLoop</span></a><p>Payments. Shared value.</p><span>Designed for Mezo. Built for connection.</span><a href={REPO} target="_blank" rel="noreferrer" aria-label="MezoLoop on GitHub">GitHub <Arrow diagonal/></a></footer>
  <dialog ref={dialog} className="intro-dialog" onClick={e=>{if(e.target===dialog.current)dialog.current.close();}} aria-labelledby="intro-title"><button className="dialog-close" onClick={()=>dialog.current?.close()} aria-label="Close introduction">×</button><img src="/brand/mezoloop-logo.png" width="160" height="160" alt="MezoLoop logo"/><span className="eyebrow">MEET MEZOLOOP</span><h2 id="intro-title">One payment.<br/>Shared possibility.</h2><p>MezoLoop is a non-custodial payment protocol for Mezo. Merchants approve the terms, customers authorize payments in their wallets, and contracts distribute the value.</p><p className="dialog-note">This site is an interactive introduction. The protocol is in development on testnet; no funds are moved here.</p><a className="button primary" href={`${REPO}#getting-started`} target="_blank" rel="noreferrer">Explore the documentation <Arrow diagonal/></a></dialog>
 </>;
}
