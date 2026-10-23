'use client';
import {useEffect,useState} from 'react';
import QRCode from 'qrcode';
import {Copy} from './UI';
export function QR({url}:{url:string}){const [image,setImage]=useState('');useEffect(()=>{let mounted=true;QRCode.toDataURL(url,{width:256,margin:2,errorCorrectionLevel:'M'}).then(result=>{if(mounted)setImage(result);});return()=>{mounted=false;};},[url]);return <>{image&&<img className="qr-preview" src={image} alt="Checkout QR code"/>}<div className="action-row"><Copy text={url}/><a className="w-button" href={url}>Open link ↗</a>{image&&<a className="w-button" href={image} download="mezoloop-checkout.png">Download QR</a>}</div></>;}
